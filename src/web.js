// Página pública de ventas, generada en el servidor.
//
// - El HTML sale completo (textos, productos, datos estructurados), así lo leen los buscadores sin ejecutar JavaScript.
// - No hay buscador ni API pública: solo se muestran los 10 filtros con mayor rotación que tienen stock.
// - Nunca expone costos, stock exacto, proveedores ni ubicación en bodega.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { ROBOTS_TXT } from './bots.js';
import { db } from './db.js';
import { UPLOADS_DIR } from './imagenes.js';

const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'landing.html');
const SITE_URL = (process.env.SITE_URL || 'https://santiagofiltros.cl').replace(/\/$/, '');
const DEFAULT_WHATSAPP = '56981732415';
const PRODUCTOS_WEB = 10;
const CACHE_MS = 5 * 60 * 1000;

export const webRouter = Router();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Número para wa.me: solo dígitos y con código de Chile si se ingresó el celular de 9 dígitos.
function whatsappNumber(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('9')) return `56${digits}`;
  return digits.length >= 11 ? digits : DEFAULT_WHATSAPP;
}
const whatsappLabel = n => `+${n.replace(/^(56)(9)(\d{4})(\d{4})$/, '$1 $2 $3 $4')}`;
const whatsappUrl = (n, text) => `https://wa.me/${n}?text=${encodeURIComponent(text)}`;

// Descripciones de la planilla original: sin guiones sueltos al inicio ni el marcador "(sin descripción)".
function cleanText(text) {
  const t = String(text ?? '').replace(/^[\s\-–·.]+/, '').trim();
  return /^\(sin descripci[oó]n\)$/i.test(t) ? '' : t;
}

// El tipo se toma de la descripción cuando la dice (hay productos con la subcategoría equivocada).
function tipoFiltro(descripcion, subcategoria) {
  const d = String(descripcion ?? '').toLowerCase();
  if (/aceite/.test(d)) return 'Filtro de Aceite';
  if (/petr[oó]leo|combustible|bencina|diesel|gasolina/.test(d)) return 'Filtro de Combustible';
  if (/cabina|polen|habit[aá]culo/.test(d)) return 'Filtro de Cabina';
  if (/aire/.test(d)) return 'Filtro de Aire';
  return subcategoria;
}

function illustration(tipo) {
  const t = String(tipo ?? '').toLowerCase();
  const id = /aire|cabina/.test(t) ? 'aire' : /combustible/.test(t) ? 'combustible' : 'aceite';
  return `<svg viewBox="0 0 120 120" aria-hidden="true"><use href="#il-${id}"/></svg>`;
}

// ---------------------------------------------------------------- Datos
async function loadData() {
  const [empresa, totales, marcas, productos] = await Promise.all([
    db.one(`SELECT emp_nombre, emp_slogan, emp_url_img, emp_correo, emp_whatsapp, emp_direccion, emp_horario, emp_web_precios
            FROM sf_empresa WHERE id_empresa = 1`),
    db.one(`SELECT COUNT(*) AS productos, COUNT(DISTINCT id_marca) AS marcas FROM sf_producto WHERE prod_estado = 'Disponible'`),
    db.all(`SELECT m.marca_nombre AS nombre FROM sf_producto p JOIN sf_marca m ON m.id_marca = p.id_marca
            WHERE p.prod_estado = 'Disponible' GROUP BY m.id_marca ORDER BY COUNT(*) DESC, m.marca_nombre LIMIT 12`),
    // Rotación: unidades vendidas en los últimos 12 meses (desde la última venta registrada) y, para desempatar, en todo el historial.
    db.all(`SELECT p.id_producto, p.prod_codigo, p.prod_codigo2, p.prod_descripcion, p.prod_venta, p.prod_ruta_imagen,
                   m.marca_nombre, s.subc_nombre,
                   COALESCE(SUM(CASE WHEN x.salip_fecha >= r.desde THEN x.salip_cantidad END), 0) AS vendidos_12m,
                   COALESCE(SUM(x.salip_cantidad), 0) AS vendidos
            FROM sf_producto p
            JOIN sf_marca m ON m.id_marca = p.id_marca
            JOIN sf_subcategoria s ON s.id_subcategoria = p.id_subcategoria
            JOIN sf_categoria c ON c.id_categoria = s.id_categoria
            CROSS JOIN (SELECT COALESCE(MAX(salip_fecha), CURDATE()) - INTERVAL 12 MONTH AS desde FROM sf_salida_productos) r
            LEFT JOIN sf_salida_productos x ON x.id_producto = p.id_producto
            WHERE c.cat_nombre = 'Filtros' AND p.prod_estado = 'Disponible' AND p.prod_cantidad > 0
            GROUP BY p.id_producto
            ORDER BY vendidos_12m DESC, vendidos DESC, p.id_producto DESC
            LIMIT ${PRODUCTOS_WEB}`),
  ]);
  return { empresa, totales, marcas: marcas.map(m => m.nombre), productos };
}

