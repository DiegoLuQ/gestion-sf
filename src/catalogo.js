// Catálogo de productos disponibles: enlaces con vencimiento, página pública y PDF para el administrador.
//
// - El catálogo muestra imagen, código, descripción, marca, categoría y precio de venta (con IVA). Nunca stock.
// - /catalogo/<código> funciona mientras el enlace esté activo y no haya pasado su fecha de vencimiento.
// - El PDF solo lo descarga el administrador desde Productos. Se guarda unos minutos para no rearmarlo en cada clic.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { todayISO } from './crud.js';
import { db } from './db.js';
import { ApiError, invalid } from './errores.js';
import { UPLOADS_DIR } from './imagenes.js';
import { getLogoPng } from './logo.js';
import { ADMIN } from './modules.js';

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'catalogo.html');
const TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
const MAX_DIAS = 730;
const PDF_CACHE_MS = 10 * 60 * 1000;

const cleanText = text => {
  const t = String(text ?? '').replace(/^[\s\-–·.]+/, '').trim();
  return /^\(sin descripci[oó]n\)$/i.test(t) ? '' : t;
};

// Productos disponibles con su foto (solo si el archivo existe).
async function loadProductos() {
  const [rows, archivos] = await Promise.all([
    db.all(`SELECT p.id_producto, p.prod_codigo, p.prod_descripcion, p.prod_venta, p.prod_ruta_imagen, m.marca_nombre, s.subc_nombre
            FROM sf_producto p
            JOIN sf_marca m ON m.id_marca = p.id_marca
            JOIN sf_subcategoria s ON s.id_subcategoria = p.id_subcategoria
            JOIN (SELECT id_subcategoria, COUNT(*) AS n FROM sf_producto WHERE prod_estado = 'Disponible' GROUP BY id_subcategoria) pop
              ON pop.id_subcategoria = p.id_subcategoria
            WHERE p.prod_estado = 'Disponible'
            ORDER BY pop.n DESC, s.subc_nombre, p.prod_codigo, m.marca_nombre`),
    fs.readdir(UPLOADS_DIR).then(names => new Set(names)).catch(() => new Set()),
  ]);
  return rows.map(p => ({
    id: p.id_producto,
    codigo: p.prod_codigo,
    descripcion: cleanText(p.prod_descripcion),
    marca: p.marca_nombre,
    categoria: p.subc_nombre,
    precio: Number(p.prod_venta) > 0 ? Number(p.prod_venta) : null, // sin precio cargado: "Consultar"
    archivo: p.prod_ruta_imagen && archivos.has(p.prod_ruta_imagen) ? p.prod_ruta_imagen : null,
  }));
}

const empresaDatos = () => db.one('SELECT emp_nombre, emp_url_img FROM sf_empresa WHERE id_empresa = 1');

// ---------------------------------------------------------------- Página pública
export const catalogoPageRouter = Router();

catalogoPageRouter.get('/catalogo/:token', (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  res.sendFile(PAGE);
});

export const catalogoPublicRouter = Router();

catalogoPublicRouter.get('/catalogo-publico/:token', async (req, res) => {
  const token = String(req.params.token);
  const enlace = TOKEN_RE.test(token) && await db.one(
    'SELECT cat_expira, cat_activo, cat_expira < CURDATE() AS vencido FROM sf_catalogo_enlace WHERE cat_token = ?', [token]);
  if (!enlace) throw new ApiError('Este catálogo no existe. Revisa que el enlace esté completo.', 404);
  if (!enlace.cat_activo || enlace.vencido) {
    throw new ApiError('Este catálogo ya no está disponible. Pide un enlace nuevo a quien te lo envió.', 410);
  }
  const [empresa, productos] = await Promise.all([empresaDatos(), loadProductos()]);
  res.set('Cache-Control', 'no-store').json({
    empresa: {
      nombre: empresa?.emp_nombre || 'Santiago Filtros',
      logo: /^https?:\/\//i.test(empresa?.emp_url_img || '') ? empresa.emp_url_img : null,
    },
    vence: enlace.cat_expira,
    productos: productos.map(({ archivo, ...p }) => ({
      ...p, imagen: archivo ? `/uploads/productos/${encodeURIComponent(archivo)}` : null,
    })),
  });
});

