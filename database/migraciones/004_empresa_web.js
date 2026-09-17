// 004 · Datos de contacto para la página pública (WhatsApp, dirección, horario) y opción de mostrar precios.
import { columnExists } from '../sql-utils.js';

export const descripcion = 'Contacto y opciones de la página web en sf_empresa';

const COLUMNS = [
  ['emp_whatsapp', 'VARCHAR(20) NULL AFTER emp_correo'],
  ['emp_direccion', 'VARCHAR(150) NULL AFTER emp_whatsapp'],
  ['emp_horario', 'VARCHAR(150) NULL AFTER emp_direccion'],
  ['emp_web_precios', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER emp_slogan'],
];

export async function up({ conn }) {
  const added = [];
  for (const [name, definition] of COLUMNS) {
    if (await columnExists(conn, 'sf_empresa', name)) continue;
    await conn.query(`ALTER TABLE sf_empresa ADD COLUMN ${name} ${definition}`);
    added.push(name);
  }
  return added.length ? `Columnas agregadas: ${added.join(', ')}.` : 'Las columnas ya existían.';
}