// ---------------------------------------------------------------- HTML
function productCard(p, ctx) {
  const tipo = tipoFiltro(p.prod_descripcion, p.subc_nombre);
  const descripcion = cleanText(p.prod_descripcion);
  const hasImage = p.prod_ruta_imagen && !/[\\/]/.test(p.prod_ruta_imagen) && existsSync(path.join(UPLOADS_DIR, p.prod_ruta_imagen));
  const alt = `${tipo} ${p.prod_codigo} ${p.marca_nombre}`;
  const media = hasImage
    ? `<img src="/uploads/productos/${encodeURIComponent(p.prod_ruta_imagen)}" alt="${esc(alt)}" loading="lazy" width="400" height="400">`
    : illustration(tipo);
  const referencia = p.prod_codigo2 && p.prod_codigo2 !== p.prod_codigo ? p.prod_codigo2 : null;
  const precio = ctx.precios && p.prod_venta > 0
    ? `<span class="price">$${Math.round(p.prod_venta).toLocaleString('es-CL')}<small>IVA incluido</small></span>` : '';
  const mensaje = `Hola ${ctx.nombre}, quiero cotizar el ${tipo} ${p.prod_codigo} (${p.marca_nombre}).`;
  return `
          <article class="card">
            <div class="card-media">${media}<span class="card-type">${esc(tipo)}</span></div>
            <div class="card-body">
              <div class="card-head"><h3 class="card-code">${esc(p.prod_codigo)}</h3><span class="card-brand">${esc(p.marca_nombre)}</span></div>
              ${descripcion && descripcion.toLowerCase() !== tipo.toLowerCase() ? `<p class="card-desc">${esc(descripcion)}</p>` : ''}
              ${referencia ? `<p class="card-ref">Ref. ${esc(referencia)}</p>` : ''}
              <div class="card-foot"><span class="badge badge-ok">Disponible</span>${precio}</div>
              <a class="btn btn-wa" href="${esc(whatsappUrl(ctx.whatsapp, mensaje))}" target="_blank" rel="noopener nofollow">
                <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-whatsapp"/></svg>Consultar
              </a>
            </div>
          </article>`;
}

function jsonLd({ nombre, logo, correo, whatsapp, direccion }) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'AutoPartsStore',
    '@id': `${SITE_URL}/#tienda`,
    name: nombre,
    url: `${SITE_URL}/`,
    description: 'Venta de filtros de aceite, aire y combustible por mayor y menor en Alto Hospicio e Iquique.',
    telephone: whatsappLabel(whatsapp),
    ...(correo && { email: correo }),
    ...(logo && { logo, image: logo }),
    address: {
      '@type': 'PostalAddress',
      ...(direccion && { streetAddress: direccion }),
      addressRegion: 'Tarapacá',
      addressCountry: 'CL',
    },
    areaServed: [
      { '@type': 'City', name: 'Alto Hospicio' },
      { '@type': 'City', name: 'Iquique' },
    ],
    knowsAbout: ['Filtros de aceite', 'Filtros de aire', 'Filtros de combustible', 'Venta de filtros por mayor'],
  };
  // "</" dentro de un <script> cerraría la etiqueta antes de tiempo.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

