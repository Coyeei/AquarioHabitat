// Convierte texto crudo del listado ("$2,350,000", "3 recámaras", "120 m²")
// a valores numéricos limpios. Mantiene la lógica de parsing en un solo lugar
// para que agregar una fuente nueva (Vivanuncios, Lamudi...) sea reusar esto,
// no reinventarlo.

export function parsePriceMXN(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function parseAreaSqm(raw) {
  if (!raw) return null;
  const match = raw.match(/([\d,.]+)\s*m/i);
  if (!match) return null;
  const value = parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

export function parseIntSafe(raw) {
  if (raw == null) return null;
  const match = String(raw).match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

// Normaliza un registro crudo de scraping al shape que espera db.upsertProperty.
export function normalizeListing(raw, locationId) {
  return {
    sourceListingId: raw.sourceListingId,
    sourceUrl: raw.sourceUrl,
    locationId,
    title: raw.title?.trim() || null,
    price: parsePriceMXN(raw.priceText),
    landAreaSqm: parseAreaSqm(raw.landAreaText),
    builtAreaSqm: parseAreaSqm(raw.builtAreaText),
    ageYears: parseIntSafe(raw.ageText),
    attributes: {
      bedrooms: parseIntSafe(raw.bedroomsText),
      bathrooms: parseIntSafe(raw.bathroomsText),
      parking_spots: parseIntSafe(raw.parkingText),
      levels: parseIntSafe(raw.levelsText),
    },
    photos: raw.photos || [],
  };
}
