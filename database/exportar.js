/*
 * Exporta la base de la aplicación (DATABASE_URL) a un .sql listo para phpMyAdmin.
 *
 *   npm run exportar                       -> database/santiago_filtros_hostinger.sql
 *   npm run exportar -- otra/ruta.sql
 *   npm run exportar -- --incluir-respaldo-v1
 *
 * Por defecto no incluye las tablas respaldo_v1_* que deja la conversión desde
 * la base original (quedan en la base, pero no hace falta llevarlas a producción).
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { COMMON_OPTIONS, connectionConfig } from '../src/db.js';
import { exportarBase } from './exportador.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const includeV1 = args.includes('--incluir-respaldo-v1');
const outFile = path.resolve(args.find(a => !a.startsWith('--')) || path.join(DIR, 'santiago_filtros_hostinger.sql'));

const cfg = connectionConfig();
const conn = await mysql.createConnection({ ...cfg, ...COMMON_OPTIONS });
const r = await exportarBase(conn, cfg.database, outFile, {
  excluirTabla: name => !includeV1 && name.startsWith('respaldo_v1_'),
});
await conn.end();
console.log(`Exportado: ${r.archivo}`);
console.log(`${r.tablas} tablas, ${r.vistas} vistas, ${r.procedimientos} procedimientos, ${r.triggers} triggers, ${r.filas} filas, ${(r.bytes / 1024 / 1024).toFixed(1)} MB`);
