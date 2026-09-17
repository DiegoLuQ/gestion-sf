// 008 · Enlaces de cotización asociados a un cliente (o públicos, sin cliente).
import { columnExists } from '../sql-utils.js';

export const descripcion = 'Cliente asociado en enlaces y cotizaciones';

export async function up({ conn }) {
  const hechos = [];

  if (!(await columnExists(conn, 'sf_cotizacion_enlace', 'id_cliente'))) {
    await conn.query('ALTER TABLE sf_cotizacion_enlace ADD COLUMN id_cliente INT UNSIGNED NULL AFTER id_enlace');
    await conn.query(`ALTER TABLE sf_cotizacion_enlace ADD CONSTRAINT fk_enlace_cliente
      FOREIGN KEY (id_cliente) REFERENCES sf_cliente (id_cliente) ON UPDATE CASCADE ON DELETE SET NULL`);
    hechos.push('sf_cotizacion_enlace.id_cliente');
  }
  // La referencia pasa a ser opcional: un enlace con cliente no necesita nombre propio.
  await conn.query('ALTER TABLE sf_cotizacion_enlace MODIFY COLUMN enl_nombre VARCHAR(100) NULL');

  if (!(await columnExists(conn, 'sf_cotizacion', 'id_cliente'))) {
    await conn.query('ALTER TABLE sf_cotizacion ADD COLUMN id_cliente INT UNSIGNED NULL AFTER id_enlace');
    await conn.query(`ALTER TABLE sf_cotizacion ADD CONSTRAINT fk_cotizacion_cliente
      FOREIGN KEY (id_cliente) REFERENCES sf_cliente (id_cliente) ON UPDATE CASCADE ON DELETE SET NULL`);
    hechos.push('sf_cotizacion.id_cliente');
  }

  return hechos.length ? `Columnas agregadas: ${hechos.join(', ')}.` : 'Las columnas ya existían.';
}
