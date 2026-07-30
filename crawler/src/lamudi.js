import * as cheerio from 'cheerio';
import { normalizeListing } from './normalize.js';
import { getWithBackoff, jitteredDelay, extractJsonLdBlocks } from './http.js';

// SIN CONFIRMAR contra HTML real todavía (a diferencia de inmuebles24.js y
// vivanuncios.js) — Lamudi corre en su propia plataforma (no Navent), no se
// leyó un guardado real de su listado/detalle. Esta implementación asume
// las convenciones más comunes de portales inmobiliarios (JSON-LD
// RealEstateListing/Product tanto en listado como en detalle, más un id de
// anuncio numérico al final de la URL) — VALIDAR con `npm run once` contra
// una corrida real en la VPS antes de confiar en sus datos; si el listado
// resulta ser SPA como Inmuebles24, esta misma lógica de JSON-LD debería
// seguir sirviendo para el detalle, solo cambiaría dónde vive el precio.
const BASE_URL = 'https://www.lamudi.com.mx';
const SEARCH_PATH = '/san-luis-potosi/san-luis-potosi-1/casa/for-sale/';

function extractListingId(url) {
  return url.match(/-(\d+)(?:\/|\?|$)/)?.[1] || url.match(/\/(\d+)(?:\/|\?|$)/)?.[1] || null;
}

function parseSearchResultsPage(html) {
  const $ = cheerio.load(html);
  const cards = [];
  const jsonLdBlocks = extractJsonLdBlocks($);

  const itemList = jsonLdBlocks.find((b) => b['@type'] === 'ItemList' || Array.isArray(b?.itemListElement));
  const singleListings = jsonLdBlocks.filter((b) =>
    ['House', 'Apartment', 'SingleFamilyResidence', 'Product', 'RealEstateListing'].includes(b['@type'])
  );
  const entries = itemList?.itemListElement?.map((it) => it.item || it) || singleListings;

  for (const entry of entries) {
    const sourceUrl = entry.url ? new URL(entry.url, BASE_URL).toString() : null;
    const sourceListingId = sourceUrl ? extractListingId(sourceUrl) : null;
    if (!sourceListingId) continue;

    const priceRaw = entry.offers?.price ?? entry.offers?.priceSpecification?.price ?? '';
    cards.push({
      sourceListingId,
      sourceUrl,
      title: entry.name || '',
      descriptionText: entry.description || '',
      priceText: priceRaw ? String(priceRaw) : '',
      builtAreaText: entry.floorSize?.value ? `${entry.floorSize.value} m2` : '',
      landAreaText: '',
      bedroomsText: entry.numberOfBedrooms != null ? String(entry.numberOfBedrooms) : '',
      bathroomsText: entry.numberOfBathroomsTotal != null ? String(entry.numberOfBathroomsTotal) : '',
      parkingText: '',
      colonia: entry.address?.addressLocality || '',
      photos: entry.image ? [entry.image] : [],
    });
  }

  // Sin confirmar patrón de paginación real — se asume ?page=N hasta no
  // tener un HTML real que diga lo contrario (ver nota arriba del archivo).
  const pageNumbers = [];
  $('a[href*="page="]').each((_, el) => {
    const m = ($(el).attr('href') || '').match(/[?&]page=(\d+)/);
    if (m) pageNumbers.push(Number(m[1]));
  });
  const maxPageSeen = pageNumbers.length ? Math.max(...pageNumbers) : 1;
  return { cards, maxPageSeen };
}

async function fetchDetail(sourceUrl) {
  const { data: html } = await getWithBackoff(sourceUrl, { logPrefix: 'lamudi' });
  const $ = cheerio.load(html);
  const jsonLdBlocks = extractJsonLdBlocks($);
  const listingLd = jsonLdBlocks.find((b) =>
    ['House', 'Apartment', 'SingleFamilyResidence', 'Product', 'RealEstateListing'].includes(b['@type'])
  ) || {};

  const priceRaw = listingLd.offers?.price ?? listingLd.offers?.priceSpecification?.price ?? '';

  return {
    priceText: priceRaw ? String(priceRaw) : '',
    bedroomsText: listingLd.numberOfBedrooms != null ? String(listingLd.numberOfBedrooms) : '',
    bathroomsText: listingLd.numberOfBathroomsTotal != null ? String(listingLd.numberOfBathroomsTotal) : '',
    builtAreaText: listingLd.floorSize?.value ? `${listingLd.floorSize.value} m2` : '',
    landAreaText: '',
    colonia: listingLd.address?.addressLocality || '',
    title: listingLd.name || '',
    photos: listingLd.image ? [listingLd.image] : [],
  };
}

export async function crawlLamudi({ maxPages = 10, requestDelayMs = 2500, enrichDetail = true } = {}) {
  const results = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage && page <= maxPages) {
    const url = page === 1 ? `${BASE_URL}${SEARCH_PATH}` : `${BASE_URL}${SEARCH_PATH}?page=${page}`;
    try {
      const { data: html } = await getWithBackoff(url, { logPrefix: 'lamudi' });
      const { cards, maxPageSeen } = parseSearchResultsPage(html);
      hasNextPage = page < maxPageSeen;

      for (const raw of cards) {
        let detail = {};
        // Si el listado ya trae precio (a diferencia de Inmuebles24/Vivanuncios,
        // Lamudi podría no ser SPA), no vale la pena pagar el request de detalle.
        if (enrichDetail && raw.sourceUrl && !raw.priceText) {
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
      console.error(`[lamudi] error en página ${page}: ${err.message}`);
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
