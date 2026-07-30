// Geocoding de colonias vía Nominatim (OpenStreetMap) — gratis pero con
// límite estricto de 1 req/seg y User-Agent identificable obligatorio
// (https://operations.osmfoundation.org/policies/nominatim/). Se llama
// UNA vez por colonia (ver findOrCreateLocation en db.js) nunca por listing,
// así que el límite de 1 req/seg no es un cuello de botella real: San Luis
// Potosí tiene unos cuantos cientos de colonias, no miles.
//
// Si el volumen crece (multi-ciudad, multi-fuente) o Nominatim empieza a
// bloquear, migrar a Google Geocoding API o Mapbox (de pago, sin rate limit
// impuesto) — la firma de geocodeColonia() no cambiaría para el resto del
// crawler.

import axios from 'axios';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = process.env.GEOCODE_USER_AGENT
  || 'inteligencia-inmobiliaria-mx-crawler/0.1 (contacto@example.com)';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastRequestAt = 0;
async function throttle() {
  const elapsed = Date.now() - lastRequestAt;
  const wait = Math.max(0, 1100 - elapsed);
  if (wait > 0) await delay(wait);
  lastRequestAt = Date.now();
}

export async function geocodeColonia({ colonia, municipality, state = 'San Luis Potosí' }) {
  const query = [colonia, municipality, state, 'México'].filter(Boolean).join(', ');
  await throttle();
  try {
    const { data } = await axios.get(NOMINATIM_URL, {
      params: { q: query, format: 'json', limit: 1, countrycodes: 'mx' },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000,
    });
    if (!data || data.length === 0) {
      console.warn(`[geocode] sin resultados para "${query}"`);
      return null;
    }
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch (err) {
    console.error(`[geocode] error geocodificando "${query}": ${err.message}`);
    return null;
  }
}