// ---------------------------------------------------------------- Administración (solo Administrador)
export const catalogoAdminRouter = Router();

catalogoAdminRouter.use('/catalogo', (req, res, next) => {
  if (req.user?.permiso !== ADMIN) throw new ApiError('Solo el administrador puede gestionar el catálogo.', 403);
  next();
});

const enlaceSelect = `SELECT id_catalogo AS id, cat_nombre AS nombre, cat_token AS token, cat_expira AS expira, cat_activo AS activo,
                             cat_expira < CURDATE() AS vencido, creado_en FROM sf_catalogo_enlace`;
const mapEnlace = e => e && { ...e, activo: Boolean(e.activo), vencido: Boolean(e.vencido) };

function addDaysISO(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function validarExpira(value) {
  const expira = String(value ?? '').trim();
  const today = todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expira) || Number.isNaN(Date.parse(`${expira}T00:00:00Z`))) return 'Indica la fecha de vencimiento.';
  if (expira < today) return 'La fecha de vencimiento no puede ser anterior a hoy.';
  if (expira > addDaysISO(today, MAX_DIAS)) return 'La fecha de vencimiento puede ser como máximo en 2 años.';
  return null;
}

catalogoAdminRouter.get('/catalogo/enlaces', async (req, res) => {
  res.json((await db.all(`${enlaceSelect} ORDER BY id_catalogo DESC`)).map(mapEnlace));
});

catalogoAdminRouter.post('/catalogo/enlaces', async (req, res) => {
  const nombre = String(req.body?.nombre ?? '').trim().replace(/\s+/g, ' ');
  const errors = {};
  if (nombre.length < 2) errors.nombre = 'Indica un nombre o referencia para reconocer el enlace.';
  else if (nombre.length > 100) errors.nombre = 'Máximo 100 caracteres.';
  const errExpira = validarExpira(req.body?.expira);
  if (errExpira) errors.expira = errExpira;
  if (Object.keys(errors).length) throw invalid(errors);

  const { insertId } = await db.run(
    'INSERT INTO sf_catalogo_enlace (cat_nombre, cat_token, cat_expira, id_usuario) VALUES (?, ?, ?, ?)',
    [nombre, crypto.randomBytes(18).toString('base64url'), String(req.body.expira).trim(), req.user.id]);
  res.status(201).json(mapEnlace(await db.one(`${enlaceSelect} WHERE id_catalogo = ?`, [insertId])));
});

catalogoAdminRouter.put('/catalogo/enlaces/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!(await db.one('SELECT 1 FROM sf_catalogo_enlace WHERE id_catalogo = ?', [id]))) throw new ApiError('Enlace no encontrado.', 404);
  if (Object.hasOwn(req.body ?? {}, 'expira')) {
    const err = validarExpira(req.body.expira);
    if (err) throw invalid({ expira: err });
    await db.run('UPDATE sf_catalogo_enlace SET cat_expira = ? WHERE id_catalogo = ?', [String(req.body.expira).trim(), id]);
  }
  if (Object.hasOwn(req.body ?? {}, 'activo')) {
    await db.run('UPDATE sf_catalogo_enlace SET cat_activo = ? WHERE id_catalogo = ?', [req.body.activo ? 1 : 0, id]);
  }
  res.json(mapEnlace(await db.one(`${enlaceSelect} WHERE id_catalogo = ?`, [id])));
});

