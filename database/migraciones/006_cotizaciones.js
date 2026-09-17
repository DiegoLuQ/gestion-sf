// 006 · Cotizaciones por enlace: enlaces que se envían a clientes y las solicitudes que ellos llenan.
export const descripcion = 'Enlaces de cotización y cotizaciones recibidas';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS sf_cotizacion_enlace (
    id_enlace       INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    enl_nombre      VARCHAR(100) NOT NULL,
    enl_token       CHAR(24)     NOT NULL,
    enl_activo      TINYINT(1)   NOT NULL DEFAULT 1,
    enl_expira      DATE         NULL,
    enl_nota        VARCHAR(500) NULL,
    creado_en       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_enlace_token (enl_token)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_spanish_ci`,

  // Si se elimina el enlace, las cotizaciones recibidas se conservan.
  `CREATE TABLE IF NOT EXISTS sf_cotizacion (
    id_cotizacion   INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    id_enlace       INT UNSIGNED NULL,
    cot_nombre      VARCHAR(100) NOT NULL,
    cot_celular     VARCHAR(20)  NULL,
    cot_rut         VARCHAR(12)  NULL,
    cot_comentario  VARCHAR(1000) NULL,
    cot_estado      ENUM('NUEVA','CONTACTADO','CERRADA','DESCARTADA') NOT NULL DEFAULT 'NUEVA',
    cot_nota        VARCHAR(1000) NULL,
    cot_ip          VARCHAR(45)  NULL,
    creado_en       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY ix_cotizacion_estado (cot_estado, creado_en),
    CONSTRAINT fk_cotizacion_enlace FOREIGN KEY (id_enlace)
      REFERENCES sf_cotizacion_enlace (id_enlace) ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_spanish_ci`,

  // El precio se guarda al momento de la solicitud: el total no cambia si después se actualiza el producto.
  `CREATE TABLE IF NOT EXISTS sf_cotizacion_detalle (
    id_detalle      INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    id_cotizacion   INT UNSIGNED NOT NULL,
    id_producto     INT UNSIGNED NOT NULL,
    cotd_cantidad   INT UNSIGNED NOT NULL,
    cotd_precio     INT UNSIGNED NOT NULL DEFAULT 0,
    cotd_total      BIGINT UNSIGNED AS (cotd_cantidad * cotd_precio) STORED,
    UNIQUE KEY uq_cotizacion_producto (id_cotizacion, id_producto),
    CONSTRAINT chk_cotd_cantidad CHECK (cotd_cantidad > 0),
    CONSTRAINT fk_cotd_cotizacion FOREIGN KEY (id_cotizacion)
      REFERENCES sf_cotizacion (id_cotizacion) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_cotd_producto FOREIGN KEY (id_producto)
      REFERENCES sf_producto (id_producto) ON UPDATE CASCADE ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_spanish_ci`,
];

export async function up({ conn }) {
  for (const sql of TABLES) await conn.query(sql);
  return 'Tablas sf_cotizacion_enlace, sf_cotizacion y sf_cotizacion_detalle listas.';
}
