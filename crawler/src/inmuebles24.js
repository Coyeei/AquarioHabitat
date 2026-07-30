import * as cheerio from 'cheerio';
import { normalizeListing } from './normalize.js';
import { getWithBackoff, jitteredDelay, extractJsonLdBlocks } from './http.js';

const BASE_URL = 'https://www.inmuebles24.com';
// CONFIRMADO jul 2026: el slug real de categoría es "casas-en-venta-en-..."
// (1,669 resultados) — el slug combinado "casas-y-departamentos-en-venta-..."
// que se usaba antes no corresponde a ninguna página real de Inmuebles24.
// Para incluir departamentos habría que correr un segundo crawl con
// '/departamentos-en-venta-en-san-luis-potosi.html'.
const SEARCH_PATH = '/casas-en-venta-en-san-luis-potosi.html';

function extractJsonLd($) {
  return extractJsonLdBlocks($);
}

// HALLAZGO (a partir de un guardado real de la página de listado, jul 2026):
// el listado de Inmuebles24 es un SPA que hidrata las tarjetas por XHR — el
// HTML servido/guardado NO trae `.postingCard` ni clases de tarjeta, así que
// cualquier selector CSS ahí es papel mojado. Lo que SÍ viene en el HTML es
// un bloque `<script type="application/ld+json">` con un ItemList de
// RealEstateListing (name, description, url, image, datePosted) — sin precio
// ni recámaras. Esa es la señal estable para la página de listado; precio y
// features exactos se completan en la página de detalle (fetchDetail).
function parseSearchResultsPage(html) {
  const $ = cheerio.load(html);
  const cards = [];

  const jsonLdBlocks = extractJsonLd($);
  const itemList = jsonLdBlocks.find((b) => b['@type'] === 'ItemList' || Array.isArray(b?.itemListElement));

  for (const item of itemList?.itemListElement || []) {
    const entry = item.item || item; // algunos ItemList envuelven en {position, item:{...}}
    const sourceUrl = entry.url ? new URL(entry.url, BASE_URL).toString() : null;
    const sourceListingId = sourceUrl ? sourceUrl.match(/-(\d+)\.html/)?.[1] : null;
    if (!sourceListingId) continue;

    cards.push({
      sourceListingId,
      sourceUrl,
      title: entry.name || '',
      descriptionText: entry.description || '',
      priceText: '',       // no viene en el listado — se completa en fetchDetail
      builtAreaText: '',
      landAreaText: '',
      bedroomsText: '',
      bathroomsText: '',
      parkingText: '',
      colonia: '',          // no viene estructurada en el listado; inferir por ciudad/URL o completar en detalle
      photos: entry.image ? [entry.image] : [],
    });
  }

  // CONFIRMADO jul 2026: sí existe paginación real, con anchors
  // "casas-en-venta-en-san-luis-potosi-pagina-N.html" (vistos hasta N=5+ en
  // un listado de 1,669 resultados). Se detecta el número de página más alto
  // presente en el HTML de esta página para saber si seguir.
  const pageNumbers = [];
  $('a[href*="-pagina-"]').each((_, el) => {
    const m = ($(el).attr('href') || '').match(/-pagina-(\d+)\.html/);
    if (m) pageNumbers.push(Number(m[1]));
  });
  const maxPageSeen = pageNumbers.length ? Math.max(...pageNumbers) : 1;
  return { cards, maxPageSeen };
}

