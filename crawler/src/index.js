import 'dotenv/config';
import { crawlInmuebles24 } from './inmuebles24.js';
import { crawlVivanuncios } from './vivanuncios.js';
import { crawlLamudi } from './lamudi.js';
import { getSourceId, findOrCreateLocation, upsertProperty, markStale } from './db.js';
import { geocodeColonia } from './geocode.js';

const MUNICIPALITY = process.env.CRAWL_MUNICIPALITY || 'San Luis Potosí';
const MAX_PAGES = Number(process.env.CRAWL_MAX_PAGES || 10);
const REQUEST_DELAY_MS = Number(process.env.CRAWL_REQUEST_DELAY_MS || 2500);
const INTERVAL_MINUTES = Number(process.env.CRAWL_INTERVAL_MINUTES || 20);
const RUN_ONCE = process.argv.includes('--once');

// Cada fuente vive aquí con su nombre en `sources`, su base_url y su función
// de crawl. Agregar una fuente nueva es agregar una entrada a esta lista —
// index.js no necesita más cambios.
const SOURCES = [
  { name: 'inmuebles24', baseUrl: 'https://www.inmuebles24.com', crawl: crawlInmuebles24 },
  { name: 'vivanuncios', baseUrl: 'https://www.vivanuncios.com.mx', crawl: crawlVivanuncios },
  { name: 'lamudi', baseUrl: 'https://www.lamudi.com.mx', crawl: crawlLamudi },
];

// Cache en memoria de colonia -> location_id para no hacer un upsert por listing.
const locationCache = new Map();

async function resolveLocationId(colonia) {
  const key = colonia || '__sin_colonia__';
  if (locationCache.has(key)) return locationCache.get(key);
  const id = await findOrCreateLocation({ municipality: MUNICIPALITY, colonia, geocodeFn: geocodeColonia });
  locationCache.set(key, id);
  return id;
}

async function runSource({ name, baseUrl, crawl }) {
  const startedAt = Date.now();
  console.log(`[crawler] [${name}] iniciando corrida — ${MUNICIPALITY}, hasta ${MAX_PAGES} páginas`);

  const sourceId = await getSourceId(name, { baseUrl, intervalMinutes: INTERVAL_MINUTES });
  const rawListings = await crawl({ maxPages: MAX_PAGES, requestDelayMs: REQUEST_DELAY_MS });

  let ok = 0;
  let failed = 0;
  for (const raw of rawListings) {
    try {
      const locationId = await resolveLocationId(raw.colonia);
      const { normalizeListing } = await import('./normalize.js');
      const listing = normalizeListing(raw, locationId);
      if (!listing.price) { failed++; continue; } // sin precio no es publicable
      await upsertProperty(sourceId, listing);
      ok++;
    } catch (err) {
      failed++;
      console.error(`[crawler] [${name}] error en listing ${raw.sourceListingId}: ${err.message}`);
    }
  }

  await markStale(sourceId);

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[crawler] [${name}] corrida terminada en ${seconds}s — ${ok} ok, ${failed} descartados/fallidos, ${rawListings.length} vistos`);
}

// Las fuentes se corren en serie (no en paralelo) — cada una ya pagina y
// espera con su propio delay/backoff; correrlas a la vez multiplicaría la
// carga simultánea contra la red de la VPS sin ganar nada en velocidad real.
async function runOnce() {
  for (const source of SOURCES) {
    try {
      await runSource(source);
    } catch (err) {
      console.error(`[crawler] [${source.name}] error fatal en la fuente: ${err.message}`);
    }
  }
}

async function main() {
  await runOnce();
  if (RUN_ONCE) return;

  console.log(`[crawler] modo continuo — próxima corrida en ${INTERVAL_MINUTES} min`);
  setInterval(runOnce, INTERVAL_MINUTES * 60 * 1000);
}

main().catch((err) => {
  console.error('[crawler] error fatal:', err);
  process.exit(1);
});
