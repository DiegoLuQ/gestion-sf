// Motor CRUD genérico: listado, detalle, alta, edición, borrado, opciones y exportación CSV.
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { db, transaction } from './db.js';
import { ApiError, invalid } from './errores.js';
import { prepareLogo } from './logo.js';
import { MODULES, canRead, canWrite } from './modules.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZES = new Set([10, 25, 50, 100]);

function moduleOr404(req, { write = false } = {}) {
  const mod = MODULES[req.params.key];
  if (!mod) throw new ApiError('Recurso no encontrado.', 404);
  const role = req.user.permiso;
  if (!canRead(mod, role) || (write && !canWrite(mod, role))) {
    throw new ApiError('No tienes permiso para esta acción.', 403);
  }
  return mod;
}

function parseId(value) {
  if (!/^\d+$/.test(String(value))) throw new ApiError('Recurso no encontrado.', 404);
  return Number(value);
}

// ---------------------------------------------------------------------------
//  Construcción de consultas (los identificadores salen siempre de la definición)
// ---------------------------------------------------------------------------
const fkFields = mod => mod.fields
  .map((f, i) => ({ f, alias: `j${i}`, ref: MODULES[f.ref] }))
  .filter(x => x.f.type === 'fk');

const label = (ref, alias) => ref.labelSql.replaceAll('{a}', alias);

function selectParts(mod) {
  const cols = [`t.\`${mod.pk}\``, ...mod.fields.filter(f => !f.virtual).map(f => `t.\`${f.name}\``)];
  const joins = [];
  for (const { f, alias, ref } of fkFields(mod)) {
    joins.push(`LEFT JOIN \`${ref.table}\` ${alias} ON ${alias}.\`${ref.pk}\` = t.\`${f.name}\``);
    cols.push(`${label(ref, alias)} AS \`${f.name}__label\``);
  }
  cols.push(...mod.extras.map(e => `(${e.sql}) AS \`${e.name}\``));
  return { cols: cols.join(', '), joins: joins.join(' ') };
}

