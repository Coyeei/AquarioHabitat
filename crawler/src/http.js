// Cliente HTTP compartido entre fuentes (Inmuebles24, Vivanuncios, Lamudi):
// rotación de User-Agent, delay con jitter y backoff ante 403/429. Cada
// fuente reusa esto en vez de reimplementar su propio anti-bloqueo.

import axios from 'axios';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

function randomUserAgent() {
  if (process.env.CRAWL_USER_AGENT) return process.env.CRAWL_USER_AGENT;
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export const client = axios.create({ timeout: 15000 });
client.interceptors.request.use((config) => {
  config.headers = { ...config.headers, 'User-Agent': randomUserAgent() };
  return config;
});

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// +/-40% de jitter alrededor del delay configurado, para que el espaciado
// entre requests no sea un patrón perfectamente regular.
export function jitteredDelay(baseMs) {
  const jitter = baseMs * 0.4;
  return delay(baseMs - jitter + Math.random() * jitter * 2);
}

// Backoff ante 403/429 (bloqueo o rate-limit): reintenta con espera creciente
// en vez de tronar la página completa por un bloqueo temporal.
export async function getWithBackoff(url, { retries = 3, baseDelayMs = 5000, logPrefix = 'http' } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await client.get(url);
    } catch (err) {
      const status = err.response?.status;
      const blocked = status === 403 || status === 429;
      if (!blocked || attempt === retries) throw err;
      const wait = baseDelayMs * Math.pow(2, attempt);
      console.warn(`[${logPrefix}] ${status} en ${url} — reintento ${attempt + 1}/${retries} en ${wait}ms`);
      await delay(wait);
    }
  }
}

export function extractJsonLdBlocks($) {
  const blocks = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      blocks.push(JSON.parse($(el).contents().text()));
    } catch {
      // JSON-LD malformado o parcial — se ignora ese bloque, no toda la página.
    }
  });
  return blocks;
}
