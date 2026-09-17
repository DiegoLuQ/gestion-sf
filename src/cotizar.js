// Cotización por enlace: el cliente abre /cotizar/<código>, elige productos y envía su solicitud.
//
// - Página y API públicas, pero solo con un código de enlace válido, activo y vigente.
// - Al cliente nunca se le muestra stock ni precios: solo foto, código, descripción, marca y categoría.
// - La solicitud guarda el precio de venta de ese momento para que la plataforma muestre el total.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { normalizeRut } from './crud.js';
import { db, transaction } from './db.js';
import { ApiError, invalid } from './errores.js';
import { UPLOADS_DIR } from './imagenes.js';

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'cotizar.html');
const TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
const MAX_ITEMS = 300;
const MAX_CANTIDAD = 99999;
const SEND_WINDOW_MS = 10 * 60 * 1000;
const SEND_MAX = 5;

// ---------------------------------------------------------------- Página
export const cotizarPageRouter = Router();

cotizarPageRouter.get('/cotizar/:token', (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  res.sendFile(PAGE);
});

// ---------------------------------------------------------------- API
export const cotizarApiRouter = Router();

async function enlaceVigente(token) {
  if (!TOKEN_RE.test(String(token))) throw new ApiError('Este enlace no existe. Revisa que esté completo.', 404);
  const enlace = await db.one(
    `SELECT id_enlace, enl_activo, enl_expira, enl_expira < CURDATE() AS vencido
     FROM sf_cotizacion_enlace WHERE enl_token = ?`, [token]);
  if (!enlace) throw new ApiError('Este enlace no existe. Revisa que esté completo.', 404);
  if (!enlace.enl_activo || enlace.vencido) {
    throw new ApiError('Este enlace ya no está disponible. Pide uno nuevo a quien te lo envió.', 410);
  }
  return enlace;
}

const cleanText = text => {
  const t = String(text ?? '').replace(/^[\s\-–·.]+/, '').trim();
  return /^\(sin descripci[oó]n\)$/i.test(t) ? '' : t;
};

cotizarApiRouter.get('/cotizar/:token', async (req, res) => {
  await enlaceVigente(req.params.token);
  const [empresa, productos, archivos] = await Promise.all([
    db.one('SELECT emp_nombre, emp_url_img FROM sf_empresa WHERE id_empresa = 1'),
    db.all(`SELECT p.id_producto, p.prod_codigo, p.prod_descripcion, p.prod_ruta_imagen, m.marca_nombre, s.subc_nombre
            FROM sf_producto p
            JOIN sf_marca m ON m.id_marca = p.id_marca
            JOIN sf_subcategoria s ON s.id_subcategoria = p.id_subcategoria
            JOIN (SELECT id_subcategoria, COUNT(*) AS n FROM sf_producto WHERE prod_estado = 'Disponible' GROUP BY id_subcategoria) pop
              ON pop.id_subcategoria = p.id_subcategoria
            WHERE p.prod_estado = 'Disponible'
            ORDER BY pop.n DESC, s.subc_nombre, p.prod_codigo, m.marca_nombre`),
    // Fotos que existen de verdad: muchos productos antiguos apuntan a archivos que no están.
    fs.readdir(UPLOADS_DIR).then(names => new Set(names)).catch(() => new Set()),
  ]);
  res.set('Cache-Control', 'no-store').json({
    empresa: {
      nombre: empresa?.emp_nombre || 'Santiago Filtros',
      logo: /^https?:\/\//i.test(empresa?.emp_url_img || '') ? empresa.emp_url_img : null,
    },
    productos: productos.map(p => ({
      id: p.id_producto,
      codigo: p.prod_codigo,
      descripcion: cleanText(p.prod_descripcion),
      marca: p.marca_nombre,
      categoria: p.subc_nombre,
      imagen: p.prod_ruta_imagen && archivos.has(p.prod_ruta_imagen)
        ? `/uploads/productos/${encodeURIComponent(p.prod_ruta_imagen)}` : null,
    })),
  });
});