function whereParts(mod, query) {
  const where = [];
  const params = [];
  const q = String(query.q ?? '').trim();
  if (q) {
    const ors = [];
    for (const f of mod.fields) {
      if (f.search && f.type !== 'fk') { ors.push(`t.\`${f.name}\` LIKE ?`); params.push(`%${q}%`); }
    }
    for (const { f, alias, ref } of fkFields(mod)) {
      if (f.search) { ors.push(`${label(ref, alias)} LIKE ?`); params.push(`%${q}%`); }
    }
    if (/^\d+$/.test(q)) { ors.push(`t.\`${mod.pk}\` = ?`); params.push(Number(q)); }
    where.push(ors.length ? `(${ors.join(' OR ')})` : 'FALSE');
  }
  for (const f of mod.fields) {
    const value = query[`f_${f.name}`];
    if (value !== undefined && value !== '' && (f.filter || f.type === 'fk')) {
      where.push(`t.\`${f.name}\` = ?`);
      params.push(String(value));
    }
  }
  if (mod.dateField) {
    for (const [arg, op] of [['desde', '>='], ['hasta', '<=']]) {
      if (query[arg]) {
        if (!isValidDate(query[arg])) throw invalid({ [arg]: 'Usa el formato AAAA-MM-DD.' });
        where.push(`t.\`${mod.dateField}\` ${op} ?`);
        params.push(query[arg]);
      }
    }
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function orderPart(mod, query) {
  const sortable = { [mod.pk]: `t.\`${mod.pk}\`` };
  for (const f of mod.fields) if (!f.virtual) sortable[f.name] = `t.\`${f.name}\``;
  for (const { f } of fkFields(mod)) sortable[f.name] = `\`${f.name}__label\``;
  for (const e of mod.extras) sortable[e.name] = `\`${e.name}\``;
  const sort = Object.hasOwn(sortable, query.sort) ? query.sort : mod.order[0];
  const dir = String(query.dir || mod.order[1]).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `ORDER BY ${sortable[sort]} ${dir}, t.\`${mod.pk}\` ${dir}`;
}

async function fetchOne(mod, id, q = db) {
  const { cols, joins } = selectParts(mod);
  const row = await q.one(`SELECT ${cols} FROM \`${mod.table}\` t ${joins} WHERE t.\`${mod.pk}\` = ?`, [id]);
  if (!row) throw new ApiError(`No se encontró el registro ${id}.`, 404);
  return row;
}

// ---------------------------------------------------------------------------
//  Validación
// ---------------------------------------------------------------------------
function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function isValidDate(value) {
  if (!DATE_RE.test(String(value))) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function normalizeRut(raw) {
  const text = String(raw).replace(/[^0-9kK]/g, '').toUpperCase();
  if (text.length < 2 || !/^\d+$/.test(text.slice(0, -1))) return null;
  const body = text.slice(0, -1);
  const dv = text.slice(-1);
  let total = 0;
  let factor = 2;
  for (const digit of [...body].reverse()) {
    total += Number(digit) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (total % 11);
  const expected = rest === 11 ? '0' : rest === 10 ? 'K' : String(rest);
  return dv === expected ? `${Number(body)}-${dv}` : null;
}

function validate(mod, data, creating, user = {}) {
  const values = {};
  const errors = {};
  for (const f of mod.fields) {
    const { name, type } = f;
    if (f.readonly || type === 'image' || (!creating && !Object.hasOwn(data, name))) continue;
    let raw = data[name];
    if (creating && f.hideOnCreate) raw = undefined; // p. ej. un pedido nuevo siempre nace PENDIENTE
    // Si el campo no viene en la solicitud, se usa el dato del usuario (p. ej. su vendedor asociado).
    if (creating && f.defaultUserField && !Object.hasOwn(data, name)) raw = user[f.defaultUserField];
    if (typeof raw === 'string') raw = raw.trim();
    if (raw === '' || raw === null || raw === undefined) {
      if (creating && f.default !== undefined) {
        raw = f.default === 'today' ? todayISO() : f.default;
      } else if (type === 'bool') {
        raw = 0;
      } else {
        if (f.required) errors[name] = 'Este campo es obligatorio.';
        values[name] = null;
        continue;
      }
    }

    let value;
    if (['int', 'money', 'fk'].includes(type)) {
      value = Number(raw);
      if (!Number.isFinite(value)) { errors[name] = 'Valor inválido.'; continue; }
      value = Math.trunc(value);
    } else if (type === 'decimal') {
      value = Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(value)) { errors[name] = 'Valor inválido.'; continue; }
      value = Math.round(value * 100) / 100;
    } else if (type === 'date') {
      if (!isValidDate(String(raw))) { errors[name] = 'Valor inválido.'; continue; }
      value = String(raw);
    } else if (type === 'bool') {
      value = ['1', 'true', 'si', 'sí', 'on'].includes(String(raw).toLowerCase()) ? 1 : 0;
    } else {
      value = String(raw);
    }

    if (type === 'enum' && !f.options.includes(value)) {
      errors[name] = 'Opción no válida.';
    } else if (type === 'email' && !EMAIL_RE.test(value)) {
      errors[name] = 'Correo inválido.';
    } else if (type === 'url' && !isHttpUrl(value)) {
      errors[name] = 'Ingresa una URL completa que empiece con https:// o http://.';
    } else if (type === 'rut') {
      value = normalizeRut(value);
      if (!value) errors[name] = 'RUT inválido (revisa el dígito verificador).';
    } else if (type === 'password' && value.length < (f.minLength ?? 8)) {
      errors[name] = `Mínimo ${f.minLength ?? 8} caracteres.`;
    } else if (f.max && typeof value === 'string' && value.length > f.max) {
      errors[name] = `Máximo ${f.max} caracteres.`;
    } else if (f.min !== undefined && ['int', 'money', 'decimal'].includes(type) && value < f.min) {
      errors[name] = `Debe ser mayor o igual a ${f.min}.`;
    }
    if (['money', 'decimal'].includes(type) && !errors[name] && value >= 1e9) {
      errors[name] = 'El valor es demasiado grande.';
    }
    values[name] = value;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return values;
}

// ---------------------------------------------------------------------------
//  Reglas de negocio por módulo (se ejecutan dentro de la transacción)
// ---------------------------------------------------------------------------
// Sigue la numeración del pedido más reciente (el historial tiene números sueltos como 9999)
// y salta los números que ya estén ocupados.
async function nextOrderNumber(q) {
  const last = await q.one("SELECT CAST(nump_numero AS UNSIGNED) AS n FROM sf_pedido WHERE nump_numero REGEXP '^[0-9]{1,6}$' "
    + 'ORDER BY nump_fecha DESC, id_n_pedido DESC LIMIT 1');
  let number = (last ? Number(last.n) : 0) + 1;
  while (await q.one('SELECT 1 FROM sf_pedido WHERE nump_numero = ?', [String(number)])) number += 1;
  return String(number);
}

async function orderTotals(q, pedidoId) {
  const tot = await q.one('SELECT COALESCE(ROUND(SUM(salip_cantidad * salip_costo)), 0) AS costo, '
    + 'COALESCE(ROUND(SUM(salip_total)), 0) AS venta FROM sf_salida_productos WHERE id_n_pedido = ?', [pedidoId]);
  return { docu_costo: Number(tot.costo), docu_venta: Number(tot.venta) };
}

// Cuando cambian los productos de un pedido, su documento de venta se actualiza con los nuevos totales.
async function syncDocumentTotals(q, pedidoIds) {
  for (const pedidoId of new Set(pedidoIds.filter(Boolean))) {
    const { docu_costo: costo, docu_venta: venta } = await orderTotals(q, pedidoId);
    await q.run('UPDATE sf_pedido_terminado SET docu_costo = ?, docu_venta = ? WHERE id_n_pedido = ?', [costo, venta, pedidoId]);
  }
}

async function beforeSave(mod, values, id, q, user) {
  if (mod.key === 'pedidos') {
    if (id === null && !values.nump_numero) {
      values.nump_numero = await nextOrderNumber(q);
    } else if (Object.hasOwn(values, 'nump_numero') && !values.nump_numero) {
      throw invalid({ nump_numero: 'Este campo es obligatorio.' });
    }
  }

  if (mod.key === 'salidas') {
    if (values.id_producto && (values.salip_costo == null || values.salip_venta == null)) {
      const prod = await q.one('SELECT prod_costo, prod_venta FROM sf_producto WHERE id_producto = ?', [values.id_producto]);
      if (prod) {
        values.salip_costo ??= prod.prod_costo;
        values.salip_venta ??= prod.prod_venta;
      }
    }
    for (const name of ['salip_costo', 'salip_venta']) {
      if (Object.hasOwn(values, name) && values[name] === null) values[name] = 0;
    }
  }

  if (mod.key === 'documentos' && values.id_n_pedido) {
    // Los totales salen siempre de los productos del pedido (los mismos de la nota de venta).
    // Se calculan al crear o al cambiar de pedido; editar tipo, número o fecha no los toca,
    // así se conservan los montos históricos de documentos cuyo detalle no está completo.
    const current = id === null ? null : await q.one('SELECT id_n_pedido FROM sf_pedido_terminado WHERE id_documento = ?', [id]);
    if (!current || current.id_n_pedido !== values.id_n_pedido) {
      Object.assign(values, await orderTotals(q, values.id_n_pedido));
    }
    if (values.id_vendedor == null && (Object.hasOwn(values, 'id_vendedor') || id === null)) {
      const ped = await q.one('SELECT id_vendedor FROM sf_pedido WHERE id_n_pedido = ?', [values.id_n_pedido]);
      values.id_vendedor = ped ? ped.id_vendedor : null;
    }
  }

  if (mod.key === 'usuarios') {
    const { password } = values;
    delete values.password;
    if (password) {
      values.usu_password_hash = await bcrypt.hash(password, 12);
    } else if (id === null) {
      throw invalid({ password: 'Este campo es obligatorio.' });
    }
    if (id !== null && id === user.id) {
      if (values.usu_activo === 0) throw new ApiError('No puedes desactivar tu propio usuario.');
      if (values.usu_permiso !== undefined && values.usu_permiso !== 'Administrador') {
        throw new ApiError('No puedes quitarte el permiso de Administrador.');
      }
    }
  }
}

async function beforeDelete(mod, id, q, user) {
  if (mod.key === 'usuarios' && id === user.id) throw new ApiError('No puedes eliminar tu propio usuario.');
  if (mod.key === 'pedidos') {
    if (await q.one('SELECT 1 FROM sf_pedido_terminado WHERE id_n_pedido = ?', [id])) {
      throw new ApiError('El pedido tiene un documento de venta. Elimina primero el documento.', 409);
    }
    // Borrado explícito (no en cascada) para que los triggers devuelvan el stock.
    await q.run('DELETE FROM sf_salida_productos WHERE id_n_pedido = ?', [id]);
  }
}

// ---------------------------------------------------------------------------
//  Rutas
// ---------------------------------------------------------------------------
export const crudRouter = Router();

// Número que el formulario de "Nuevo pedido" propone (editable). Al guardar se valida que no esté repetido.
crudRouter.get('/pedidos/siguiente-numero', async (req, res) => {
  req.params.key = 'pedidos';
  moduleOr404(req, { write: true });
  res.json({ valor: await nextOrderNumber(db) });
});

crudRouter.get('/:key', async (req, res) => {
  const mod = moduleOr404(req);
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const requested = Number.parseInt(req.query.size, 10);
  const size = PAGE_SIZES.has(requested) ? requested : 25;
  const { cols, joins } = selectParts(mod);
  const { where, params } = whereParts(mod, req.query);
  const from = `FROM \`${mod.table}\` t ${joins} ${where}`;
  const { n: total } = await db.one(`SELECT COUNT(*) AS n ${from}`, params);
  const rows = await db.all(`SELECT ${cols} ${from} ${orderPart(mod, req.query)} LIMIT ? OFFSET ?`,
    [...params, size, (page - 1) * size]);
  res.json({ rows, total: Number(total), page, size });
});

crudRouter.get('/:key/opciones', async (req, res) => {
  const mod = moduleOr404(req);
  const lbl = label(mod, 't');
  if (req.query.id) {
    res.json(await db.all(`SELECT t.\`${mod.pk}\` AS value, ${lbl} AS label FROM \`${mod.table}\` t WHERE t.\`${mod.pk}\` = ?`,
      [String(req.query.id)]));
    return;
  }
  const isSelect = mod.fkMode === 'select';
  const q = String(req.query.q ?? '').trim();
  res.json(await db.all(
    `SELECT t.\`${mod.pk}\` AS value, ${lbl} AS label FROM \`${mod.table}\` t WHERE ${lbl} LIKE ? `
    + `ORDER BY ${isSelect ? 'label' : `t.\`${mod.pk}\` DESC`} LIMIT ${isSelect ? 500 : 20}`,
    [`%${q}%`],
  ));
});

const csvCell = value => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

crudRouter.get('/:key/exportar', async (req, res) => {
  const mod = moduleOr404(req);
  const { cols, joins } = selectParts(mod);
  const { where, params } = whereParts(mod, req.query);
  const rows = await db.all(`SELECT ${cols} FROM \`${mod.table}\` t ${joins} ${where} ${orderPart(mod, req.query)} LIMIT 50000`, params);
  const fields = mod.fields.filter(f => !f.virtual && !['image', 'password'].includes(f.type));
  const lines = [['ID', ...fields.map(f => f.label), ...mod.extras.map(e => e.label)]];
  for (const r of rows) {
    lines.push([
      r[mod.pk],
      ...fields.map(f => (f.type === 'fk' ? r[`${f.name}__label`] : r[f.name])),
      ...mod.extras.map(e => r[e.name]),
    ]);
  }
  const csv = lines.map(line => line.map(csvCell).join(';')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=${mod.key}_${todayISO()}.csv`);
  res.send(`﻿${csv}`); // BOM para que Excel reconozca UTF-8
});

crudRouter.get('/:key/:id', async (req, res) => {
  const mod = moduleOr404(req);
  res.json(await fetchOne(mod, parseId(req.params.id)));
});

function rejectSingleton(mod) {
  if (mod.singleton) throw new ApiError(`La ${mod.title.toLowerCase()} es un registro único: solo se puede editar.`, 405);
}

async function write(req, id) {
  const mod = moduleOr404(req, { write: true });
  if (id === null) rejectSingleton(mod);
  const data = req.body;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError('Se esperaba un objeto JSON.');
  const values = validate(mod, data, id === null, req.user);
  const savedId = await transaction(async q => {
    const previous = id !== null ? await fetchOne(mod, id, q) : null;
    await beforeSave(mod, values, id, q, req.user);
    const cols = Object.keys(values);
    let newId = id;
    if (id === null) {
      const result = await q.run(
        `INSERT INTO \`${mod.table}\` (${cols.map(c => `\`${c}\``).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        cols.map(c => values[c]),
      );
      newId = result.insertId;
    } else if (cols.length) {
      await q.run(`UPDATE \`${mod.table}\` SET ${cols.map(c => `\`${c}\` = ?`).join(', ')} WHERE \`${mod.pk}\` = ?`,
        [...cols.map(c => values[c]), id]);
    }
    // Una línea de salida cambió: actualizar el documento del pedido (y del pedido anterior si se movió).
    if (mod.key === 'salidas') await syncDocumentTotals(q, [previous?.id_n_pedido, values.id_n_pedido ?? previous?.id_n_pedido]);
    return newId;
  });
  const saved = await fetchOne(mod, savedId);
  // Deja el logo convertido y guardado apenas se configura, para que el primer PDF salga con logo.
  if (mod.key === 'empresa') prepareLogo(saved.emp_url_img);
  return saved;
}

crudRouter.post('/:key', async (req, res) => {
  res.status(201).json(await write(req, null));
});

crudRouter.put('/:key/:id', async (req, res) => {
  res.json(await write(req, parseId(req.params.id)));
});

crudRouter.delete('/:key/:id', async (req, res) => {
  const mod = moduleOr404(req, { write: true });
  rejectSingleton(mod);
  const id = parseId(req.params.id);
  await transaction(async q => {
    const previous = await fetchOne(mod, id, q);
    await beforeDelete(mod, id, q, req.user);
    await q.run(`DELETE FROM \`${mod.table}\` WHERE \`${mod.pk}\` = ?`, [id]);
    if (mod.key === 'salidas') await syncDocumentTotals(q, [previous.id_n_pedido]);
  });
  res.json({ ok: true });
});
