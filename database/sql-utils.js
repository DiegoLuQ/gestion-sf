// Utilidades SQL compartidas por las migraciones y la exportación.
import fs from 'node:fs/promises';

// Ejecuta un archivo .sql respetando las líneas DELIMITER del cliente mysql.
export async function runSqlFile(conn, file) {
  let delimiter = ';';
  let buf = [];
  for (const line of (await fs.readFile(file, 'utf8')).split(/\r?\n/)) {
    const stripped = line.trim();
    if (/^DELIMITER\s/i.test(stripped)) { delimiter = stripped.split(/\s+/)[1]; continue; }
    if (!buf.length && (!stripped || stripped.startsWith('--'))) continue;
    buf.push(line);
    if (stripped.endsWith(delimiter)) {
      const stmt = buf.join('\n').trimEnd().slice(0, -delimiter.length);
      if (stmt.trim()) await conn.query(stmt);
      buf = [];
    }
  }
}

export async function tableExists(conn, table) {
  const [rows] = await conn.query(
    "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'", [table]);
  return rows.length > 0;
}

export async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, column]);
  return rows.length > 0;
}

export async function routineNames(conn) {
  const [rows] = await conn.query(
    "SELECT ROUTINE_NAME AS name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE = 'PROCEDURE'");
  return rows.map(r => r.name);
}

export const currentDatabase = async conn => (await conn.query('SELECT DATABASE() AS db'))[0][0].db;