// Límite de envíos por IP, para que nadie llene la bandeja de cotizaciones.
const sends = new Map(); // ip -> [timestamps]
function tooManySends(ip) {
  const now = Date.now();
  const recent = (sends.get(ip) ?? []).filter(t => now - t < SEND_WINDOW_MS);
  if (recent.length >= SEND_MAX) { sends.set(ip, recent); return true; }
  recent.push(now);
  sends.set(ip, recent);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of sends) if (!list.some(t => now - t < SEND_WINDOW_MS)) sends.delete(ip);
}, SEND_WINDOW_MS).unref();

cotizarApiRouter.post('/cotizar/:token', async (req, res) => {
  const enlace = await enlaceVigente(req.params.token);
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  // Campo trampa: invisible para personas; si viene lleno, es un bot. Se responde como si todo saliera bien.
  if (String(body.sitio_web ?? '').trim()) return res.status(201).json({ numero: 0, nombre: String(body.nombre ?? '') });

  const errors = {};
  const nombre = String(body.nombre ?? '').trim().replace(/\s+/g, ' ');
  if (nombre.length < 2) errors.nombre = 'Ingresa tu nombre.';
  else if (nombre.length > 100) errors.nombre = 'Máximo 100 caracteres.';

  const celular = String(body.celular ?? '').trim();
  const celularDigits = celular.replace(/\D/g, '');
  if (celular && (celularDigits.length < 8 || celularDigits.length > 15 || celular.length > 20)) {
    errors.celular = 'Celular inválido. Ej.: +56 9 1234 5678';
  }

  let rut = null;
  if (String(body.rut ?? '').trim()) {
    rut = normalizeRut(body.rut);
    if (!rut) errors.rut = 'RUT inválido (revisa el dígito verificador).';
  }

  const comentario = String(body.comentario ?? '').trim();
  if (comentario.length > 1000) errors.comentario = 'Máximo 1000 caracteres.';

  // Productos: se suman las cantidades repetidas del mismo producto.
  const cantidades = new Map();
  for (const item of Array.isArray(body.items) ? body.items : []) {
    const id = Math.trunc(Number(item?.id));
    const cantidad = Math.trunc(Number(item?.cantidad));
    if (!(id > 0) || !(cantidad > 0)) continue;
    cantidades.set(id, Math.min(MAX_CANTIDAD, (cantidades.get(id) ?? 0) + cantidad));
  }
  if (!cantidades.size) errors.items = 'Agrega al menos un producto a tu cotización.';
  else if (cantidades.size > MAX_ITEMS) errors.items = `Máximo ${MAX_ITEMS} productos por cotización.`;

  if (Object.keys(errors).length) throw invalid(errors);
  if (tooManySends(req.ip)) throw new ApiError('Ya enviaste varias cotizaciones. Espera unos minutos para enviar otra.', 429);

  const numero = await transaction(async q => {
    const ids = [...cantidades.keys()];
    const productos = await q.all(
      `SELECT id_producto, prod_venta FROM sf_producto
       WHERE prod_estado = 'Disponible' AND id_producto IN (${ids.map(() => '?').join(', ')})`, ids);
    if (productos.length !== ids.length) {
      throw new ApiError('Algunos productos ya no están disponibles. Actualiza la página y revisa tu cotización.', 409);
    }
    const { insertId } = await q.run(
      `INSERT INTO sf_cotizacion (id_enlace, cot_nombre, cot_celular, cot_rut, cot_comentario, cot_ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [enlace.id_enlace, nombre, celular || null, rut, comentario || null, String(req.ip ?? '').slice(0, 45)]);
    for (const p of productos) {
      await q.run('INSERT INTO sf_cotizacion_detalle (id_cotizacion, id_producto, cotd_cantidad, cotd_precio) VALUES (?, ?, ?, ?)',
        [insertId, p.id_producto, cantidades.get(p.id_producto), p.prod_venta ?? 0]);
    }
    return insertId;
  });

  res.status(201).json({ numero, nombre });
});
