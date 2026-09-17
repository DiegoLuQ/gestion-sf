// 002 · Configuración de la empresa (nombre, RUT, correo, logo y slogan).
import { EMPRESA_TABLE_SQL } from '../../src/empresa.js';

export const descripcion = 'Tabla sf_empresa con la configuración de la empresa';

export async function up({ conn }) {
  await conn.query(EMPRESA_TABLE_SQL);
  const [r] = await conn.query("INSERT IGNORE INTO sf_empresa (id_empresa, emp_nombre) VALUES (1, 'Santiago Filtros')");
  return r.affectedRows ? 'Tabla creada con el nombre "Santiago Filtros".' : 'La tabla ya existía: se conservó la configuración.';
}
