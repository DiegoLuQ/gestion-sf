/*
 * Convierte a WEBP optimizado las imágenes de productos que ya existen en uploads/productos
 * y todavía no son WEBP (por ejemplo, las fotos del sistema anterior copiadas a esa carpeta).
 *
 *   npm run imagenes:optimizar              convierte y actualiza la base
 *   npm run imagenes:optimizar -- --revisar  solo informa qué haría, sin cambiar nada
 *
 * Los archivos originales se eliminan solo después de guardar el WEBP y actualizar el producto.
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { db, pool } from '../src/db.js';
import { looksLikeImage, optimizarImagen, safeFileCode, UPLOADS_DIR } from '../src/imagenes.js';

const dryRun = process.argv.includes('--revisar');
const kb = n => `${Math.round(n / 1024).toLocaleString('es-CL')} KB`;

const products = await db.all(
  "SELECT id_producto, prod_codigo, prod_ruta_imagen FROM sf_producto WHERE prod_ruta_imagen IS NOT NULL AND prod_ruta_imagen <> '' ORDER BY id_producto");

let converted = 0; let missing = 0; let alreadyWebp = 0; let invalid = 0; let before = 0; let after = 0;
for (const p of products) {
  const name = p.prod_ruta_imagen;
  if (name.includes('/') || name.includes('\\')) { invalid += 1; continue; }
  if (name.toLowerCase().endsWith('.webp')) { alreadyWebp += 1; continue; }
  const source = path.join(UPLOADS_DIR, name);
  let buffer;
  try {
    buffer = await fs.readFile(source);
  } catch {
    missing += 1;
    continue;
  }
  if (!looksLikeImage(buffer)) { invalid += 1; console.log(`  omitido (no es JPG/PNG/WEBP): ${name}`); continue; }
  try {
    const optimized = await optimizarImagen(buffer);
    before += buffer.length;
    after += optimized.data.length;
    converted += 1;
    if (dryRun) continue;
    const target = `${p.id_producto}_${safeFileCode(p.prod_codigo)}_${Date.now()}.webp`;
    await fs.writeFile(path.join(UPLOADS_DIR, target), optimized.data);
    await db.run('UPDATE sf_producto SET prod_ruta_imagen = ? WHERE id_producto = ?', [target, p.id_producto]);
    await fs.unlink(source).catch(() => {});
  } catch (err) {
    invalid += 1;
    console.log(`  omitido (${err.message}): ${name}`);
  }
}

console.log(`${dryRun ? 'Revisión (sin cambios)' : 'Optimización terminada'} · carpeta ${UPLOADS_DIR}`);
console.log(`  ${dryRun ? 'se convertirían' : 'convertidas a WEBP'}: ${converted}${converted ? ` (${kb(before)} → ${kb(after)})` : ''}`);
console.log(`  ya eran WEBP: ${alreadyWebp}`);
console.log(`  con nombre en la base pero sin archivo: ${missing}`);
console.log(`  omitidas por archivo inválido: ${invalid}`);
await pool.end();
