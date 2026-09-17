/*
 * Crea o reemplaza las vistas de database/vistas.sql en la base configurada (DATABASE_URL o DB_*).
 *
 *   npm run vistas
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { COMMON_OPTIONS, connectionConfig } from '../src/db.js';
import { runSqlFile } from './sql-utils.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vistas.sql');
const cfg = connectionConfig();
const conn = await mysql.createConnection({ ...cfg, ...COMMON_OPTIONS });
try {
  await runSqlFile(conn, FILE);
  const [rows] = await conn.query(
    `SELECT TABLE_NAME AS vista FROM information_schema.VIEWS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('v_ventas_mensuales', 'v_producto_stock_bajo') ORDER BY TABLE_NAME`);
  console.log(`Base ${cfg.database}: vistas creadas o actualizadas -> ${rows.map(r => r.vista).join(', ')}`);
} catch (err) {
  console.error(`No se pudieron crear las vistas: ${err.message}`);
  process.exitCode = 1;
} finally {
  await conn.end();
}
