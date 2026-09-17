/*
 * Santiago Filtros · Sistema de gestión
 * Servidor Express: API REST + archivos del frontend (HTML, CSS y JS sin compilar).
 *
 *   npm start   ->  http://localhost:3000
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import multer from 'multer';
import { apiGuard, authRouter } from './src/auth.js';
import { catalogoAdminRouter, catalogoPageRouter, catalogoPublicRouter, invalidateCatalogo } from './src/catalogo.js';
import { cotizarApiRouter, cotizarPageRouter } from './src/cotizar.js';
import { crudRouter } from './src/crud.js';
import { dashboardRouter } from './src/dashboard.js';
import { db } from './src/db.js';
import { empresaRouter } from './src/empresa.js';
import { ApiError, dbError } from './src/errores.js';
import { imagenesRouter, UPLOADS_DIR } from './src/imagenes.js';
import { prepareLogo } from './src/logo.js';
import { notaVentaRouter } from './src/nota-venta.js';
import { blockBots, limitRate } from './src/bots.js';
import { invalidateLanding, webRouter } from './src/web.js';
import { migrar } from './src/migraciones.js';
import { MySqlSessionStore } from './src/sesiones.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(ROOT, 'frontend');
const PORT = Number(process.env.PORT) || 3000;
const SESSION_HOURS = 10;

if (!process.env.SESSION_SECRET) {
  console.warn('Aviso: falta SESSION_SECRET en el entorno. Las sesiones se cerrarán cada vez que se reinicie el servidor.');
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Hostinger atiende detrás de un proxy HTTPS

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
  });
  next();
});

// Bots de scraping fuera antes de tocar sesiones o la base.
app.use(blockBots);

// El sistema, el login y la API no se indexan.
app.use(['/app', '/acceso-sf', '/api'], (req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });

app.use(session({
  name: 'sf.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  store: new MySqlSessionStore(db),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: SESSION_HOURS * 60 * 60 * 1000 },
}));

app.use(limitRate);

// ---------------------------------------------------------------- API
const api = express.Router();
api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
api.use(express.json({ limit: '1mb' }));
// Cualquier cambio guardado (productos, ventas, configuración) renueva la página pública.
api.use((req, res, next) => {
  if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400) { invalidateLanding(); invalidateCatalogo(); } });
  next();
});
api.use(apiGuard);
api.use(authRouter);
api.use(cotizarApiRouter);
api.use(catalogoPublicRouter);
api.use(empresaRouter);
api.use(dashboardRouter);
api.use(imagenesRouter);
api.use(notaVentaRouter);
api.use(catalogoAdminRouter);
api.use(crudRouter);
api.use((req, res) => res.status(404).json({ error: 'Recurso no encontrado.' }));
app.use('/api', api);

// ---------------------------------------------------------------- Frontend
const sendPage = file => (req, res) => res.sendFile(path.join(FRONTEND, file), { headers: { 'Cache-Control': 'no-cache' } });

// Página pública de ventas en la raíz; el sistema de gestión vive en /app y se entra por /acceso-sf.
// La web no enlaza el acceso, y /app sin sesión vuelve a la portada para no revelar la ruta.
app.use(webRouter); // /, /robots.txt y /sitemap.xml
app.use(cotizarPageRouter); // /cotizar/<código>: cotización del cliente
app.use(catalogoPageRouter); // /catalogo/<código>: catálogo en línea
app.get('/app', (req, res, next) => (req.session.uid ? sendPage('index.html')(req, res, next) : res.redirect('/')));
app.get('/acceso-sf', (req, res, next) => (req.session.uid ? res.redirect('/app') : sendPage('login.html')(req, res, next)));

for (const dir of ['css', 'js', 'img', 'vendor']) {
  app.use(`/${dir}`, express.static(path.join(FRONTEND, dir), { index: false, maxAge: 0 }));
}

// Fotos de productos: públicas porque las muestra el catálogo de la página web.
app.use('/uploads/productos', express.static(UPLOADS_DIR, { index: false, maxAge: '1h', fallthrough: false }));

app.use((req, res) => res.redirect('/'));

// ---------------------------------------------------------------- Errores
app.use((err, req, res, _next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, errors: err.errors });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera el tamaño máximo (10 MB).' : 'No se pudo recibir el archivo.';
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido.' });
  }
  if (err.status === 404 && req.path.startsWith('/uploads/')) {
    return res.status(404).end();
  }
  const friendly = err.errno ? dbError(err) : null;
  if (friendly) {
    return res.status(friendly.status).json({ error: friendly.message, errors: {} });
  }
  console.error(err);
  return res.status(500).json({
    error: err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR'
      ? 'No se pudo conectar con la base de datos.'
      : 'Error interno del servidor.',
  });
});

// ---------------------------------------------------------------- Arranque
// Sin `await` a nivel superior: Hostinger carga este archivo con require(), que no lo admite.
async function start() {
  // Migraciones pendientes (con respaldo previo). AUTO_MIGRAR=false para aplicarlas solo con `npm run migrar`.
  if (process.env.AUTO_MIGRAR !== 'false') {
    try {
      await migrar({ log: msg => console.log(`[migraciones] ${msg}`) });
    } catch (err) {
      console.error(`[migraciones] ${err.message}`);
      console.error('[migraciones] El servidor no inicia con la base a medio migrar. Revisa el error y vuelve a intentar.');
      process.exit(1);
    }
  }
  // Prepara el logo de la empresa (descarga y conversión a PNG) sin retrasar el arranque.
  db.one('SELECT emp_url_img FROM sf_empresa WHERE id_empresa = 1').then(e => prepareLogo(e?.emp_url_img)).catch(() => {});

  app.listen(PORT, () => {
    console.log(`Santiago Filtros escuchando en http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('No se pudo iniciar el servidor:', err);
  process.exit(1);
});
