# Crawler — Inmuebles24, Vivanuncios, Lamudi (residencial, San Luis Potosí)

Crawler multi-fuente para validar el pipeline completo: scraping →
normalización → `database/schema.sql`, antes de sumar Inmoapp, NetMex y
redes sociales. Cada fuente vive en su propio archivo
(`src/inmuebles24.js`, `src/vivanuncios.js`, `src/lamudi.js`) y comparte
anti-bloqueo + parsing JSON-LD desde `src/http.js`; `src/index.js` las corre
en serie contra la misma tabla `properties`, cada una con su fila propia en
`sources`.

## Qué hace

1. Recorre el listado de casas en venta en San Luis Potosí en cada fuente.
2. Extrae precio, m², recámaras/baños/estacionamientos, colonia y fotos.
3. Normaliza los textos crudos a tipos numéricos (`src/normalize.js`).
4. Upsert en `properties` por `(source_id, source_listing_id)`:
   - Nuevo → inserta y crea la primera fila en `price_history`.
   - Existente con precio distinto → actualiza y agrega fila a `price_history`
     (marca `status = 'price_reduced'` si bajó).
   - No visto en 48h → `status = 'sold_or_removed'`.

## Uso

```bash
cd crawler
cp .env.example .env   # completar DATABASE_URL
npm install
npm run once           # una corrida de las 3 fuentes y sale (para validar datos)
npm start               # corre cada CRAWL_INTERVAL_MINUTES indefinidamente
```

## Confirmado contra HTML real (jul 2026)

- **Inmuebles24** — URL de listado real: `/casas-en-venta-en-san-luis-potosi.html`
  (el slug combinado `casas-y-departamentos-en-venta-...` que se usaba antes
  no existe). Listado es SPA (JSON-LD `ItemList` sin precio); detalle
  (`/propiedades/clasificado/...html`) es SSR con JSON-LD `House`/`Apartment`
  + `const mainFeatures` (lote/constr. exactos — ojo, el `floorSize` del
  JSON-LD es terreno, no construido) + `const dataLayerInfo` (precio
  formateado, neighborhood/city). Paginación confirmada vía anchors
  `-pagina-N.html`.
- **Vivanuncios** — corre en la misma plataforma Navent que Inmuebles24
  (mismo CDN `img10.naventcdn.com`, mismo motor de listado; ambos del grupo
  QuintoAndar). `src/vivanuncios.js` reusa la misma estrategia JSON-LD;
  confirmado el listado real (`/s-casas-en-venta/san-luis-potosi-slp/...`) y
  que también es SPA sin precio. **No confirmado**: la estructura exacta del
  detalle (`mainFeatures`/`dataLayerInfo` asumidos iguales por compartir
  plataforma, pero no se leyó un detalle real) — validar en la primera
  corrida VPS.
- **Lamudi** — **sin confirmar del todo**: no se leyó HTML real de su
  listado/detalle (plataforma propia, no Navent). `src/lamudi.js` asume
  JSON-LD estándar `RealEstateListing`/`Product` con precio ya en el
  listado (a diferencia de las otras dos) y paginación por `?page=N`. Es la
  fuente con más riesgo de necesitar ajuste — correr `npm run once` con solo
  esta fuente primero y revisar cuántos listings quedan con `priceText`
  vacío antes de confiar en sus datos.

## Geocoding

`findOrCreateLocation` (`src/db.js`) resuelve `location_id` por
municipio+colonia: si la colonia ya existe en `locations` (constraint
`UNIQUE (municipality, colonia)`), reusa su `geom` sin tocar red; si es
nueva, geocodifica con Nominatim (`src/geocode.js`, ~1 req/seg, gratis) y
guarda lat/lng como `geom`. Así se geocodifica cada colonia una sola vez en
la vida del sistema, no por cada listing ni por cada corrida. Si el volumen
crece o Nominatim empieza a bloquear, cambiar a Google Geocoding API o
Mapbox — solo hay que reemplazar `geocodeColonia()`, nada más se acopla a
Nominatim.

## Anti-bloqueo

`src/http.js` implementa tres mitigaciones, compartidas por las tres fuentes:
- **Rotación de User-Agent**: 5 strings de navegador real, uno al azar por
  request (interceptor de axios). `CRAWL_USER_AGENT` en `.env` fuerza uno
  fijo para debug reproducible.
- **Delay con jitter**: `jitteredDelay()` varía ±40% sobre
  `CRAWL_REQUEST_DELAY_MS` para no dejar un patrón de tráfico regular.
