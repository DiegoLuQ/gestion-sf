// 003 · Sesiones de la aplicación guardadas en MySQL.
import { SESSION_TABLE_SQL } from '../../src/sesiones.js';

export const descripcion = 'Tabla sf_sesion para las sesiones de usuario';

export async function up({ conn }) {
  await conn.query(SESSION_TABLE_SQL);
  return 'Tabla lista.';
}
