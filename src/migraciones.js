/*
 * Ejecutor de migraciones (equivalente a Alembic).
 *
 * - Cada migración es un archivo database/migraciones/NNN_nombre.js con `descripcion` y `up()`.
 * - La tabla sf_migraciones registra cuáles se aplicaron en esta base.
 * - Antes de aplicar migraciones pendientes se hace un respaldo .sql completo en database/respaldos/.
 * - Un bloqueo de MySQL (GET_LOCK) evita que dos procesos migren la misma base a la vez.
 *
 * Para agregar un cambio de estructura: crear el siguiente archivo numerado (p. ej. 004_...js).
 * Nunca modificar una migración que ya se aplicó en producción.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import { exportarBase } from '../database/exportador.js';
import { COMMON_OPTIONS, connectionConfig } from './db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(ROOT, 'database', 'migraciones');
const BACKUP_DIR = path.join(ROOT, 'database', 'respaldos');
const KEEP_BACKUPS = 10;

const TRACKING_TABLE_SQL = `CREATE TABLE IF NOT EXISTS sf_migraciones (
  id           VARCHAR(100) NOT NULL PRIMARY KEY,
  descripcion  VARCHAR(255) NOT NULL,
  resultado    TEXT NULL,
  duracion_ms  INT UNSIGNED NOT NULL DEFAULT 0,
  aplicada_en  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_spanish_ci`;

async function loadMigrations() {
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter(f => /^\d{3}_[\w-]+\.js$/.test(f)).sort();
  const migrations = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(MIGRATIONS_DIR, file)).href);
    if (typeof mod.up !== 'function') throw new Error(`La migración ${file} no exporta up()`);
    migrations.push({ id: file.replace(/\.js$/, ''), descripcion: mod.descripcion ?? file, up: mod.up });
  }
  return migrations;
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

async function pruneBackups(database) {
  const files = (await fs.readdir(BACKUP_DIR)).filter(f => f.startsWith(`${database}_`) && f.endsWith('.sql')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) await fs.unlink(path.join(BACKUP_DIR, old));
}

/**
 * Aplica las migraciones pendientes.
 * @param {object} opts
 * @param {boolean} [opts.respaldo=true]  hacer respaldo .sql antes de migrar
 * @param {boolean} [opts.soloEstado=false] solo informar, sin aplicar nada
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{aplicadas: string[], pendientes: string[], respaldo: string|null}>}
 */
export async function migrar({ respaldo = true, soloEstado = false, log = console.log } = {}) {
  const cfg = connectionConfig();
  const conn = await mysql.createConnection({ ...cfg, ...COMMON_OPTIONS });
  const lockName = `migraciones_${cfg.database}`.slice(0, 64);
  let locked = false;
  try {
    const [[lock]] = await conn.query('SELECT GET_LOCK(?, 300) AS ok', [lockName]);
    if (!lock.ok) throw new Error('Otra migración está en curso en esta base. Intenta de nuevo en unos minutos.');
    locked = true;

    await conn.query(TRACKING_TABLE_SQL);
    const [appliedRows] = await conn.query('SELECT id, aplicada_en FROM sf_migraciones ORDER BY id');
    const applied = new Map(appliedRows.map(r => [r.id, r.aplicada_en]));
    const migrations = await loadMigrations();
    const pending = migrations.filter(m => !applied.has(m.id));

    if (soloEstado) {
      log(`Base: ${cfg.database}`);
      for (const m of migrations) {
        log(`  ${applied.has(m.id) ? `✔ aplicada ${String(applied.get(m.id)).slice(0, 19)}` : '… pendiente           '}  ${m.id} · ${m.descripcion}`);
      }
      const unknown = appliedRows.filter(r => !migrations.some(m => m.id === r.id));
      for (const r of unknown) log(`  ? registrada en la base pero sin archivo: ${r.id}`);
      return { aplicadas: [...applied.keys()], pendientes: pending.map(m => m.id), respaldo: null };
    }

    if (!pending.length) {
      log(`Base ${cfg.database} al día (${applied.size} migraciones aplicadas).`);
      return { aplicadas: [], pendientes: [], respaldo: null };
    }

    let backupFile = null;
    if (respaldo) {
      await fs.mkdir(BACKUP_DIR, { recursive: true });
      backupFile = path.join(BACKUP_DIR, `${cfg.database}_${stamp()}_antes_de_${pending[0].id}.sql`);
      log(`Respaldando ${cfg.database} antes de migrar…`);
      const r = await exportarBase(conn, cfg.database, backupFile, { titulo: 'Respaldo automático antes de migrar' });
      log(`  respaldo: ${backupFile} (${r.tablas} tablas, ${r.filas} filas, ${r.procedimientos} procedimientos)`);
      await pruneBackups(cfg.database);
    }

    const done = [];
    for (const m of pending) {
      log(`Aplicando ${m.id} · ${m.descripcion}`);
      const start = Date.now();
      try {
        const resultado = await m.up({ conn, log, database: cfg.database });
        const ms = Date.now() - start;
        await conn.query('INSERT INTO sf_migraciones (id, descripcion, resultado, duracion_ms) VALUES (?, ?, ?, ?)',
          [m.id, String(m.descripcion).slice(0, 255), resultado == null ? null : String(resultado), ms]);
        if (resultado) log(`  → ${String(resultado).split('\n')[0]}`);
        log(`  ✔ ${m.id} (${(ms / 1000).toFixed(1)} s)`);
        done.push(m.id);
      } catch (err) {
        err.message = `La migración ${m.id} falló: ${err.message}${backupFile ? `\nRespaldo previo: ${backupFile}` : ''}`;
        throw err;
      }
    }
    return { aplicadas: done, pendientes: [], respaldo: backupFile };
  } finally {
    if (locked) await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    await conn.end();
  }
}
