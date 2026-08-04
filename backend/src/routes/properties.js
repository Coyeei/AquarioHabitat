import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// Traduce una fila de properties (+ location, source) al shape plano que usa el frontend hoy.
function toFrontendShape(row) {
  return {
    id: 'p' + row.id,
    title: row.title,
    segment: row.vertical === 'residential' ? 'Residencial' : row.vertical === 'industrial' ? 'Industrial' : 'Terrenos',
    propertyType: row.attributes?.propertyType || null,
    size: row.built_area_sqm ? `${Number(row.built_area_sqm).toLocaleString('es-MX')} m²` : (row.land_area_sqm ? `${Number(row.land_area_sqm).toLocaleString('es-MX')} m²` : ''),
    price: '$' + Math.round(row.price).toLocaleString('es-MX'),
    pricePerSqm: row.price_per_sqm ? `$${Math.round(row.price_per_sqm).toLocaleString('es-MX')}/m²` : null,
    lat: row.lat, lng: row.lng,
    address: [row.colonia, row.municipality].filter(Boolean).join(', '),
    recamaras: row.attributes?.bedrooms || 0,
    banos: row.attributes?.bathrooms || 0,
    estacionamientos: row.attributes?.parking_spots || 0,
    amenidades: row.attributes?.amenidades || [],
    photos: row.photos || [],
    source: row.source_name,
    status: row.status
  };
}

router.get('/', async (req, res) => {
  const { segment, q, limit = 200 } = req.query;
  const vertical = segment === 'Residencial' ? 'residential' : segment === 'Industrial' ? 'industrial' : segment === 'Terrenos' ? 'land' : null;
  const conditions = [];
  const params = [];
  if (vertical) { params.push(vertical); conditions.push(`p.vertical = $${params.length}`); }
  if (q) { params.push(`%${q}%`); conditions.push(`p.title ILIKE $${params.length}`); }
  params.push(Number(limit));
  const { rows } = await pool.query(
    `SELECT p.*, l.municipality, l.colonia, ST_Y(l.geom) AS lat, ST_X(l.geom) AS lng, s.name AS source_name
     FROM properties p
     LEFT JOIN locations l ON l.id = p.location_id
     LEFT JOIN sources s ON s.id = p.source_id
     ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
     ORDER BY p.last_seen_at DESC LIMIT $${params.length}`,
    params
  );
  res.json(rows.map(toFrontendShape));
});

router.get('/:id', async (req, res) => {
  const id = Number(String(req.params.id).replace(/^p/, ''));
  const { rows } = await pool.query(
    `SELECT p.*, l.municipality, l.colonia, ST_Y(l.geom) AS lat, ST_X(l.geom) AS lng, s.name AS source_name
     FROM properties p
     LEFT JOIN locations l ON l.id = p.location_id
     LEFT JOIN sources s ON s.id = p.source_id
     WHERE p.id = $1`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'No encontrada' });
  res.json(toFrontendShape(rows[0]));
});

export default router;
