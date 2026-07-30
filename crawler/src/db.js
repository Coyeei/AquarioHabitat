import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Devuelve el id de sources para el nombre dado; lo crea si no existe.
export async function getSourceId(name, { baseUrl, intervalMinutes } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO sources (name, type, base_url, crawl_interval_minutes)
     VALUES ($1, 'portal', $2, $3)
     ON CONFLICT (name) DO UPDATE SET active = TRUE
     RETURNING id`,
    [name, baseUrl || null, Number(intervalMinutes || process.env.CRAWL_INTERVAL_MINUTES || 20)]
  );
  return rows[0].id;
}

// Upsert de location por municipio + colonia. ON CONFLICT es solo red de
// seguridad ante una carrera (dos listings de la misma colonia resueltos a
// la vez); el cacheo real de geocoding pasa por findOrCreateLocation, que
// evita llamar a Nominatim si la colonia ya existe.
export async function upsertLocation({ municipality, colonia, postalCode, lat, lng }) {
  const geomExpr = lat != null && lng != null
    ? `ST_SetSRID(ST_MakePoint($4, $3), 4326)`
    : `NULL`;
  const { rows } = await pool.query(
    `INSERT INTO locations (municipality, colonia, postal_code, geom)
     VALUES ($1, $2, $5, ${geomExpr})
     ON CONFLICT (municipality, colonia) DO UPDATE SET
       geom = COALESCE(locations.geom, EXCLUDED.geom),
       postal_code = COALESCE(locations.postal_code, EXCLUDED.postal_code)
     RETURNING id`,
    [municipality, colonia || null, lat, lng, postalCode || null]
  );
  return rows[0].id;
}

// Busca una location existente por municipio+colonia sin tocar Nominatim.
export async function findLocation({ municipality, colonia }) {
  const { rows } = await pool.query(
    `SELECT id, geom FROM locations WHERE municipality = $1 AND colonia IS NOT DISTINCT FROM $2`,
    [municipality, colonia || null]
  );
  return rows[0] || null;
}

// Punto de entrada del crawler: reusa location si ya existe (con o sin geom
// resuelto); solo geocodifica colonias nuevas. geocodeFn es inyectado desde
// index.js (geocode.js) para no acoplar db.js a Nominatim.
export async function findOrCreateLocation({ municipality, colonia, geocodeFn }) {
  const existing = await findLocation({ municipality, colonia });
  if (existing) return existing.id;

  let lat = null;
  let lng = null;
  if (colonia && geocodeFn) {
    const coords = await geocodeFn({ colonia, municipality });
    if (coords) {
      lat = coords.lat;
      lng = coords.lng;
    }
  }
  return upsertLocation({ municipality, colonia, lat, lng });
}

// Upsert de un listing. Si ya existe (source_id, source_listing_id):
//  - actualiza precio/atributos/last_seen_at
//  - si el precio cambió, agrega una fila a price_history
export async function upsertProperty(sourceId, listing) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id, price FROM properties WHERE source_id = $1 AND source_listing_id = $2`,
      [sourceId, listing.sourceListingId]
    );

    let propertyId;
    if (existing.rows.length === 0) {
      const insert = await client.query(
        `INSERT INTO properties
           (source_id, source_listing_id, source_url, location_id, vertical, title,
            price, currency, land_area_sqm, built_area_sqm, age_years, attributes, photos)
         VALUES ($1,$2,$3,$4,'residential',$5,$6,'MXN',$7,$8,$9,$10,$11)
         RETURNING id`,
        [
          sourceId, listing.sourceListingId, listing.sourceUrl, listing.locationId,
          listing.title, listing.price, listing.landAreaSqm, listing.builtAreaSqm,
          listing.ageYears, listing.attributes, listing.photos
        ]
      );
      propertyId = insert.rows[0].id;
      await client.query(
        `INSERT INTO price_history (property_id, price, price_per_sqm) VALUES ($1,$2,$3)`,
        [propertyId, listing.price, listing.builtAreaSqm ? listing.price / listing.builtAreaSqm : null]
      );
    } else {
      propertyId = existing.rows[0].id;
      const priceChanged = Number(existing.rows[0].price) !== Number(listing.price);
      await client.query(
        `UPDATE properties SET
           title = $2, price = $3, land_area_sqm = $4, built_area_sqm = $5,
           age_years = $6, attributes = $7, photos = $8,
           status = CASE WHEN $3 < price THEN 'price_reduced' ELSE status END,
           last_seen_at = now(), updated_at = now()
         WHERE id = $1`,
        [
          propertyId, listing.title, listing.price, listing.landAreaSqm,
          listing.builtAreaSqm, listing.ageYears, listing.attributes, listing.photos
        ]
      );
      if (priceChanged) {
        await client.query(
          `INSERT INTO price_history (property_id, price, price_per_sqm) VALUES ($1,$2,$3)`,
          [propertyId, listing.price, listing.builtAreaSqm ? listing.price / listing.builtAreaSqm : null]
        );
      }
    }

    await client.query('COMMIT');
    return propertyId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Marca como 'sold_or_removed' los listings de esta fuente no vistos en N horas.
export async function markStale(sourceId, hours = 48) {
  await pool.query(
    `UPDATE properties SET status = 'sold_or_removed'
     WHERE source_id = $1 AND status != 'sold_or_removed'
       AND last_seen_at < now() - ($2 || ' hours')::interval`,
    [sourceId, hours]
  );
}

export default pool;