// CONFIRMADO contra un detalle real (jul 2026, .../propiedades/clasificado/
// veclcain-casa-villa-magna-147510099.html): a diferencia del listado, la
// página de detalle SÍ es SSR y trae tres fuentes limpias, en orden de
// preferencia — ninguna depende de clases CSS hasheadas:
//  1) JSON-LD `House`/`Apartment` (JSON válido): title, description, image,
//     numberOfBedrooms, numberOfBathroomsTotal, address.addressRegion (colonia).
//     OJO: su `floorSize.value` aquí resultó ser el terreno, no lo construido
//     — no usarlo para built_area, mainFeatures es la fuente correcta.
//  2) `const mainFeatures = {...}` (JSON válido embebido en un <script>):
//     objeto por featureId con {label, measure, value} — 'lote' y 'constr.'
//     dan land/built area exactos sin adivinar selectores.
//  3) `const dataLayerInfo = {...}` (objeto JS con comillas simples, no JSON
//     válido — se leen campos puntuales por regex): 'price' trae el precio
//     formateado ("MN 4,790,000"), 'neighborhood'/'city' la ubicación.
function extractHouseJsonLd($) {
  return extractJsonLd($).find((b) =>
    ['House', 'Apartment', 'SingleFamilyResidence', 'Product', 'RealEstateListing'].includes(b['@type'])
  );
}

function extractMainFeatures(html) {
  const match = html.match(/const mainFeatures\s*=\s*(\{[^;]*?\})\s*;/);
  if (!match) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}

function extractDataLayerField(html, field) {
  const match = html.match(new RegExp(`'${field}'\\s*:\\s*'([^']*)'`));
  return match ? match[1] : '';
}

async function fetchDetail(sourceUrl) {
  const { data: html } = await getWithBackoff(sourceUrl, { logPrefix: 'inmuebles24' });
  const $ = cheerio.load(html);

  const houseLd = extractHouseJsonLd($) || {};
  const mainFeatures = extractMainFeatures(html);
  const featureByLabel = (label) => Object.values(mainFeatures).find((f) => f.label === label)?.value;

  const priceRaw = extractDataLayerField(html, 'price'); // ej. "MN 4,790,000"
  const ageBodyMatch = $('body').text().match(/(\d+)\s*a[nñ]os? de antig|a estrenar/i);

  return {
    priceText: priceRaw,
    bedroomsText: houseLd.numberOfBedrooms != null ? String(houseLd.numberOfBedrooms) : '',
    bathroomsText: houseLd.numberOfBathroomsTotal != null ? String(houseLd.numberOfBathroomsTotal) : '',
    builtAreaText: featureByLabel('constr.') ? `${featureByLabel('constr.')} m2` : '',
    landAreaText: featureByLabel('lote') ? `${featureByLabel('lote')} m2` : '',
    ageText: ageBodyMatch ? (ageBodyMatch[1] || '0') : '',
    colonia: extractDataLayerField(html, 'neighborhood') || houseLd.address?.addressRegion || '',
    title: houseLd.name || '',
    photos: houseLd.image ? [houseLd.image] : [],
  };
}

// enrichDetail por defecto en true: confirmado que el listado NO trae precio
// (ver parseSearchResultsPage) — sin la página de detalle no hay dato
// publicable. Desactivarlo solo sirve para probar el parseo del listado solo.
export async function crawlInmuebles24({ maxPages = 10, requestDelayMs = 2500, enrichDetail = true } = {}) {
  const results = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage && page <= maxPages) {
    const url = page === 1 ? `${BASE_URL}${SEARCH_PATH}` : `${BASE_URL}${SEARCH_PATH.replace('.html', `-pagina-${page}.html`)}`;
    try {
      const { data: html } = await getWithBackoff(url, { logPrefix: 'inmuebles24' });
      const { cards, maxPageSeen } = parseSearchResultsPage(html);
      hasNextPage = page < maxPageSeen;

      for (const raw of cards) {
        let detail = {};
        if (enrichDetail && raw.sourceUrl) {
          await jitteredDelay(requestDelayMs);
          try {
            detail = await fetchDetail(raw.sourceUrl);
          } catch {
            detail = {};
          }
        }
        results.push({ ...raw, ...detail });
      }
    } catch (err) {
      console.error(`[inmuebles24] error en página ${page}: ${err.message}`);
      hasNextPage = false;
    }
    page += 1;
    await jitteredDelay(requestDelayMs);
  }

  return results;
}

export function toNormalizedListings(rawListings, locationResolver) {
  return rawListings.map((raw) => {
    const locationId = locationResolver(raw.colonia);
    return normalizeListing(raw, locationId);
  });
}
