/*
 * Migraciones de la base de datos (DATABASE_URL).
 *
 *   npm run migrar                 aplica las migraciones pendientes (con respaldo previo)
 *   npm run migrar -- --estado     muestra qué migraciones están aplicadas y cuáles faltan
 *   npm run migrar -- --sin-respaldo
 *
 * Sirve para cualquier base: la original del sistema anterior (la convierte a v2),
 * una base v2 importada, o una base vacía. El servidor también lo ejecuta al iniciar
 * (salvo que AUTO_MIGRAR=false).
 */
import 'dotenv/config';
import { pool } from '../src/db.js';
import { migrar } from '../src/migraciones.js';

const args = process.argv.slice(2);
try {
  await migrar({ soloEstado: args.includes('--estado'), respaldo: !args.includes('--sin-respaldo') });
} catch (err) {
  console.error(`\n${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
