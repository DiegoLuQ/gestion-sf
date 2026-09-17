// Configuración de la empresa (fila única en sf_empresa) y datos públicos de marca.
import { Router } from 'express';
import { db } from './db.js';

export const EMPRESA_TABLE_SQL = `CREATE TABLE IF NOT EXISTS sf_empresa (
  id_empresa        TINYINT UNSIGNED NOT NULL DEFAULT 1 PRIMARY KEY,
  emp_nombre        VARCHAR(100) NOT NULL,
  emp_rut           VARCHAR(12)  NULL,
  emp_correo        VARCHAR(100) NULL,
  emp_url_img       VARCHAR(500) NULL,
  emp_slogan        VARCHAR(150) NULL,
  creado_en         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_empresa_unica CHECK (id_empresa = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_spanish_ci`;

export const empresaRouter = Router();

// Público: lo usa la pantalla de login antes de iniciar sesión, por eso no expone RUT ni correo.
empresaRouter.get('/empresa/publico', async (req, res) => {
  const row = await db.one('SELECT emp_nombre, emp_slogan, emp_url_img FROM sf_empresa WHERE id_empresa = 1');
  res.json({
    nombre: row?.emp_nombre ?? 'Santiago Filtros',
    slogan: row?.emp_slogan ?? null,
    url_img: row?.emp_url_img ?? null,
  });
});
