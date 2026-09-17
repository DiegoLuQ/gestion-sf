/*
 * Exporta una base MySQL completa a un archivo .sql: tablas, datos, vistas,
 * procedimientos y triggers. Lo usan `npm run exportar` y los respaldos
 * automáticos que se hacen antes de cada migración.
 *
 * Pensado para importarse en phpMyAdmin de Hostinger:
 *  - Vistas, procedimientos y triggers van sin DEFINER ni nombre de base.
 *  - Los triggers se crean al final, después de los datos (no descuentan stock dos veces).
 *  - No incluye columnas calculadas ni los datos de sesiones activas.
 */
import fs from 'node:fs';
import mysql from 'mysql2/promise';

const BATCH = 500;
const stripDefiner = sql => sql.replace(/\sDEFINER\s*=\s*(`[^`]*`|'[^']*'|\S+)@(`[^`]*`|'[^']*'|\S+)/i, '');

export async function exportarBase(conn, database, outFile, { excluirTabla = () => false, sinDatos = ['sf_sesion'], titulo = 'Santiago Filtros' } = {}) {
  const skipData = new Set(sinDatos);
  const stripSchema = sql => sql.replaceAll(`\`${database}\`.`, '');
  const out = fs.createWriteStream(outFile, { encoding: 'utf8' });
  const write = text => new Promise(resolve => (out.write(`${text}\n`) ? resolve() : out.once('drain', resolve)));

  await write(`-- ${titulo} · exportado ${new Date().toISOString()} desde ${database}`);
  await write('-- Importar en una base vacía (phpMyAdmin > Importar).');
  await write('SET NAMES utf8mb4;');
  await write('SET FOREIGN_KEY_CHECKS = 0;');
  await write("SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';");
  await write('');

  const [objects] = await conn.query(
    'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [database]);
  const tables = objects.filter(o => o.type === 'BASE TABLE' && !excluirTabla(o.name)).map(o => o.name);
  const views = objects.filter(o => o.type === 'VIEW').map(o => o.name);
  const [routines] = await conn.query(
    "SELECT ROUTINE_NAME AS name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE' ORDER BY ROUTINE_NAME", [database]);

  for (const view of views) await write(`DROP VIEW IF EXISTS \`${view}\`;`);
  for (const table of tables) await write(`DROP TABLE IF EXISTS \`${table}\`;`);
  await write('');

  let rowsTotal = 0;
  for (const table of tables) {
    const [[create]] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
    await write(`${create['Create Table'].replace(/ AUTO_INCREMENT=\d+/, '')};`);
    await write('');
    if (skipData.has(table)) continue;
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND EXTRA NOT LIKE '%GENERATED%' ORDER BY ORDINAL_POSITION`, [database, table]);
    const colList = cols.map(c => `\`${c.name}\``).join(', ');
    const [rows] = await conn.query({ sql: `SELECT ${colList} FROM \`${table}\``, rowsAsArray: true });
    for (let i = 0; i < rows.length; i += BATCH) {
      await write(`INSERT INTO \`${table}\` (${colList}) VALUES ${rows.slice(i, i + BATCH).map(r => mysql.format('(?)', [r])).join(',')};`);
    }
    if (rows.length) await write('');
    rowsTotal += rows.length;
  }

  for (const view of views) {
    const [[create]] = await conn.query(`SHOW CREATE VIEW \`${view}\``);
    await write(`${stripSchema(create['Create View']).replace(/^CREATE\s.*?\sVIEW/i, 'CREATE VIEW')};`);
    await write('');
  }

  let routinesWritten = 0;
  if (routines.length) {
    await write('DELIMITER $$');
    for (const { name } of routines) {
      const [[create]] = await conn.query(`SHOW CREATE PROCEDURE \`${name}\``);
      if (!create['Create Procedure']) continue; // sin permiso para leer el cuerpo
      await write(`DROP PROCEDURE IF EXISTS \`${name}\`$$`);
      await write(`${stripSchema(stripDefiner(create['Create Procedure']))}$$`);
      routinesWritten += 1;
    }
    await write('DELIMITER ;');
    await write('');
  }

  const [triggers] = await conn.query(
    `SELECT TRIGGER_NAME AS name, ACTION_TIMING AS timing, EVENT_MANIPULATION AS event, EVENT_OBJECT_TABLE AS tbl, ACTION_STATEMENT AS body
     FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY EVENT_OBJECT_TABLE, ACTION_ORDER`, [database]);
  const exportedTriggers = triggers.filter(t => !excluirTabla(t.tbl));
  if (exportedTriggers.length) {
    await write('DELIMITER $$');
    for (const t of exportedTriggers) {
      await write(`CREATE TRIGGER \`${t.name}\` ${t.timing} ${t.event} ON \`${t.tbl}\` FOR EACH ROW ${stripSchema(t.body)}$$`);
    }
    await write('DELIMITER ;');
    await write('');
  }

  await write('SET FOREIGN_KEY_CHECKS = 1;');
  await new Promise(resolve => out.end(resolve));
  return {
    archivo: outFile, tablas: tables.length, vistas: views.length, procedimientos: routinesWritten,
    triggers: exportedTriggers.length, filas: rowsTotal, bytes: fs.statSync(outFile).size,
  };
}
