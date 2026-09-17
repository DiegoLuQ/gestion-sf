// Subida, optimización, borrado y entrega de imágenes de productos.
//
// Toda imagen subida (JPG, PNG o WEBP) se guarda como WEBP optimizado:
//  - máximo 1200 px por lado (las imágenes más chicas no se agrandan),
//  - calidad 80, sin metadatos (GPS, cámara) y con la orientación del celular corregida,
//  - la transparencia de los PNG se conserva.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { db } from './db.js';
import { ApiError } from './errores.js';
import { MODULES, canWrite } from './modules.js';

export const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || 'uploads/productos');
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_SIDE = 1200;
const WEBP_QUALITY = 80;
const EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

export function looksLikeImage(buf) {
  return (buf[0] === 0xff && buf[1] === 0xd8) // JPG
    || buf.subarray(0, 4).toString('latin1') === '\x89PNG'
    || buf.subarray(8, 12).toString('latin1') === 'WEBP';
}

/**
 * Lee los parámetros de encuadre que envía el formulario.
 *  - recorte: {x, y, width, height} en píxeles de la imagen ya orientada (como la ve el navegador).
 *  - modo 'completa': la imagen entera centrada en un cuadrado con bordes blancos.
 * Sin ninguno de los dos, la imagen se guarda con su proporción original.
 */
export function parseEncuadre({ recorte, modo } = {}) {
  if (modo === 'completa') return { square: true };
  if (!recorte) return {};
  let crop = recorte;
  if (typeof crop === 'string') {
    try { crop = JSON.parse(crop); } catch { throw new ApiError('Recorte inválido.'); }
  }
  const nums = ['x', 'y', 'width', 'height'].map(k => Number(crop?.[k]));
  if (nums.some(n => !Number.isFinite(n)) || nums[2] < 10 || nums[3] < 10 || nums[0] < -1 || nums[1] < -1) {
    throw new ApiError('Recorte inválido.');
  }
  return { crop: { x: nums[0], y: nums[1], width: nums[2], height: nums[3] } };
}

/**
 * Convierte una imagen a WEBP optimizado, aplicando antes el encuadre (recorte 1:1 o bordes blancos).
 * Lanza ApiError si el archivo no se puede procesar.
 */
export async function optimizarImagen(buffer, { crop = null, square = false } = {}) {
  try {
    // 1) Orientación EXIF aplicada: las coordenadas del recorte corresponden a la imagen tal como se ve.
    const { data: raw, info } = await sharp(buffer, { limitInputPixels: 60_000_000 })
      .rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let img = sharp(raw, { raw: { width: info.width, height: info.height, channels: info.channels } });

    if (crop) {
      // Recorte cuadrado dentro de los límites de la imagen (tolera redondeos del navegador).
      const size = Math.max(1, Math.round(Math.min(crop.width, crop.height, info.width, info.height)));
      const left = Math.min(Math.max(0, Math.round(crop.x)), info.width - size);
      const top = Math.min(Math.max(0, Math.round(crop.y)), info.height - size);
      img = sharp(await img.extract({ left, top, width: size, height: size }).raw().toBuffer(),
        { raw: { width: size, height: size, channels: info.channels } });
    } else if (square) {
      // Imagen completa centrada en un lienzo cuadrado blanco.
      const size = Math.max(info.width, info.height);
      const padX = size - info.width;
      const padY = size - info.height;
      img = sharp(await img.extend({
        left: Math.floor(padX / 2), right: Math.ceil(padX / 2), top: Math.floor(padY / 2), bottom: Math.ceil(padY / 2),
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      }).raw().toBuffer(), { raw: { width: size, height: size, channels: info.channels } });
    }

    const { data, info: out } = await img
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: out.width, height: out.height };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError('No se pudo procesar la imagen. Prueba con otro archivo JPG, PNG o WEBP.');
  }
}

export const safeFileCode = code => String(code ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 40) || 'producto';

