-- Inteligencia Inmobiliaria MX — esquema inicial del piloto (San Luis Potosí)
-- Verticales: residencial, industrial, campo. Motor: PostgreSQL + PostGIS.

CREATE EXTENSION IF NOT EXISTS postgis;

-- ── Catálogos ────────────────────────────────────────────────────────────

CREATE TABLE sources (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,          -- 'inmuebles24', 'vivanuncios', 'lamudi', 'inmoapp', 'netmex', 'facebook_marketplace', 'instagram'
  type          TEXT NOT NULL,                 -- 'portal' | 'social' | 'convenio'
  base_url      TEXT,
  crawl_interval_minutes INTEGER NOT NULL DEFAULT 20,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id            SERIAL PRIMARY KEY,
  state         TEXT NOT NULL DEFAULT 'San Luis Potosí',
  municipality  TEXT NOT NULL,
  colonia       TEXT,
  postal_code   TEXT,
  geom          geometry(Point, 4326),         -- coordenadas GPS
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (municipality, colonia)                -- una fila por colonia: geocoding se cachea aquí
);
CREATE INDEX locations_geom_idx ON locations USING GIST (geom);

-- ── Propiedades ──────────────────────────────────────────────────────────

CREATE TYPE property_vertical AS ENUM ('residential', 'industrial', 'land');
CREATE TYPE property_status AS ENUM ('active', 'price_reduced', 'sold_or_removed', 'stale');

CREATE TABLE properties (
  id                 SERIAL PRIMARY KEY,
  source_id          INTEGER NOT NULL REFERENCES sources(id),
  source_listing_id  TEXT,                     -- id/slug del anuncio en la fuente original
  source_url         TEXT,
  location_id        INTEGER REFERENCES locations(id),
  vertical           property_vertical NOT NULL,
  title              TEXT,
  price              NUMERIC(14,2) NOT NULL,
  currency           TEXT NOT NULL DEFAULT 'MXN',
  land_area_sqm      NUMERIC(12,2),
  built_area_sqm     NUMERIC(12,2),
  price_per_sqm      NUMERIC(12,2) GENERATED ALWAYS AS (
    price / NULLIF(COALESCE(built_area_sqm, land_area_sqm), 0)
  ) STORED,
  age_years          INTEGER,
  status             property_status NOT NULL DEFAULT 'active',
  -- Atributos específicos por vertical (flexible en el piloto; se normalizan a
  -- columnas propias si un campo se vuelve crítico para consultas/índices):
  --   residential: {bedrooms, bathrooms, parking_spots, levels}
  --   industrial:  {clear_height_m, loading_docks, industrial_zone, power_capacity_kva}
  --   land:        {land_use, tenure_regime, road_access, has_water_access}
  attributes         JSONB NOT NULL DEFAULT '{}',
  photos             TEXT[],
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_listing_id)
);
CREATE INDEX properties_vertical_idx ON properties (vertical);
CREATE INDEX properties_location_idx ON properties (location_id);
CREATE INDEX properties_attributes_idx ON properties USING GIN (attributes);

CREATE TABLE price_history (
  id            SERIAL PRIMARY KEY,
  property_id   INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  price         NUMERIC(14,2) NOT NULL,
  price_per_sqm NUMERIC(12,2),
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX price_history_property_idx ON price_history (property_id, recorded_at);

CREATE TABLE comparables (
  id                    SERIAL PRIMARY KEY,
  property_id           INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  comparable_property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  similarity_score      NUMERIC(5,4),          -- 0..1
  distance_m            NUMERIC(10,2),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, comparable_property_id)
);

-- ── Valuación (estadística de comparables + explicación por LLM) ─────────

CREATE TABLE valuations (
  id                SERIAL PRIMARY KEY,
  property_id       INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  estimated_value   NUMERIC(14,2) NOT NULL,
  range_low         NUMERIC(14,2) NOT NULL,
  range_high        NUMERIC(14,2) NOT NULL,
  confidence        NUMERIC(4,3),              -- 0..1
  method            TEXT NOT NULL DEFAULT 'comparables_stat_v1',
  explanation_text  TEXT,                      -- generado por el LLM
  comparable_ids    INTEGER[],
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX valuations_property_idx ON valuations (property_id, created_at DESC);

-- ── Motor de oportunidades ────────────────────────────────────────────────

CREATE TABLE opportunity_scores (
  id                SERIAL PRIMARY KEY,
  property_id       INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  price_score       NUMERIC(5,2),
  location_score    NUMERIC(5,2),
  appreciation_score NUMERIC(5,2),
  liquidity_score   NUMERIC(5,2),
  final_score       NUMERIC(5,2) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX opportunity_scores_property_idx ON opportunity_scores (property_id, created_at DESC);
CREATE INDEX opportunity_scores_final_idx ON opportunity_scores (final_score DESC);

-- ── Usuarios, alertas y analista IA ───────────────────────────────────────

CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  name            TEXT,
  email           TEXT UNIQUE,
  phone_whatsapp  TEXT,
  profile         TEXT,                        -- 'investor' | 'agent' | 'buyer' | 'developer' | 'company'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alerts (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description   TEXT NOT NULL,                 -- criterio en lenguaje natural, tal como lo escribió el usuario
  criteria      JSONB NOT NULL,                 -- criterio estructurado (vertical, zona, precio min/max, m² min, etc.)
  channel       TEXT NOT NULL DEFAULT 'email',  -- 'email' | 'whatsapp' | 'both'
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_matches (
  id            SERIAL PRIMARY KEY,
  alert_id      INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  property_id   INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  notified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (alert_id, property_id)
);

CREATE TABLE ai_conversations (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  question      TEXT NOT NULL,
  answer        TEXT NOT NULL,
  referenced_property_ids INTEGER[],
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
