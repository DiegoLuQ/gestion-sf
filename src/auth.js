// Inicio de sesión, cierre, usuario actual y protección de la API.
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { db } from './db.js';
import { publicMeta } from './modules.js';

const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;
const failedLogins = new Map(); // `${ip}|${usuario}` -> { attempts, lockedUntil }

// Protege todo /api salvo el login. Revalida el usuario en cada request,
// así desactivar a alguien o cambiarle el permiso tiene efecto inmediato.
export async function apiGuard(req, res, next) {
  if (!['GET', 'HEAD'].includes(req.method) && req.get('X-Requested-With') !== 'fetch') {
    return res.status(400).json({ error: 'Solicitud rechazada.' });
  }
  if (req.path === '/auth/login' || (req.method === 'GET' && req.path === '/empresa/publico')) return next();
  const uid = req.session?.uid;
  const user = uid && await db.one(
    `SELECT u.usu_nombre, u.usu_permiso, u.usu_activo, v.id_vendedor, v.vend_nombre
     FROM sf_usuario u LEFT JOIN sf_vendedor v ON v.id_vendedor = u.id_vendedor AND v.vend_activo = 1
     WHERE u.id_usuario = ?`, [uid]);
  if (!user || !user.usu_activo) {
    if (req.session) req.session.destroy(() => {});
    return res.status(401).json({ error: 'Tu sesión expiró. Vuelve a iniciar sesión.' });
  }
  req.user = {
    id: uid, usuario: user.usu_nombre, permiso: user.usu_permiso,
    id_vendedor: user.id_vendedor ?? null, vendedor: user.vend_nombre ?? null, // vendedor asociado (si está activo)
  };
  return next();
}

export const authRouter = Router();

authRouter.post('/auth/login', async (req, res) => {
  const username = String(req.body?.usuario ?? '').trim();
  const password = String(req.body?.password ?? '');
  const key = `${req.ip}|${username.toLowerCase()}`;
  const record = failedLogins.get(key) ?? { attempts: 0, lockedUntil: 0 };
  if (record.lockedUntil > Date.now()) {
    const minutes = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ error: `Demasiados intentos. Espera ${minutes} min.` });
  }

  const user = await db.one('SELECT * FROM sf_usuario WHERE usu_nombre = ?', [username]);
  const ok = user && user.usu_activo && await bcrypt.compare(password, user.usu_password_hash);
  if (!ok) {
    record.attempts += 1;
    record.lockedUntil = record.attempts >= MAX_ATTEMPTS ? Date.now() + LOCK_MS : 0;
    failedLogins.set(key, record);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }

  failedLogins.delete(key);
  await new Promise((resolve, reject) => req.session.regenerate(err => (err ? reject(err) : resolve())));
  req.session.uid = user.id_usuario;
  await new Promise((resolve, reject) => req.session.save(err => (err ? reject(err) : resolve())));
  await db.run('UPDATE sf_usuario SET usu_ultimo_acceso = NOW() WHERE id_usuario = ?', [user.id_usuario]);
  return res.json({ usuario: user.usu_nombre, permiso: user.usu_permiso });
});

authRouter.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sf.sid');
    res.json({ ok: true });
  });
});

authRouter.get('/auth/me', (req, res) => {
  res.json(req.user);
});

authRouter.get('/meta', (req, res) => {
  res.json({ modules: publicMeta(req.user.permiso) });
});
