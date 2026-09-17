// Logo de la empresa para documentos PDF.
//
// El logo se configura como URL pública y puede ser PNG, JPG, WEBP, SVG o GIF, pero pdfkit
// solo acepta PNG o JPG. Por eso se descarga una vez, se convierte a PNG y se guarda en
// uploads/empresa/. Así cada PDF sale rápido aunque el sitio del logo sea lento o esté caído.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const CACHE_DIR = path.resolve(process.env.UPLOADS_DIR ? path.join(process.env.UPLOADS_DIR, '..', 'empresa') : 'uploads/empresa');
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 30000; // algunos hostings de imágenes tardan más de 10 s en responder
const ATTEMPTS = 2;
const RETRY_AFTER_MS = 60 * 1000; // tras un fallo, reintentar en un minuto (no en cada PDF)
const LOGO_PX = 320;

const memory = new Map(); // url -> Buffer PNG
const failures = new Map(); // url -> fecha del último fallo
const inFlight = new Map(); // url -> Promise en curso (evita descargas duplicadas simultáneas)

const cacheFile = url => path.join(CACHE_DIR, `logo-${LOGO_PX}-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 16)}.png`);

async function download(url) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await downloadOnce(url);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function downloadOnce(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'User-Agent': 'SantiagoFiltros-Gestion/2.0', Accept: 'image/*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('Logo demasiado grande');
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_BYTES) throw new Error('Logo demasiado grande');
  return data;
}

async function toPng(data) {
  // density alta para que los SVG se rasterizen nítidos; fondo transparente conservado.
  return sharp(data, { density: 300, limitInputPixels: 40_000_000 })
    .resize(LOGO_PX, LOGO_PX, { fit: 'inside', withoutEnlargement: false })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
}

async function fetchAndStore(url) {
  const png = await toPng(await download(url));
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cacheFile(url), png);
  memory.set(url, png);
  failures.delete(url);
  return png;
}

/**
 * Devuelve el logo como PNG listo para pdfkit, o null si no hay logo usable.
 * Nunca lanza error: un logo caído no debe impedir generar el documento.
 */
export async function getLogoPng(url) {
  if (!/^https?:\/\//i.test(url || '')) return null;
  if (memory.has(url)) return memory.get(url);
  try {
    const png = await fs.readFile(cacheFile(url));
    memory.set(url, png);
    return png;
  } catch { /* aún no está en disco */ }
  if (Date.now() - (failures.get(url) ?? 0) < RETRY_AFTER_MS) return null;
  if (!inFlight.has(url)) {
    inFlight.set(url, fetchAndStore(url)
      .catch(err => {
        failures.set(url, Date.now());
        console.warn(`No se pudo preparar el logo (${url}): ${err.message}`);
        return null;
      })
      .finally(() => inFlight.delete(url)));
  }
  return inFlight.get(url);
}

/** Descarga y convierte el logo apenas se guarda la configuración (sin bloquear la respuesta). */
export function prepareLogo(url) {
  if (!/^https?:\/\//i.test(url || '')) return;
  memory.delete(url);
  failures.delete(url);
  getLogoPng(url);
}
