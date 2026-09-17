-- =====================================================================
--  SANTIAGO FILTROS · Esquema mejorado (v2)
--  MySQL 8.0+  ·  utf8mb4_spanish_ci en todas las tablas
--
--  Mejoras respecto de la base original:
--   * Llaves foráneas reales en todas las relaciones (antes no había ninguna).
--   * Tabla sf_marca: normaliza las marcas escritas de distintas formas.
--   * Tabla sf_usuario con contraseñas cifradas (bcrypt) y rol por ENUM.
--   * La salida de productos se relaciona con el pedido por id_n_pedido
--     (antes por el número en texto, duplicado además como entero).
--   * ENUM para estados y tipos de documento, CHECK para montos y stock.
--   * Campos propuestos en la planilla: precio interno, transporte, formato,
--     tipo de cliente, ciudad, stock mínimo.
--   * Columnas de auditoría creado_en / actualizado_en.
--   * Vistas para resúmenes y triggers que mantienen el stock (triggers.sql).
-- =====================================================================

--  No se ejecuta a mano: lo usa database/migraciones/001_estructura_v2.js.
-- =====================================================================

SET NAMES utf8mb4;

CREATE TABLE sf_categoria (
  id_categoria      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cat_nombre        VARCHAR(50)  NOT NULL,
  cat_descripcion   VARCHAR(255) NULL,
  creado_en         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_categoria_nombre (cat_nombre)
) ENGINE=InnoDB;

