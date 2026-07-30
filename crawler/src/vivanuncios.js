import * as cheerio from 'cheerio';
import { normalizeListing } from './normalize.js';
import { getWithBackoff, jitteredDelay, extractJsonLdBlocks } from './http.js';

const BASE_URL = 'https://www.vivanuncios.com.mx';
// CONFIRMADO jul 2026: Vivanuncios corre en la misma plataforma Navent que
// Inmuebles24 (mismo CDN img10.naventcdn.com, mismo motor de listado RPLIS)
// — ambos son propiedad de QuintoAndar. Por eso listado y detalle comparten
// la misma estructura JSON-LD; este archivo es casi un calco de
// inmuebles24.js con solo BASE_URL/paths/regex de id ajustados.
const SEARCH_PATH = '/s-casas-en-venta/san-luis-potosi-slp/v1c1293l11834p1';

// A diferencia de Inmuebles24 (slug-id.html), el id de Vivanuncios es el
// último segmento numérico de la URL sin extensión, ej.
// /a-venta-casa/rinconada-de-los-andes/casa-.../149748165
function extractListingId(url) {
  return url.match(/\/(\d+)(?:\?|$)/)?.[1] || null;
}

function parseSearchResultsPage(html) {
  const $ = cheerio.load(html);
  const cards = [];

  const jsonLdBlocks = extractJsonLdBlocks($);
  const itemList = jsonLdBlocks.find((b) => b['@type'] === 'ItemList' || Array.isArray(b?.itemListElement));

  for (const item of itemList?.itemListElement || []) {
    const entry = item.item || item;
    const sourceUrl = entry.url ? new URL(entry.url, BASE_URL).toString() : null;
    const sourceListingId = sourceUrl ? extractListingId(sourceUrl) : null;
    if (!sourceListingId) continue;

    cards.push({
      sourceListingId,
      sourceUrl,
      title: entry.name || '',
      descriptionText: entry.description || '',
      priceText: '',
      builtAreaText: '',
      landAreaText: '',
      bedroomsText: '',
      bathroomsText: '',
      parkingText: '',
      colonia: '',
      photos: entry.image ? [entry.image] : [],
    });
  }

  // Igual que Inmuebles24: se busca el número de página más alto visible en
  // anchors de paginación (patrón "...p{N}") para saber si seguir. Sin
  // confirmar aún contra un listado real con >1 página (pendiente validar
  // en VPS) — por default conservador, si no se detecta ninguno se asume
  // una sola página.
  const pageNumbers = [];
  $(`a[href*="v1c1293l11834p"]`).each((_, el) => {
    const m = ($(el).attr('href') || '').match(/v1c1293l11834p(\d+)/);
    if (m) pageNumbers.push(Number(m[1]));
  });
  const maxPageSeen = pageNumbers.length ? Math.max(...pageNumbers) : 1;
  return { cards, maxPageSeen };
}

// CONFIRMADO jul 2026: el detalle también es SSR (mismo motor que Inmuebles24)
// con JSON-LD House/Apartment. mainFeatures/dataLayerInfo no se confirmaron
// literalmente en Vivanuncios (no se leyó un detalle real todavía) — se
// intenta igual porque comparten plataforma; si fallan quedan como '' y no
// rompen el crawl. Validar contra un detalle real en la primera corrida VPS.
function extractHouseJsonLd($) {
  return extractJsonLdBlocks($).find((b) =>
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
  const { data: html } = await getWithBackoff(sourceUrl, { logPrefix: 'vivanuncios' });
  const $ = cheerio.load(html);

  const houseLd = extractHouseJsonLd($) || {};
  const mainFeatures = extractMainFeatures(html);
  const featureByLabel = (label) => Object.values(mainFeatures).find((f) => f.label === label)?.value;

  const priceRaw = extractDataLayerField(html, 'price');
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

export async function crawlVivanuncios({ maxPages = 10, requestDelayMs = 2500, enrichDetail = true } = {}) {
  const results = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage && page <= maxPages) {
    const url = `${BASE_URL}${SEARCH_PATH.replace(/p\d+$/, `p${page}`)}`;
    try {
      const { data: html } = await getWithBackoff(url, { logPrefix: 'vivanuncios' });
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
      console.error(`[vivanuncios] error en página ${page}: ${err.message}`);
      hasNextPage = false;
    }
    page += 1;
    await jitteredDelay(requestDelayMs);
  }

  return results;
}

export function toNormalizedListings(rawListings, locationResolver) {
  return rawListings.map((raw) => normalizeListing(raw, locationResolver(raw.colonia)));
}