- **Backoff ante 403/429**: `getWithBackoff()` reintenta hasta 3 veces con
  espera exponencial (5s, 10s, 20s) antes de dar la página por perdida.

## Investigación: cobertura por plataforma, México y EE.UU. (contexto del cliente)

No existe un portal (ni en México ni en EE.UU.) que cubra bien los ~8
segmentos del mercado inmobiliario a la vez. Mapa de cobertura tal como lo
trajo el cliente:

**México — generalistas** (✅ fuerte / ⚠️ débil o incompleto / ❌ no cubre):

| Plataforma | Casas | Deptos | Terrenos | Locales | Oficinas | Naves/Industrial | Ranchos |
|---|---|---|---|---|---|---|---|
| Inmuebles24 | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| Propiedades.com | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| Vivanuncios | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ⚠️ |
| Lamudi | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| Facebook Marketplace | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Los 4 portales que ya cubre el crawler (Inmuebles24/Propiedades.com/
Vivanuncios/Lamudi) son sólidos en residencial/comercial pero **flojos en
industrial y ranchos** — ese hueco solo lo llena bien Facebook Marketplace
(no estructurado, mucho más difícil de rastrear) y jugadores nicho:
"Propiedades Industriales" y marketplaces de parques industriales (naves,
BTS, terrenos industriales — muy fragmentado), o `ectarea` para lotes/
desarrollos. No hay equivalente mexicano de Land.com para terrenos/ranchos.

**EE.UU. — el mercado sí está especializado por vertical:**

| Vertical | Plataformas líderes | Dato distintivo que capturan |
|---|---|---|
| Residencial | Zillow, Realtor.com, Redfin, Homes.com | Zestimate, historial de precios, escuelas, impuestos |
| Comercial | LoopNet, CREXi, CommercialSearch, Brevitas | Cap rate, NOI, zonificación |
| Industrial | LoopNet | Altura libre, dock doors, potencia eléctrica, planos |
| Terrenos | Land.com, LandWatch, LandSearch, LandApp | Tipo de suelo, uso agrícola, recursos hídricos, topografía |
| Ranchos | Land.com, Land And Farm, LandWatch | Bosques, caza, ganadería |

## Features concretas para el roadmap (visión del cliente: "Motor Nacional de Inteligencia Inmobiliaria")

No competir solo en residencial — agregar todos los segmentos y generar
inteligencia (no solo mostrar anuncios). Ver también `Vision-Plataforma-
Inmobiliaria.dc.html` sección 03b.

1. **Campo `property_segment`** en `properties` (residencial / comercial /
   industrial / terreno / rancho) desde el crawler — cada fuente ya lo puede
   inferir del tipo de listado.
2. **Comps por segmento**: `price_per_sqm` ya existe para residencial;
   comercial, industrial y terreno necesitan su propio comparable — no
   mezclar en el mismo promedio.
3. **Datos técnicos que el crawler no captura hoy**, agrupados por vertical:
   - Industrial: altura libre, andenes/dock doors, potencia eléctrica,
     capacidad de piso, certificaciones.
   - Terreno/campo: uso de suelo, régimen (privado/ejidal), acceso a agua/
     riego, topografía, acceso vial.
   - Comercial: cap rate, NOI, zonificación.
4. **Fuente adicional candidata**: evaluar Facebook Marketplace (único fuerte
   en todos los segmentos en México, pero no estructurado — mayor riesgo de
   scraping) y/o Mercado Libre Inmuebles para reforzar industrial/terrenos,
   antes de asumir que Inmuebles24/Vivanuncios/Lamudi cubren bien ese hueco.
5. **Capa de inteligencia (v2+, no scraping)**: valor de reposición, ROI,
   riesgo hídrico/sísmico, disponibilidad eléctrica, cercanía a puertos/
   aeropuertos/vías férreas — inspirado en lo que LoopNet y Land.com ya
   calculan sobre su propio inventario.

## Pendiente antes de producción
- **Validación de datos**: antes de expandir a otra vertical, correr
  `npm run once` unas cuantas veces por fuente y revisar en `properties` que
  precio, m² y `price_per_sqm` generado tengan sentido (sin outliers de
  parsing) — Lamudi en particular (ver arriba, sin confirmar contra HTML real).
- **Programación real**: `setInterval` alcanza para el piloto; en KVM 2 con
  más fuentes conviene systemd timer o cron por fuente para no competir por
  CPU/red en la misma ventana de 15–30 min.