CREATE TABLE sf_subcategoria (
  id_subcategoria   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subc_nombre       VARCHAR(50)  NOT NULL,
  id_categoria      INT UNSIGNED NOT NULL,
  creado_en         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_subcategoria (id_categoria, subc_nombre),
  CONSTRAINT fk_subcategoria_categoria FOREIGN KEY (id_categoria)
    REFERENCES sf_categoria (id_categoria) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE sf_marca (
  id_marca          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  marca_nombre      VARCHAR(50)  NOT NULL,
  marca_origen      VARCHAR(50)  NULL,
  creado_en         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_marca_nombre (marca_nombre)
) ENGINE=InnoDB;

CREATE TABLE sf_proveedor (
  id_proveedor      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  prov_rut          VARCHAR(12)  NULL,
  prov_nombre       VARCHAR(100) NOT NULL,
  prov_telefono     VARCHAR(20)  NULL,
  prov_email        VARCHAR(100) NULL,
  prov_pais         VARCHAR(50)  NOT NULL DEFAULT 'Chile',
  prov_ciudad       VARCHAR(50)  NULL,
  prov_direccion    VARCHAR(150) NULL,
  prov_descripcion  VARCHAR(255) NULL,
  prov_activo       TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_proveedor_rut (prov_rut),
  KEY ix_proveedor_nombre (prov_nombre)
) ENGINE=InnoDB;

CREATE TABLE sf_producto (
  id_producto           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  prod_codigo           VARCHAR(30)   NOT NULL,
  prod_codigo2          VARCHAR(30)   NULL,
  prod_descripcion      VARCHAR(255)  NOT NULL,
  id_marca              INT UNSIGNED  NOT NULL,
  id_subcategoria       INT UNSIGNED  NOT NULL,
  id_proveedor          INT UNSIGNED  NOT NULL,
  prod_cantidad         DECIMAL(10,2) NOT NULL DEFAULT 0,
  prod_stock_minimo     DECIMAL(10,2) NOT NULL DEFAULT 0,
  prod_costo            INT UNSIGNED  NOT NULL DEFAULT 0,
  prod_venta            INT UNSIGNED  NOT NULL DEFAULT 0,
  prod_precio_interno   INT UNSIGNED  NULL,
  prod_transporte       INT UNSIGNED  NULL,
  prod_formato          VARCHAR(30)   NULL,
  prod_ubicacion        VARCHAR(20)   NULL,
  prod_ruta_imagen      VARCHAR(150)  NULL,
  prod_estado           ENUM('Disponible','Descontinuado','Eliminado') NOT NULL DEFAULT 'Disponible',
  prod_fecha            DATE          NOT NULL,
  creado_en             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_producto_codigo (prod_codigo),
  KEY ix_producto_codigo2 (prod_codigo2),
  KEY ix_producto_estado (prod_estado),
  CONSTRAINT chk_prod_stock CHECK (prod_cantidad >= 0),
  CONSTRAINT chk_prod_stock_minimo CHECK (prod_stock_minimo >= 0),
  CONSTRAINT fk_producto_marca FOREIGN KEY (id_marca)
    REFERENCES sf_marca (id_marca) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_producto_subcategoria FOREIGN KEY (id_subcategoria)
    REFERENCES sf_subcategoria (id_subcategoria) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_producto_proveedor FOREIGN KEY (id_proveedor)
    REFERENCES sf_proveedor (id_proveedor) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE sf_cliente (
  id_cliente        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cli_rut           VARCHAR(12)  NULL,
  cli_tipo_cliente  ENUM('Persona','Empresa') NOT NULL DEFAULT 'Persona',
  cli_nombre        VARCHAR(250) NOT NULL,
  cli_giro          VARCHAR(250) NULL,
  cli_direccion     VARCHAR(250) NULL,
  cli_comuna        VARCHAR(50)  NULL,
  cli_ciudad        VARCHAR(50)  NULL,
  cli_telefono      VARCHAR(20)  NULL,
  cli_correo        VARCHAR(100) NULL,
  creado_en         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_cliente_rut (cli_rut),
  KEY ix_cliente_nombre (cli_nombre)
) ENGINE=InnoDB;

CREATE TABLE sf_vendedor (
  id_vendedor         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vend_nombre         VARCHAR(100) NOT NULL,
  vend_telefono       VARCHAR(20)  NULL,
  vend_correo         VARCHAR(100) NULL,
  vend_fecha_ingreso  DATE         NOT NULL,
  vend_activo         TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE sf_pedido (
  id_n_pedido       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nump_numero       VARCHAR(11)  NOT NULL,
  nump_fecha        DATE         NOT NULL,
  id_cliente        INT UNSIGNED NOT NULL,
  id_vendedor       INT UNSIGNED NULL,
  nump_estado       ENUM('PENDIENTE','PAGADO','CHEQUE','ANULADO') NOT NULL DEFAULT 'PENDIENTE',
  nump_observacion  TEXT NULL,
  creado_en         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pedido_numero (nump_numero),
  KEY ix_pedido_fecha (nump_fecha),
  KEY ix_pedido_estado (nump_estado),
  CONSTRAINT fk_pedido_cliente FOREIGN KEY (id_cliente)
    REFERENCES sf_cliente (id_cliente) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_pedido_vendedor FOREIGN KEY (id_vendedor)
    REFERENCES sf_vendedor (id_vendedor) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- Detalle del pedido: cada fila es un producto que sale de bodega.
-- Los precios son unitarios; salip_total se calcula solo.
CREATE TABLE sf_salida_productos (
  id_salida_p       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id_n_pedido       INT UNSIGNED  NOT NULL,
  id_producto       INT UNSIGNED  NOT NULL,
  salip_fecha       DATE          NOT NULL,
  salip_cantidad    DECIMAL(10,2) NOT NULL,
  salip_costo       INT UNSIGNED  NOT NULL DEFAULT 0,
  salip_venta       INT UNSIGNED  NOT NULL DEFAULT 0,
  salip_total       DECIMAL(14,2) AS (salip_cantidad * salip_venta) STORED,
  creado_en         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_salida_fecha (salip_fecha),
  CONSTRAINT chk_salida_cantidad CHECK (salip_cantidad > 0),
  CONSTRAINT fk_salida_pedido FOREIGN KEY (id_n_pedido)
    REFERENCES sf_pedido (id_n_pedido) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_salida_producto FOREIGN KEY (id_producto)
    REFERENCES sf_producto (id_producto) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Documento tributario con el que se cierra un pedido (uno por pedido).
CREATE TABLE sf_pedido_terminado (
  id_documento      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  docu_tipo         ENUM('FACTURA','BOLETA','NOTA DE VENTA','SIN DOCUMENTO') NOT NULL DEFAULT 'FACTURA',
  docu_numero       VARCHAR(20)  NOT NULL,
  docu_fecha        DATE         NOT NULL,
  id_n_pedido       INT UNSIGNED NOT NULL,
  id_vendedor       INT UNSIGNED NULL,
  docu_costo        INT UNSIGNED NOT NULL DEFAULT 0,
  docu_venta        INT UNSIGNED NOT NULL DEFAULT 0,
  creado_en         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_documento_pedido (id_n_pedido),
  KEY ix_documento_numero (docu_tipo, docu_numero),
  KEY ix_documento_fecha (docu_fecha),
  CONSTRAINT fk_documento_pedido FOREIGN KEY (id_n_pedido)
    REFERENCES sf_pedido (id_n_pedido) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_documento_vendedor FOREIGN KEY (id_vendedor)
    REFERENCES sf_vendedor (id_vendedor) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE sf_usuario (
  id_usuario          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usu_nombre          VARCHAR(30)  NOT NULL,
  usu_password_hash   VARCHAR(255) NOT NULL,
  usu_permiso         ENUM('Administrador','Vendedor','Consulta') NOT NULL DEFAULT 'Consulta',
  id_vendedor         INT UNSIGNED NULL,
  usu_activo          TINYINT(1)   NOT NULL DEFAULT 1,
  usu_ultimo_acceso   DATETIME     NULL,
  creado_en           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuario_nombre (usu_nombre),
  CONSTRAINT fk_usuario_vendedor FOREIGN KEY (id_vendedor)
    REFERENCES sf_vendedor (id_vendedor) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  Vistas
-- ---------------------------------------------------------------------

CREATE VIEW v_pedido_resumen AS
SELECT p.id_n_pedido,
       p.nump_numero,
       p.nump_fecha,
       p.nump_estado,
       c.id_cliente,
       c.cli_nombre,
       COUNT(s.id_salida_p)                                   AS items,
       COALESCE(SUM(s.salip_cantidad * s.salip_costo), 0)     AS total_costo,
       COALESCE(SUM(s.salip_total), 0)                        AS total_venta,
       COALESCE(SUM(s.salip_total - s.salip_cantidad * s.salip_costo), 0) AS margen,
       d.id_documento,
       d.docu_tipo,
       d.docu_numero
FROM sf_pedido p
JOIN sf_cliente c               ON c.id_cliente = p.id_cliente
LEFT JOIN sf_salida_productos s ON s.id_n_pedido = p.id_n_pedido
LEFT JOIN sf_pedido_terminado d ON d.id_n_pedido = p.id_n_pedido
GROUP BY p.id_n_pedido, c.id_cliente, d.id_documento;

CREATE VIEW v_producto_stock_bajo AS
SELECT pr.id_producto, pr.prod_codigo, pr.prod_descripcion, m.marca_nombre,
       pr.prod_cantidad, pr.prod_stock_minimo
FROM sf_producto pr
JOIN sf_marca m ON m.id_marca = pr.id_marca
WHERE pr.prod_estado = 'Disponible'
  AND pr.prod_cantidad <= pr.prod_stock_minimo;

CREATE VIEW v_ventas_mensuales AS
SELECT DATE_FORMAT(s.salip_fecha, '%Y-%m')   AS mes,
       COUNT(DISTINCT s.id_n_pedido)         AS pedidos,
       SUM(s.salip_total)                    AS venta,
       SUM(s.salip_cantidad * s.salip_costo) AS costo
FROM sf_salida_productos s
JOIN sf_pedido p ON p.id_n_pedido = s.id_n_pedido
WHERE p.nump_estado <> 'ANULADO'
GROUP BY DATE_FORMAT(s.salip_fecha, '%Y-%m');

-- Las tablas agregadas después (sf_empresa, sf_sesion, ...) se crean con sus
-- migraciones en database/migraciones/. Este archivo es la base de la migración 001.