catalogoAdminRouter.delete('/catalogo/enlaces/:id', async (req, res) => {
  const r = await db.run('DELETE FROM sf_catalogo_enlace WHERE id_catalogo = ?', [Number(req.params.id)]);
  if (!r.affectedRows) throw new ApiError('Enlace no encontrado.', 404);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- PDF
const PDF = { width: 595.28, height: 841.89, margin: 36 };
const COLS = 2;
const ROWS = 3;
const GAP = 14;
const HEAD_H = 34;
const FOOT_H = 26;
const INFO_H = 80;
const C = {
  navy: '#0f2a47', navyDark: '#0a1d33', orange: '#f7500b', text: '#0f1b2d', muted: '#5b6778',
  border: '#dde3ea', soft: '#f3f6fa', placeholder: '#c3ccd8',
};

let pdfCache = { buffer: null, filename: '', expires: 0 };
export function invalidateCatalogo() {
  pdfCache = { buffer: null, filename: '', expires: 0 };
}

// Las fuentes estándar del PDF solo tienen letras latinas: se reemplazan símbolos que no existen.
const clp = n => `$${Math.round(n).toLocaleString('es-CL')}`;
const pdfText = text => String(text ?? '')
  .replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...')
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, '');

// Foto lista para el PDF: JPEG sobre fondo blanco, de buen tamaño para verse grande sin inflar el archivo.
const imageCache = new Map(); // archivo -> Buffer
async function pdfImage(archivo) {
  if (!archivo) return null;
  if (imageCache.has(archivo)) return imageCache.get(archivo);
  try {
    const buffer = await sharp(path.join(UPLOADS_DIR, archivo))
      .rotate()
      .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    imageCache.set(archivo, buffer);
    return buffer;
  } catch {
    return null;
  }
}

function drawPlaceholder(doc, x, y, w, h) {
  doc.rect(x, y, w, h).fill(C.soft);
  const s = Math.min(w, h) * 0.28;
  const cx = x + w / 2;
  const cy = y + h / 2 - 8;
  doc.save().lineWidth(2).strokeColor(C.placeholder)
    .roundedRect(cx - s / 2, cy - s / 2, s, s, 6).stroke()
    .circle(cx - s * 0.18, cy - s * 0.15, s * 0.09).stroke()
    .moveTo(cx - s / 2 + 3, cy + s / 2 - 4).lineTo(cx - s * 0.05, cy + s * 0.02).lineTo(cx + s / 2 - 3, cy + s * 0.35).stroke()
    .restore();
  doc.font('Helvetica').fontSize(9).fillColor(C.placeholder)
    .text('Sin imagen', x, cy + s / 2 + 8, { width: w, align: 'center', lineBreak: false });
}

export async function buildCatalogoPdf() {
  if (pdfCache.buffer && pdfCache.expires > Date.now()) return pdfCache;

  const [empresa, productos] = await Promise.all([empresaDatos(), loadProductos()]);
  const nombre = pdfText(empresa?.emp_nombre || 'Santiago Filtros');
  const logo = await getLogoPng(empresa?.emp_url_img);
  const today = todayISO();
  const fecha = new Date(`${today}T12:00:00Z`).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const doc = new PDFDocument({
    size: 'A4', margin: 0, bufferPages: true,
    info: { Title: `Catálogo de productos · ${nombre}`, Author: nombre },
  });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise(resolve => doc.on('end', resolve));

  // Portada
  doc.rect(0, 0, PDF.width, PDF.height).fill(C.navyDark);
  doc.rect(0, PDF.height * 0.62, PDF.width, 6).fill(C.orange);
  if (logo) {
    doc.roundedRect(PDF.width / 2 - 70, 170, 140, 140, 18).fill('#ffffff');
    doc.image(logo, PDF.width / 2 - 60, 180, { fit: [120, 120], align: 'center', valign: 'center' });
  }
  doc.font('Helvetica-Bold').fontSize(34).fillColor('#ffffff').text('Catálogo de productos', 0, 350, { width: PDF.width, align: 'center' });
  doc.font('Helvetica').fontSize(16).fillColor('#c6d3e3').text(nombre, 0, 396, { width: PDF.width, align: 'center' });
  const categorias = [...new Set(productos.map(p => p.categoria))];
  doc.font('Helvetica').fontSize(12).fillColor('#9fb2c9')
    .text(`${productos.length.toLocaleString('es-CL')} productos disponibles · ${categorias.length} categorías`, 0, 440, { width: PDF.width, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff')
    .text(pdfText(categorias.join('  ·  ')), 60, PDF.height * 0.62 + 36, { width: PDF.width - 120, align: 'center' });
  doc.font('Helvetica').fontSize(10).fillColor('#9fb2c9')
    .text(`Actualizado al ${fecha}`, 0, PDF.height - 70, { width: PDF.width, align: 'center' });

  // Páginas de productos: una sección por categoría, 2 columnas × 3 filas con la foto grande.
  const contentW = PDF.width - PDF.margin * 2;
  const cardW = (contentW - GAP * (COLS - 1)) / COLS;
  const areaTop = PDF.margin + HEAD_H;
  const areaH = PDF.height - areaTop - PDF.margin - FOOT_H;
  const cardH = (areaH - GAP * (ROWS - 1)) / ROWS;
  const imageH = cardH - INFO_H;

  const pageHeader = categoria => {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.navy).text(nombre, PDF.margin, PDF.margin, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.orange)
      .text(pdfText(categoria).toUpperCase(), PDF.margin, PDF.margin, { width: contentW, align: 'right', lineBreak: false });
    doc.moveTo(PDF.margin, PDF.margin + 18).lineTo(PDF.width - PDF.margin, PDF.margin + 18).lineWidth(1).strokeColor(C.border).stroke();
  };

  for (const categoria of categorias) {
    const lista = productos.filter(p => p.categoria === categoria);
    for (let i = 0; i < lista.length; i++) {
      const slot = i % (COLS * ROWS);
      if (slot === 0) {
        doc.addPage();
        pageHeader(categoria);
      }
      const p = lista[i];
      const x = PDF.margin + (slot % COLS) * (cardW + GAP);
      const y = areaTop + Math.floor(slot / COLS) * (cardH + GAP);

      doc.save().roundedRect(x, y, cardW, cardH, 10).clip();
      const img = await pdfImage(p.archivo);
      if (img) {
        doc.rect(x, y, cardW, imageH).fill('#ffffff');
        doc.image(img, x + 10, y + 10, { fit: [cardW - 20, imageH - 20], align: 'center', valign: 'center' });
      } else {
        drawPlaceholder(doc, x, y, cardW, imageH);
      }
      doc.restore();
      doc.roundedRect(x, y, cardW, cardH, 10).lineWidth(1).strokeColor(C.border).stroke();
      doc.moveTo(x, y + imageH).lineTo(x + cardW, y + imageH).strokeColor(C.border).stroke();

      const tx = x + 12;
      const tw = cardW - 24;
      // Fila 1: código (izquierda) y precio (derecha). Fila 2: marca. Fila 3: descripción.
      const precio = p.precio ? clp(p.precio) : 'Consultar';
      doc.font('Helvetica-Bold').fontSize(p.precio ? 14 : 11);
      const precioW = Math.min(doc.widthOfString(precio) + 2, tw * 0.5);
      doc.fillColor(p.precio ? C.navy : C.muted)
        .text(precio, tx + tw - precioW, y + imageH + (p.precio ? 9 : 11), { width: precioW, align: 'right', lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(13).fillColor(C.text)
        .text(pdfText(p.codigo), tx, y + imageH + 10, { width: tw - precioW - 10, lineBreak: false, ellipsis: true });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.orange)
        .text(pdfText(p.marca).toUpperCase(), tx, y + imageH + 29, { width: tw, lineBreak: false, ellipsis: true });
      if (p.descripcion) {
        doc.font('Helvetica').fontSize(8.5).fillColor(C.muted)
          .text(pdfText(p.descripcion), tx, y + imageH + 43, { width: tw, height: 24, ellipsis: true, lineGap: 1 });
      }
    }
  }

  // Pie con número de página (la portada no lleva).
  const range = doc.bufferedPageRange();
  for (let i = 1; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(8.5).fillColor(C.muted)
      .text(`Página ${i} de ${range.count - 1}`, PDF.margin, PDF.height - PDF.margin - 10, { width: contentW, align: 'right', lineBreak: false })
      .text('Precios en pesos chilenos, IVA incluido. Sujetos a cambio sin previo aviso.', PDF.margin, PDF.height - PDF.margin - 10, { lineBreak: false });
  }

  doc.end();
  await done;
  pdfCache = {
    buffer: Buffer.concat(chunks),
    filename: `catalogo-${nombre.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${today}.pdf`,
    expires: Date.now() + PDF_CACHE_MS,
  };
  return pdfCache;
}

catalogoAdminRouter.get('/catalogo/pdf', async (req, res) => {
  const { buffer, filename } = await buildCatalogoPdf();
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': buffer.length,
  });
  res.send(buffer);
});
