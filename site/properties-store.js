// Shared property data store for Aquario Habitat demo (localStorage-backed).
if (!window.AHProperties) (function () {
const KEY = 'ah-properties';

const SEED = [
  { id: 'p1', title: 'Casa en Lomas de San Luis', segment: 'Residencial', propertyType: 'Casa', size: '220 m²', price: '$2.4M', pricePerSqm: '$10,909/m²', score: 92, lat: 22.1690, lng: -101.0050, top: '15%', left: '25%', address: 'Lomas de San Luis, San Luis Potosí', scoreNote: 'Precio 8% por debajo del promedio de la zona, con 9 comparables activos y plusvalía al alza.', recamaras: 3, banos: 3, estacionamientos: 2, amenidades: ['Cochera', 'Jardín', 'Seguridad 24h'], source: 'manual' },
  { id: 'p2', title: 'Local comercial en Centro', segment: 'Comercial', propertyType: 'Local comercial', size: '140 m²', price: '$3.1M', pricePerSqm: '$22,142/m²', score: 64, lat: 22.1521, lng: -100.9750, top: '20%', left: '75%', address: 'Centro Histórico, San Luis Potosí', scoreNote: 'Precio alineado al mercado; zona estable con buena liquidez.', recamaras: 0, banos: 2, estacionamientos: 4, amenidades: ['Seguridad 24h'], source: 'manual' },
  { id: 'p3', title: 'Terreno en Zona Industrial', segment: 'Industrial', propertyType: 'Nave industrial', size: '5,200 m²', price: '$5.6M', pricePerSqm: '$1,077/m²', score: 88, lat: 22.2050, lng: -100.9200, top: '35%', left: '60%', address: 'Zona Industrial, San Luis Potosí', scoreNote: 'Precio 18% por debajo del promedio de la zona, con tendencia al alza (+6% trimestral).', recamaras: 0, banos: 1, estacionamientos: 8, amenidades: [], source: 'manual' },
  { id: 'p4', title: 'Depto en Valle Dorado', segment: 'Residencial', propertyType: 'Departamento', size: '95 m²', price: '$1.8M', pricePerSqm: '$18,947/m²', score: 71, lat: 22.1400, lng: -100.9600, top: '55%', left: '40%', address: 'Valle Dorado, San Luis Potosí', scoreNote: 'Buena ubicación, precio ligeramente por debajo del promedio.', recamaras: 2, banos: 2, estacionamientos: 1, amenidades: ['Alberca', 'Seguridad 24h', 'Aire acondicionado'], source: 'manual' },
  { id: 'p5', title: 'Rancho en Villa de Reyes', segment: 'Ranchos', propertyType: 'Rancho', size: '4.2 ha', price: '$4.0M', pricePerSqm: '$952/m²', score: 55, lat: 21.8100, lng: -100.9900, top: '80%', left: '30%', address: 'Villa de Reyes, San Luis Potosí', scoreNote: 'Precio de mercado, pocos comparables activos en la zona.', recamaras: 4, banos: 2, estacionamientos: 3, amenidades: ['Cochera'], source: 'manual' },
  { id: 'p6', title: 'Terreno en Zona Industrial 2', segment: 'Terrenos', propertyType: 'Terreno', size: '3,000 m²', price: '$2.9M', pricePerSqm: '$967/m²', score: 79, lat: 22.2250, lng: -100.9350, top: '40%', left: '65%', address: 'Zona Industrial, San Luis Potosí', scoreNote: 'Precio 26% por debajo del promedio de la zona; alta demanda industrial.', recamaras: 0, banos: 0, estacionamientos: 0, amenidades: [], source: 'manual' },
  { id: 'p7', title: 'Desarrollo Los Encinos', segment: 'Desarrollos', propertyType: 'Desarrollo residencial', size: '48 lotes', price: '$18.2M', pricePerSqm: '$3,120/m²', score: 81, lat: 22.1300, lng: -100.9450, top: '50%', left: '55%', address: 'Los Encinos, San Luis Potosí', scoreNote: 'Buen avance de obra y plusvalía proyectada al alza.', recamaras: 3, banos: 2, estacionamientos: 2, amenidades: ['Jardín', 'Seguridad 24h'], source: 'manual' }
];

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) { localStorage.setItem(KEY, JSON.stringify(SEED)); return SEED.slice(); }
    let parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return SEED.slice();
    // Migration: fix a previously overlapping seed coordinate for p6.
    let migrated = false;
    parsed = parsed.map(p => {
      if (p.id === 'p6' && p.lat === 22.2100 && p.lng === -100.9150) { migrated = true; return { ...p, lat: 22.2250, lng: -100.9350 }; }
      return p;
    });
    if (migrated) localStorage.setItem(KEY, JSON.stringify(parsed));
    // Migration: normalize every price to one display format ($X.XM / $XXXk), fixing
    // any previously-saved listing (crawler or manual) that used a different style.
    let reformatted = false;
    parsed = parsed.map(p => {
      const canonical = formatMoneyCompact(parsePrice(p.price));
      if (canonical !== p.price) { reformatted = true; return { ...p, price: canonical }; }
      return p;
    });
    if (reformatted) localStorage.setItem(KEY, JSON.stringify(parsed));
    return parsed;
  } catch (e) { return SEED.slice(); }
}

