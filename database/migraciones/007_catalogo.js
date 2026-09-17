// 007 · Enlaces al catálogo en línea (/catalogo/<código>), con fecha de vencimiento obligatoria.
export const descripcion = 'Enlaces del catálogo de productos';

export async function up({ conn }) {
  await conn.query(`CREATE TABLE IF NOT EXISTS sf_catalogo_enlace (
    id_catalogo     INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    cat_nombre      VARCHAR(100) NOT NULL,
    cat_token       CHAR(24)     NOT NULL,
    cat_expira      DATE         NOT NULL,
    cat_activo      TINYINT(1)   NOT NULL DEFAULT 1,
    id_usuario      INT UNSIGNED NULL,
    creado_en       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_catalogo_token (cat_token),
    CONSTRAINT fk_catalogo_usuario FOREIGN KEY (id_usuario)
      REFERENCES sf_usuario (id_usuario) ON UPDATE CASCADE ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_spanish_ci`);
  return 'Tabla sf_catalogo_enlace lista.';
}
