// Bloqueo de bots de scraping.
//
// - Solo se aceptan los buscadores (Google, Bing, Apple) y las vistas previas al compartir el enlace
//   (WhatsApp, Facebook, Telegram, X). Todo lo demás que se declare bot, o no diga qué navegador es, recibe 403.
// - Quien dice ser Googlebot, Bingbot o Applebot se verifica con DNS inverso: un scraper puede copiar el nombre, no la IP.
// - Límite de solicitudes por IP (sin sesión) para frenar descargas masivas desde navegadores automatizados.
// - robots.txt dice lo mismo a los bots que sí lo respetan.
//
// Nota: ningún bloqueo es 100 % efectivo contra un navegador real manejado por una persona;
// por eso la web además publica pocos datos (10 productos, sin buscador ni API pública).
import dns from 'node:dns/promises';

const ENABLED = process.env.BLOQUEO_BOTS !== 'false';
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = Number(process.env.LIMITE_SOLICITUDES_MINUTO) || 120;
const DNS_TTL_MS = 24 * 60 * 60 * 1000;

// Buscadores permitidos: nombre en el User-Agent -> dominios válidos de su DNS inverso.
const SEARCH_ENGINES = [
  { ua: /googlebot|google-inspectiontool|googleother|adsbot-google|mediapartners-google|google-site-verification/i, hosts: ['.googlebot.com', '.google.com', '.googleusercontent.com'] },
  { ua: /bingbot|msnbot|adidxbot|bingpreview/i, hosts: ['.search.msn.com'] },
  { ua: /applebot/i, hosts: ['.applebot.apple.com'] },
];

// Vistas previas de enlaces: solo leen la portada para mostrar título, descripción e imagen.
const LINK_PREVIEWS = /whatsapp|facebookexternalhit|facebookcatalog|telegrambot|twitterbot|slackbot|linkedinbot/i;

// Scrapers, herramientas SEO, bots de IA y librerías HTTP.
// "bot" solo como nombre de bot ("XBot/1.0", "compatible; bot)"), para no bloquear celulares como "CUBOT P40".
const BLOCKED = new RegExp('bot[/;)]|[\\s_-]bot\\b|' + [
  'crawl', 'spider', 'scrap', 'slurp', 'fetch', 'archiver', 'httrack', 'harvest', 'extract', 'collector',
  'curl', 'wget', 'python', 'aiohttp', 'httpx', 'scrapy', 'go-http-client', 'java/', 'okhttp', 'apache-httpclient',
  'node-fetch', 'axios', 'undici', 'got/', 'libwww', 'perl', 'ruby', 'php', 'guzzle', 'postman', 'insomnia', 'powershell',
  'headless', 'phantomjs', 'puppeteer', 'playwright', 'selenium', 'webdriver', 'electron',
  'gpt', 'ccbot', 'claude', 'anthropic', 'perplexity', 'bytespider', 'amazonbot', 'cohere', 'diffbot', 'omgili',
  'ahrefs', 'semrush', 'mj12', 'dotbot', 'petalbot', 'yandex', 'baidu', 'sogou', 'seznam', 'dataforseo', 'screaming frog',
].map(w => w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|'), 'i');

const BROWSER = /mozilla\/5\.0/i;

export const ROBOTS_TXT = `# Santiago Filtros
# Solo se permite indexar a los buscadores. No se autoriza el scraping ni el uso del contenido para entrenar IA.

User-agent: Googlebot
User-agent: Googlebot-Image
User-agent: Bingbot
User-agent: Applebot
Allow: /
Disallow: /app
Disallow: /api/
Disallow: /cotizar/
Disallow: /catalogo/

User-agent: *
Disallow: /

Sitemap: ${(process.env.SITE_URL || 'https://santiagofiltros.cl').replace(/\/$/, '')}/sitemap.xml
`;

// ---------------------------------------------------------------- Verificación de buscadores
const verified = new Map(); // ip -> { ok, expires }

async function verifySearchEngine(ip, hosts) {
  const cached = verified.get(ip);
  if (cached && cached.expires > Date.now()) return cached.ok;
  let ok = false;
  try {
    const names = await dns.reverse(ip);
    const host = names.find(n => hosts.some(h => n.toLowerCase().endsWith(h)));
    if (host) {
      const { address } = await dns.lookup(host, { family: ip.includes(':') ? 6 : 4 });
      ok = address === ip;
    }
  } catch { ok = false; }
  verified.set(ip, { ok, expires: Date.now() + DNS_TTL_MS });
  return ok;
}

// ---------------------------------------------------------------- Límite por IP
const hits = new Map(); // ip -> { count, reset }

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.reset <= now) {
    hits.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of hits) if (e.reset <= now) hits.delete(ip);
  for (const [ip, e] of verified) if (e.expires <= now) verified.delete(ip);
}, RATE_WINDOW_MS).unref();

const deny = (res, status, text) => res.status(status).type('text/plain; charset=utf-8').set('Cache-Control', 'no-store').send(text);

export async function blockBots(req, res, next) {
  if (!ENABLED || req.path === '/robots.txt') return next();
  const ua = req.get('User-Agent') || '';
  const ip = req.ip;

  const engine = SEARCH_ENGINES.find(e => e.ua.test(ua));
  if (engine) {
    if (req.path.startsWith('/api/') || req.path === '/app' || req.path === '/acceso-sf') return deny(res, 403, 'Acceso no permitido.');
    return (await verifySearchEngine(ip, engine.hosts)) ? next() : deny(res, 403, 'Acceso no permitido.');
  }
  if (LINK_PREVIEWS.test(ua)) {
    return req.method === 'GET' && (req.path === '/' || req.path.startsWith('/cotizar/') || req.path.startsWith('/catalogo/') || req.path.startsWith('/uploads/') || req.path.startsWith('/img/'))
      ? next() : deny(res, 403, 'Acceso no permitido.');
  }
  if (!BROWSER.test(ua) || BLOCKED.test(ua)) return deny(res, 403, 'Acceso no permitido.');
  return next();
}

// Va después de las sesiones: el personal con sesión iniciada no tiene límite (el sistema carga muchas fotos y archivos).
export function limitRate(req, res, next) {
  if (!ENABLED || req.session?.uid || req.path.startsWith('/api/')) return next();
  if (rateLimited(req.ip)) {
    res.set('Retry-After', '60');
    return deny(res, 429, 'Demasiadas solicitudes. Intenta de nuevo en un minuto.');
  }
  return next();
}