function save(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent('ah-properties-changed'));
}

function parsePrice(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  if (!isFinite(n)) return 0;
  return /M/i.test(str) ? n * 1e6 : /K/i.test(str) ? n * 1e3 : n;
}

// Single canonical display format for price everywhere ($X.XM / $XXXk / $X) so the
// map, sidebar, cards, etc. never show a mix of "$1.8M" and "$3,250,000".
function formatMoneyCompact(n) {
  if (!n) return '—';
  return '$' + Math.round(n).toLocaleString('es-MX');
}

// Short compact form ($X.XM / $XXXk) reserved for space-constrained spots (map pin
// labels) where full amounts collide — full amounts stay canonical everywhere else.
function formatMoneyCompactShort(priceStrOrNum) {
  const n = typeof priceStrOrNum === 'number' ? priceStrOrNum : parsePrice(priceStrOrNum);
  if (!n) return '—';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
  return '$' + Math.round(n);
}

function parseSize(str) {
  if (!str) return 0;
  const n = parseFloat(String(str).replace(/,/g, ''));
  return isFinite(n) ? n : 0;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Generates zone-derived analytical fields (avgZonePrice, comparables, scoreNote, score)
// from the rest of the store, so any property added/edited (manual or crawler) gets
// consistent analytics without needing a backend.
function computeAnalytics(prop, allProperties) {
  const price = parsePrice(prop.price);
  const sizeNum = parseSize(prop.size);
  const pricePerSqm = sizeNum > 0 ? price / sizeNum : 0;
  const comparables = allProperties.filter(p =>
    p.id !== prop.id &&
    p.segment === prop.segment &&
    typeof p.lat === 'number' && typeof prop.lat === 'number' &&
    haversineKm(p.lat, p.lng, prop.lat, prop.lng) <= 8
  );
  const comparablePricesPerSqm = comparables
    .map(p => { const s = parseSize(p.size); return s > 0 ? parsePrice(p.price) / s : null; })
    .filter(v => v != null && isFinite(v) && v > 0);
  const avgZonePricePerSqm = comparablePricesPerSqm.length
    ? comparablePricesPerSqm.reduce((s, v) => s + v, 0) / comparablePricesPerSqm.length
    : pricePerSqm;
  const avgZonePrice = avgZonePricePerSqm ? `$${Math.round(avgZonePricePerSqm).toLocaleString('es-MX')}/m²` : '—';
  const deltaPct = avgZonePricePerSqm > 0 ? Math.round(((pricePerSqm - avgZonePricePerSqm) / avgZonePricePerSqm) * 100) : 0;
  let score = 70;
  if (deltaPct <= -15) score = 90;
  else if (deltaPct <= -5) score = 80;
  else if (deltaPct <= 5) score = 68;
  else score = 55;
  if (comparables.length >= 4) score = Math.min(95, score + 5);
  const direction = deltaPct < 0 ? `${Math.abs(deltaPct)}% por debajo del promedio de la zona` :
    deltaPct > 0 ? `${deltaPct}% por encima del promedio de la zona` : 'alineado al promedio de la zona';
  const scoreNote = comparables.length
    ? `Precio ${direction}, con ${comparables.length} comparable${comparables.length === 1 ? '' : 's'} activo${comparables.length === 1 ? '' : 's'} en un radio de 8 km.`
    : 'Sin comparables suficientes en la zona; score estimado con datos limitados.';
  return {
    avgZonePrice,
    vsAvg: `${deltaPct > 0 ? '+' : ''}${deltaPct}%`,
    comparablesCount: comparables.length,
    comparableIds: comparables.map(p => p.id),
    zoneDeltaPct: deltaPct,
    pricePerSqm: pricePerSqm ? `$${Math.round(pricePerSqm).toLocaleString('es-MX')}/m²` : prop.pricePerSqm,
    score,
    scoreNote
  };
}

function add(prop) {
  const list = load();
  const id = 'p' + Date.now();
  const base = { id, score: 70, recamaras: 0, banos: 0, estacionamientos: 0, amenidades: [], source: 'manual', ...prop };
  if (base.price != null) base.price = formatMoneyCompact(parsePrice(base.price));
  const analytics = computeAnalytics(base, list);
  list.push({ ...base, ...analytics });
  save(list);
  return id;
}

function update(id, patch) {
  const list = load();
  const target = list.find(p => p.id === id);
  if (!target) return;
  if (patch.price != null) patch = { ...patch, price: formatMoneyCompact(parsePrice(patch.price)) };
  const merged = { ...target, ...patch };
  const analytics = computeAnalytics(merged, list);
  const updated = list.map(p => p.id === id ? { ...merged, ...analytics } : p);
  save(updated);
}

// Recomputes analytics for every property (e.g. after a crawler bulk import shifts zone averages).
function recomputeAllAnalytics() {
  const list = load();
  const updated = list.map(p => ({ ...p, ...computeAnalytics(p, list) }));
  save(updated);
}

function remove(id) {
  save(load().filter(p => p.id !== id));
}

const VERTICAL_TO_SEGMENT = { residential: 'Residencial', industrial: 'Industrial', land: 'Terrenos' };

// Maps a crawler-normalized listing (shape from crawler/src/normalize.js: sourceListingId,
// sourceUrl, title, price, landAreaSqm, builtAreaSqm, attributes{bedrooms,bathrooms,
// parking_spots,levels}, photos) + its resolved location/vertical to the flat shape
// properties-store.js/add() expects. Existing listings (same source+sourceListingId)
// are updated instead of duplicated, matching the DB's UNIQUE(source_id, source_listing_id).
function mapCrawlerListingToProperty(normalized, ctx) {
  const { vertical = 'residential', location = {}, propertyType, sourceName = 'inmuebles24' } = ctx || {};
  const sizeSqm = normalized.builtAreaSqm || normalized.landAreaSqm || 0;
  const attrs = normalized.attributes || {};
  return {
    title: normalized.title || 'Propiedad sin título',
    segment: VERTICAL_TO_SEGMENT[vertical] || 'Residencial',
    propertyType: propertyType || (vertical === 'land' ? 'Terreno' : vertical === 'industrial' ? 'Nave industrial' : 'Casa'),
    size: sizeSqm ? `${sizeSqm.toLocaleString('es-MX')} m²` : '',
    price: normalized.price ? formatMoneyCompact(normalized.price) : '—',
    lat: location.lat, lng: location.lng,
    address: [location.colonia, location.municipality].filter(Boolean).join(', ') || 'San Luis Potosí',
    recamaras: attrs.bedrooms || 0,
    banos: attrs.bathrooms || 0,
    estacionamientos: attrs.parking_spots || 0,
    amenidades: [],
    photos: normalized.photos || [],
    source: sourceName,
    sourceListingId: normalized.sourceListingId,
    sourceUrl: normalized.sourceUrl
  };
}

// Adds a mapped crawler listing, or updates it in place if that source+sourceListingId
// already exists (dedupe, mirroring the DB's UNIQUE constraint) instead of duplicating.
function upsertFromCrawler(normalized, ctx) {
  const mapped = mapCrawlerListingToProperty(normalized, ctx);
  const list = load();
  const existing = list.find(p => p.source === mapped.source && p.sourceListingId === mapped.sourceListingId);
  if (existing) { update(existing.id, mapped); return existing.id; }
  return add(mapped);
}

window.AHProperties = { load, save, add, update, remove, recomputeAllAnalytics, computeAnalytics, mapCrawlerListingToProperty, upsertFromCrawler, formatMoneyCompact, formatMoneyCompactShort, KEY };
})();