// Solo se borran archivos subidos por la app para ese producto (nunca rutas externas).
export async function removeOwnedImage(id, name) {
  if (name && name.startsWith(`${id}_`) && !name.includes('/') && !name.includes('\\')) {
    await fs.unlink(path.join(UPLOADS_DIR, name)).catch(() => {});
  }
}

function requireWrite(req) {
  if (!canWrite(MODULES.productos, req.user.permiso)) throw new ApiError('No tienes permiso para esta acción.', 403);
}

export const imagenesRouter = Router();

imagenesRouter.post('/productos/:id/imagen', upload.single('imagen'), async (req, res) => {
  requireWrite(req);
  const id = Number.parseInt(req.params.id, 10);
  const product = await db.one('SELECT prod_codigo, prod_ruta_imagen FROM sf_producto WHERE id_producto = ?', [id]);
  if (!product) throw new ApiError('Producto no encontrado.', 404);
  const file = req.file;
  const ext = file?.originalname.split('.').pop().toLowerCase();
  if (!file || !EXTENSIONS.has(ext)) throw new ApiError('Sube una imagen JPG, PNG o WEBP.');
  if (!looksLikeImage(file.buffer)) throw new ApiError('El archivo no es una imagen válida.');

  const optimized = await optimizarImagen(file.buffer, parseEncuadre(req.body));
  const name = await saveProductImage(id, product, optimized.data);
  res.json({
    prod_ruta_imagen: name,
    bytes_original: file.size,
    bytes_final: optimized.data.length,
    ancho: optimized.width,
    alto: optimized.height,
  });
});

async function saveProductImage(id, product, data) {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const name = `${id}_${safeFileCode(product.prod_codigo)}_${Date.now()}.webp`;
  await fs.writeFile(path.join(UPLOADS_DIR, name), data);
  await db.run('UPDATE sf_producto SET prod_ruta_imagen = ? WHERE id_producto = ?', [name, id]);
  if (product.prod_ruta_imagen !== name) await removeOwnedImage(id, product.prod_ruta_imagen);
  return name;
}

// Volver a encuadrar la imagen que el producto ya tiene (sin subirla de nuevo).
imagenesRouter.post('/productos/:id/imagen/recorte', async (req, res) => {
  requireWrite(req);
  const id = Number.parseInt(req.params.id, 10);
  const product = await db.one('SELECT prod_codigo, prod_ruta_imagen FROM sf_producto WHERE id_producto = ?', [id]);
  if (!product) throw new ApiError('Producto no encontrado.', 404);
  const encuadre = parseEncuadre(req.body);
  if (!encuadre.crop && !encuadre.square) throw new ApiError('Indica el recorte o elige "Usar imagen completa".');
  const current = product.prod_ruta_imagen;
  if (!current || current.includes('/') || current.includes('\\')) throw new ApiError('El producto no tiene una imagen para recortar.', 404);
  let buffer;
  try {
    buffer = await fs.readFile(path.join(UPLOADS_DIR, current));
  } catch {
    throw new ApiError('No se encontró el archivo de la imagen actual. Súbela de nuevo.', 404);
  }
  const optimized = await optimizarImagen(buffer, encuadre);
  const name = await saveProductImage(id, product, optimized.data);
  res.json({ prod_ruta_imagen: name, bytes_final: optimized.data.length, ancho: optimized.width, alto: optimized.height });
});

imagenesRouter.delete('/productos/:id/imagen', async (req, res) => {
  requireWrite(req);
  const id = Number.parseInt(req.params.id, 10);
  const product = await db.one('SELECT prod_ruta_imagen FROM sf_producto WHERE id_producto = ?', [id]);
  await db.run('UPDATE sf_producto SET prod_ruta_imagen = NULL WHERE id_producto = ?', [id]);
  await removeOwnedImage(id, product?.prod_ruta_imagen);
  res.json({ ok: true });
});