let template = null;
let cache = { html: null, expires: 0 };

export async function renderLanding() {
  if (cache.html && cache.expires > Date.now()) return cache.html;
  if (!template || process.env.NODE_ENV !== 'production') template = await fs.readFile(TEMPLATE, 'utf8');

  const { empresa: e, totales, marcas, productos } = await loadData();
  const nombre = e?.emp_nombre || 'Santiago Filtros';
  const whatsapp = whatsappNumber(e?.emp_whatsapp);
  const logo = /^https?:\/\//i.test(e?.emp_url_img || '') ? e.emp_url_img : null;
  const ctx = { nombre, whatsapp, precios: Boolean(e?.emp_web_precios) };
  const general = `Hola ${nombre}, quiero cotizar filtros.\nVehículo (marca, modelo, año y motor): \nCantidad: `;

  const contacto = [
    `<li><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-whatsapp"/></svg><div><span>WhatsApp</span><a href="${esc(whatsappUrl(whatsapp, general))}" target="_blank" rel="noopener nofollow">${esc(whatsappLabel(whatsapp))}</a></div></li>`,
    e?.emp_correo && `<li><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-mail"/></svg><div><span>Correo</span><a href="mailto:${esc(e.emp_correo)}">${esc(e.emp_correo)}</a></div></li>`,
    e?.emp_direccion && `<li><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-pin"/></svg><div><span>Dirección</span><a href="https://www.google.com/maps/search/?api=1&amp;query=${esc(encodeURIComponent(e.emp_direccion))}" target="_blank" rel="noopener nofollow">${esc(e.emp_direccion)}</a></div></li>`,
    e?.emp_horario && `<li><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-clock"/></svg><div><span>Horario</span><p>${esc(e.emp_horario)}</p></div></li>`,
  ].filter(Boolean).join('\n          ');

  const values = {
    SITE_URL,
    NOMBRE: esc(nombre),
    LOGO: logo
      ? `<span class="brand-mark has-logo"><img src="${esc(logo)}" alt="" width="38" height="38"></span>`
      : '<span class="brand-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16l-6 8v6l-4 2v-8z"/></svg></span>',
    OG_IMAGE: logo ? `<meta property="og:image" content="${esc(logo)}">` : '',
    JSON_LD: jsonLd({ nombre, logo, correo: e?.emp_correo, whatsapp, direccion: e?.emp_direccion }),
    WHATSAPP_URL: esc(whatsappUrl(whatsapp, general)),
    WHATSAPP_LABEL: esc(whatsappLabel(whatsapp)),
    STAT_PRODUCTOS: totales.productos.toLocaleString('es-CL'),
    STAT_MARCAS: String(totales.marcas),
    PRODUCTOS: productos.map(p => productCard(p, ctx)).join(''),
    MARCAS: marcas.map(m => `<li>${esc(m)}</li>`).join(''),
    CONTACTO: contacto,
    YEAR: String(new Date().getFullYear()),
  };
  const html = template.replace(/\{\{(\w+)\}\}/g, (m, key) => values[key] ?? m);
  cache = { html, expires: Date.now() + CACHE_MS };
  return html;
}

// Se llama al guardar productos o la configuración, para que la web refleje el cambio al instante.
export function invalidateLanding() {
  cache = { html: null, expires: 0 };
}

webRouter.get('/', async (req, res) => {
  // Enlaces antiguos del sistema (/#/productos) los resuelve el navegador: el fragmento no llega al servidor.
  const html = await renderLanding();
  res.set('Cache-Control', 'public, max-age=300').type('html').send(html);
});

webRouter.get('/robots.txt', (req, res) => {
  res.type('text/plain; charset=utf-8').set('Cache-Control', 'public, max-age=86400').send(ROBOTS_TXT);
});

webRouter.get('/sitemap.xml', (req, res) => {
  res.type('application/xml').set('Cache-Control', 'public, max-age=86400').send(
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_URL}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>
`);
});
