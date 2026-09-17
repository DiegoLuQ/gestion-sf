/*
 * 001 · Convierte la base original (v1) a la estructura mejorada v2, en la misma base.
 *
 * Detecta el estado de la base y actúa en consecuencia:
 *  - v1 (sistema anterior): renombra las tablas originales a respaldo_v1_*, crea las tablas v2,
 *    copia y limpia los datos, crea los triggers y recrea los procedimientos compatibles.
 *  - v2 (ya convertida, p. ej. importada desde santiago_filtros_v2): no modifica nada.
 *  - vacía: crea la estructura v2 y un usuario administrador.
 *  - conversión interrumpida (existen respaldo_v1_* pero faltan los triggers): borra lo creado
 *    a medias y vuelve a convertir desde las tablas respaldo_v1_*, que nunca se modifican.
 *
 * Los datos originales quedan intactos en las tablas respaldo_v1_* y, además, el ejecutor de
 * migraciones hace un respaldo .sql completo antes de empezar.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { columnExists, routineNames, runSqlFile, tableExists } from '../sql-utils.js';

export const descripcion = 'Conversión de la base original (v1) a la estructura v2 con llaves foráneas y datos limpios';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL = path.join(DIR, '..', 'schema.sql');
const TRIGGERS_SQL = path.join(DIR, '..', 'triggers.sql');

const V1_TABLES = ['sf_categoria', 'sf_subcategoria', 'sf_proveedor', 'sf_producto', 'sf_cliente', 'sf_vendedor',
  'sf_pedido', 'sf_salida_productos', 'sf_pedido_terminado', 't_usuarios'];
const V2_TABLES_DROP_ORDER = ['sf_usuario', 'sf_pedido_terminado', 'sf_salida_productos', 'sf_pedido', 'sf_vendedor',
  'sf_cliente', 'sf_producto', 'sf_proveedor', 'sf_marca', 'sf_subcategoria', 'sf_categoria'];
const V2_VIEWS = ['v_pedido_resumen', 'v_producto_stock_bajo', 'v_ventas_mensuales'];
const V2_TRIGGERS = ['trg_salida_ai', 'trg_salida_au', 'trg_salida_ad'];
const V = name => `respaldo_v1_${name}`;

// ---------------------------------------------------------------------------
//  Procedimientos del sistema anterior, reescritos para la estructura v2.
//  Devuelven las mismas columnas que los originales (prod_marca sale de sf_marca).
// ---------------------------------------------------------------------------
const PROCEDURES = {
  Docs: `CREATE PROCEDURE \`Docs\`(IN tu_variable_nump_numero VARCHAR(10))
    SELECT ped.nump_fecha, ped.nump_estado FROM sf_pedido AS ped WHERE ped.nump_numero = tu_variable_nump_numero`,
  'Para Blance': `CREATE PROCEDURE \`Para Blance\`()
    SELECT p.*, m.marca_nombre AS prod_marca, (p.prod_costo * p.prod_cantidad) AS Total_Costo
    FROM sf_producto p JOIN sf_marca m ON m.id_marca = p.id_marca`,
  Proc_Cliente: `CREATE PROCEDURE \`Proc_Cliente\`()
    SELECT cli_nombre, cli_comuna, cli_rut FROM sf_cliente`,
  Proc_NotaPedido: `CREATE PROCEDURE \`Proc_NotaPedido\`(IN nota_pedido INT)
    SELECT ped.nump_numero, ps.salip_cantidad, p.prod_codigo, p.prod_descripcion, m.marca_nombre AS prod_marca,
           ps.salip_venta, (ps.salip_venta * ps.salip_cantidad) AS totalVenta, ps.salip_fecha
    FROM sf_salida_productos ps
    JOIN sf_pedido ped ON ped.id_n_pedido = ps.id_n_pedido
    JOIN sf_producto p ON p.id_producto = ps.id_producto
    JOIN sf_marca m ON m.id_marca = p.id_marca
    WHERE ped.nump_numero = nota_pedido
    ORDER BY ps.id_salida_p DESC`,
  Proc_NotaPedido_Cliente: `CREATE PROCEDURE \`Proc_NotaPedido_Cliente\`(IN nota_pedido INT)
    SELECT c.cli_nombre, c.cli_telefono, c.cli_rut, c.id_cliente, c.cli_direccion, c.cli_correo, c.cli_comuna, c.cli_giro,
           np.id_n_pedido, np.nump_fecha, np.nump_estado, np.nump_observacion
    FROM sf_pedido np JOIN sf_cliente c ON c.id_cliente = np.id_cliente
    WHERE np.nump_numero = nota_pedido`,
};

// ---------------------------------------------------------------------------
//  Limpieza de datos
// ---------------------------------------------------------------------------
const PLACEHOLDERS = new Set(['', '-', 'S/T', 'S/C', 'S/N', 'S/I', '0']);
const NO_PLACEHOLDERS = new Set();

function clean(value, placeholders = PLACEHOLDERS) {
  if (value === null || value === undefined) return null;
  const text = String(value).split(/\s+/).filter(Boolean).join(' ');
  return placeholders.has(text.toUpperCase()) ? null : text;
}

const isUpper = s => s === s.toUpperCase() && s !== s.toLowerCase();
const isLower = s => s === s.toLowerCase() && s !== s.toUpperCase();
const title = s => s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

function titleEs(text) {
  if (!text) return text;
  const minor = new Set(['de', 'del', 'la', 'las', 'los', 'y']);
  return text.toLowerCase().split(/\s+/).map((w, i) => (i && minor.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

const BRAND_ALIASES = { kendal: 'kendall', wutex: 'wurtex', sure: 'sure filter', 'sure filte': 'sure filter' };
const BRAND_DISPLAY = {
  'sure filter': 'Sure Filter', 'daewha korea': 'Daewha Korea', 'swf korea': 'SWF Korea', 'eco filter': 'Eco Filter', 'speed mate': 'Speed Mate',
};
const SUBCAT_RENAME = {
  'Anti-Cogelante': 'Anticongelante', Halogeno: 'Halógeno', 'Filtro de Habitaculo': 'Filtro de Habitáculo', Electrico: 'Eléctrico',
};
const DOC_TYPES = { FACTURA: 'FACTURA', 'NOTA DE VENTA': 'NOTA DE VENTA', 'S/A': 'SIN DOCUMENTO', BOLETA: 'BOLETA' };
const PRODUCT_STATES = new Set(['Disponible', 'Descontinuado', 'Eliminado']);
const ORDER_STATES = new Set(['PENDIENTE', 'PAGADO', 'CHEQUE', 'ANULADO']);
const ROLES = ['Administrador', 'Vendedor', 'Consulta'];
const USELESS_LOCATION = /^[0\-/su ]*$/i;

function brandKey(name) {
  const key = String(name ?? '').split(/\s+/).filter(Boolean).join(' ').toLowerCase();
  return BRAND_ALIASES[key] ?? (key || 'sin marca');
}

// '12.345.678-k' -> '12345678-K'. Los RUT sin formato reconocible quedan vacíos.
function cleanRut(value) {
  const text = clean(value);
  if (!text) return null;
  const compact = text.replace(/[^0-9kK-]/g, '').toUpperCase();
  return /^\d{6,9}-[0-9K]$/.test(compact) ? compact : null;
}

function rutIsCompany(rut) {
  const digits = String(rut ?? '').split('-')[0].replace(/\D/g, '');
  return Boolean(digits) && Number(digits) >= 50_000_000;
}

function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return y > 1900 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// ---------------------------------------------------------------------------
//  Detección del estado de la base
// ---------------------------------------------------------------------------
async function detectState(conn) {
  if (await tableExists(conn, V('sf_producto'))) {
    const [trg] = await conn.query('SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?', ['trg_salida_ai']);
    return trg.length ? 'convertida' : 'reanudar';
  }
  if (await tableExists(conn, 'sf_producto')) {
    if (await columnExists(conn, 'sf_producto', 'prod_marca')) return 'v1';
    if (await columnExists(conn, 'sf_producto', 'id_marca')) return 'v2';
    throw new Error('La tabla sf_producto no tiene ni la estructura original (prod_marca) ni la v2 (id_marca). Revisa la base antes de migrar.');
  }
  for (const t of V1_TABLES) {
    if (await tableExists(conn, t)) throw new Error(`La base tiene la tabla ${t} pero no sf_producto: estructura incompleta, revisa la base antes de migrar.`);
  }
  return 'vacia';
}

async function renameV1Tables(conn, log) {
  const pairs = [];
  for (const t of V1_TABLES) {
    if (!(await tableExists(conn, t))) continue;
    if (await tableExists(conn, V(t))) throw new Error(`Ya existe ${V(t)}: no se puede renombrar ${t} sin sobrescribir un respaldo.`);
    pairs.push(`\`${t}\` TO \`${V(t)}\``);
  }
  await conn.query(`RENAME TABLE ${pairs.join(', ')}`);
  log(`  tablas originales renombradas a respaldo_v1_* (${pairs.length})`);
}

async function dropPartialV2(conn, log) {
  for (const t of V2_TRIGGERS) await conn.query(`DROP TRIGGER IF EXISTS \`${t}\``);
  for (const v of V2_VIEWS) await conn.query(`DROP VIEW IF EXISTS \`${v}\``);
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const t of V2_TABLES_DROP_ORDER) {
      // Solo tablas con la estructura v2 (columna creado_en): nunca una tabla original.
      if (await tableExists(conn, t) && await columnExists(conn, t, 'creado_en')) await conn.query(`DROP TABLE \`${t}\``);
    }
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }
  log('  conversión anterior incompleta: se borró lo creado a medias y se reintenta desde respaldo_v1_*');
}

async function recreateProcedures(conn, log, names) {
  let n = 0;
  for (const name of names) {
    if (!PROCEDURES[name]) {
      log(`  aviso: el procedimiento "${name}" no es conocido y puede usar columnas de la estructura anterior; revísalo.`);
      continue;
    }
    try {
      await conn.query(`DROP PROCEDURE IF EXISTS \`${name}\``);
      await conn.query(PROCEDURES[name]);
      n += 1;
    } catch (err) {
      log(`  aviso: no se pudo recrear el procedimiento "${name}" (${err.message}). La aplicación web no lo necesita.`);
    }
  }
  if (n) log(`  procedimientos recreados para la estructura v2: ${n}`);
  return n;
}

async function ensureAdmin(conn, log) {
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM sf_usuario');
  if (n > 0) return null;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  await conn.query("INSERT INTO sf_usuario (usu_nombre, usu_password_hash, usu_permiso) VALUES ('admin', ?, 'Administrador')",
    [await bcrypt.hash(password, 12)]);
  log('  ************************************************************');
  log('  Se creó el usuario "admin" porque la base no tenía usuarios.');
  log(process.env.ADMIN_PASSWORD ? '  Contraseña: la definida en ADMIN_PASSWORD.' : `  Contraseña temporal: ${password}  (cámbiala al ingresar)`);
  log('  ************************************************************');
  return 'admin';
}

// ---------------------------------------------------------------------------
//  Copia y limpieza de datos desde respaldo_v1_*
// ---------------------------------------------------------------------------
async function transform(conn, log) {
  const avisos = new Map();
  const warn = (msg, count = 1) => avisos.set(msg, (avisos.get(msg) ?? 0) + count);
  const read = async (table, sql) => ((await tableExists(conn, V(table))) ? (await conn.query(sql.replaceAll(`{${table}}`, `\`${V(table)}\``)))[0] : []);
  const inserted = [];

  async function insert(table, rows) {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    for (let i = 0; i < rows.length; i += 1000) {
      await conn.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ?`, [rows.slice(i, i + 1000).map(r => cols.map(c => r[c]))]);
    }
    inserted.push([table, rows.length]);
  }
  const text = (value, max, label, placeholders) => {
    const v = clean(value, placeholders);
    if (v && v.length > max) { warn(`${label}: texto recortado a ${max} caracteres`); return v.slice(0, max); }
    return v;
  };
  const uint = (value, label) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) { if (value !== null && value !== undefined) warn(`${label}: valor negativo o inválido → 0`); return 0; }
    return Math.round(n);
  };
  const date = (value, fallback, label) => {
    if (isValidDate(value)) return value;
    warn(`${label}: fecha inválida → reemplazada`);
    return fallback;
  };
  const uniqueName = (used, name) => {
    let candidate = name;
    for (let i = 2; used.has(candidate.toLowerCase()); i += 1) candidate = `${name} (${i})`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
  const today = todayISO();

  // ---------------- Categorías y subcategorías ----------------
  const catNames = new Set();
  const categorias = (await read('sf_categoria', 'SELECT * FROM {sf_categoria} ORDER BY id_categoria')).map(c => ({
    id_categoria: c.id_categoria, cat_nombre: uniqueName(catNames, text(c.cat_nombre, 50, 'Categoría') || `Categoría ${c.id_categoria}`),
  }));
  const ensureCategory = name => {
    let cat = categorias.find(c => c.cat_nombre.toLowerCase() === name.toLowerCase());
    if (!cat) {
      cat = { id_categoria: Math.max(0, ...categorias.map(c => c.id_categoria)) + 1, cat_nombre: uniqueName(catNames, name) };
      categorias.push(cat);
    }
    return cat.id_categoria;
  };
  const catByName = Object.fromEntries(categorias.map(c => [c.cat_nombre.trim().toLowerCase(), c.id_categoria]));
  const catIds = new Set(categorias.map(c => c.id_categoria));

  let fixedSubcats = 0;
  const subcatNames = new Map();
  const subcats = [];
  for (const sc of await read('sf_subcategoria', 'SELECT * FROM {sf_subcategoria} ORDER BY id_subcategoria')) {
    const name = text(sc.sub_nombre, 50, 'Subcategoría') || `Subcategoría ${sc.id_subcategoria}`;
    let idCat = sc.id_categoria;
    if (name.toLowerCase().startsWith('filtro') && catByName.filtros && idCat !== catByName.filtros) {
      idCat = catByName.filtros;
      fixedSubcats += 1;
    }
    if (!catIds.has(idCat)) {
      idCat = ensureCategory('Otros');
      catIds.add(idCat);
      warn('Subcategorías con categoría inexistente → "Otros"');
    }
    if (!subcatNames.has(idCat)) subcatNames.set(idCat, new Set());
    subcats.push({ id_subcategoria: sc.id_subcategoria, subc_nombre: uniqueName(subcatNames.get(idCat), SUBCAT_RENAME[name] ?? name), id_categoria: idCat });
  }
  const subcatIds = new Set(subcats.map(s => s.id_subcategoria));
  let otroSubcatId = subcats.find(x => x.subc_nombre.toLowerCase() === 'otro')?.id_subcategoria;
  const ensureOtroSubcat = () => {
    if (!otroSubcatId) {
      const idCat = ensureCategory('Otros');
      otroSubcatId = Math.max(0, ...subcats.map(s => s.id_subcategoria)) + 1;
      if (!subcatNames.has(idCat)) subcatNames.set(idCat, new Set());
      subcats.push({ id_subcategoria: otroSubcatId, subc_nombre: uniqueName(subcatNames.get(idCat), 'Otro'), id_categoria: idCat });
      subcatIds.add(otroSubcatId);
    }
    return otroSubcatId;
  };

  // ---------------- Marcas ----------------
  const productRows = await read('sf_producto', 'SELECT * FROM {sf_producto} ORDER BY id_producto');
  const spellings = new Map(); // clave canónica -> Map(escritura -> veces)
  for (const row of productRows) {
    const raw = String(row.prod_marca ?? '').split(/\s+/).filter(Boolean).join(' ');
    const key = brandKey(raw);
    if (!spellings.has(key)) spellings.set(key, new Map());
    spellings.get(key).set(raw, (spellings.get(key).get(raw) ?? 0) + 1);
  }
  if (!spellings.has('sin marca')) spellings.set('sin marca', new Map());
  const marcaId = {};
  const marcaNames = new Set();
  const marcas = [...spellings.keys()].sort().map((key, i) => {
    // Nombre a mostrar: el forzado, o la escritura más usada que coincide con la clave canónica.
    const exact = [...spellings.get(key)].filter(([o]) => o.toLowerCase() === key);
    let display = BRAND_DISPLAY[key] ?? (exact.length ? exact.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0] : title(key));
    if (isUpper(display) || isLower(display)) display = title(display);
    marcaId[key] = i + 1;
    return { id_marca: i + 1, marca_nombre: uniqueName(marcaNames, display.slice(0, 50)) };
  });

  // ---------------- Proveedores ----------------
  const ruts = new Set();
  const proveedores = (await read('sf_proveedor', 'SELECT * FROM {sf_proveedor} ORDER BY id_proveedor')).map(p => {
    let rut = cleanRut(p.prov_rut);
    if (rut && ruts.has(rut)) { warn('Proveedores con RUT repetido → RUT vacío en el duplicado'); rut = null; }
    if (rut) ruts.add(rut);
    return {
      id_proveedor: p.id_proveedor, prov_rut: rut, prov_nombre: text(p.prov_nombre, 100, 'Proveedor') || `Proveedor ${p.id_proveedor}`,
      prov_telefono: text(p.prov_telefono, 20, 'Proveedor teléfono'), prov_email: text(p.prov_email, 100, 'Proveedor correo'),
      prov_pais: text(p.prov_pais, 50, 'Proveedor país') || 'Chile', prov_ciudad: text(p.prov_ciudad, 50, 'Proveedor ciudad'),
      prov_direccion: text(p.prov_direccion, 150, 'Proveedor dirección'), prov_descripcion: text(p.prov_descripcion, 255, 'Proveedor descripción'),
    };
  });
  const provIds = new Set(proveedores.map(p => p.id_proveedor));
  let placeholderProvId = null;
  const fallbackProvider = () => {
    if (proveedores.length && !placeholderProvId) return proveedores[0].id_proveedor;
    if (!placeholderProvId) {
      placeholderProvId = Math.max(0, ...provIds) + 1;
      proveedores.push({ id_proveedor: placeholderProvId, prov_rut: null, prov_nombre: 'Proveedor no registrado (migración)', prov_telefono: null,
        prov_email: null, prov_pais: 'Chile', prov_ciudad: null, prov_direccion: null, prov_descripcion: null });
      provIds.add(placeholderProvId);
    }
    return placeholderProvId;
  };

  // ---------------- Productos (+ marcadores de productos borrados) ----------------
  const productos = productRows.map(p => {
    const ubic = clean(p.prod_ubicacion);
    let idSub = p.id_subcategoria;
    if (!subcatIds.has(idSub)) { warn('Productos con subcategoría inexistente → "Otro"'); idSub = ensureOtroSubcat(); }
    let idProv = p.id_proveedor;
    if (!provIds.has(idProv)) { warn('Productos con proveedor inexistente → proveedor por defecto'); idProv = fallbackProvider(); }
    let stock = Number(p.prod_cantidad) || 0;
    if (stock < 0) { warn('Productos con stock negativo → 0'); stock = 0; }
    const estado = String(p.prod_estado || 'Disponible').trim();
    if (!PRODUCT_STATES.has(estado)) warn(`Productos con estado desconocido → Disponible`);
    return {
      id_producto: p.id_producto, prod_codigo: text(p.prod_codigo, 30, 'Producto código') || `SIN-COD-${p.id_producto}`,
      prod_codigo2: text(p.prod_codigo2, 30, 'Producto código 2'), prod_descripcion: text(p.prod_descripcion, 255, 'Producto descripción') || '(sin descripción)',
      id_marca: marcaId[brandKey(p.prod_marca)], id_subcategoria: idSub, id_proveedor: idProv,
      prod_cantidad: stock, prod_costo: uint(p.prod_costo, 'Producto costo'), prod_venta: uint(p.prod_venta, 'Producto venta'),
      prod_ubicacion: !ubic || USELESS_LOCATION.test(ubic) ? null : ubic.slice(0, 20),
      prod_ruta_imagen: text(p.prod_ruta_imagen, 150, 'Producto imagen'), prod_estado: PRODUCT_STATES.has(estado) ? estado : 'Disponible',
      prod_fecha: date(p.prod_fecha, today, 'Producto fecha'),
    };
  });
  const existingProducts = new Set(productos.map(p => p.id_producto));
  const salidaRows = await read('sf_salida_productos', 'SELECT * FROM {sf_salida_productos} ORDER BY id_salida');
  const ghostStats = new Map();
  for (const s of salidaRows) {
    if (existingProducts.has(s.id_producto)) continue;
    const g = ghostStats.get(s.id_producto) ?? { fecha: null, costo: 0, venta: 0, n: 0 };
    if (isValidDate(s.salip_fecha) && (!g.fecha || s.salip_fecha < g.fecha)) g.fecha = s.salip_fecha;
    g.costo += Number(s.salip_costo) || 0;
    g.venta += Number(s.salip_venta) || 0;
    g.n += 1;
    ghostStats.set(s.id_producto, g);
  }
  const ghostIds = [...ghostStats.keys()].sort((a, b) => a - b);
  for (const id of ghostIds) {
    const g = ghostStats.get(id);
    productos.push({
      id_producto: id, prod_codigo: `ELIM-${id}`, prod_codigo2: null,
      prod_descripcion: `Producto eliminado (id ${id}) · recuperado del historial de ventas`,
      id_marca: marcaId['sin marca'], id_subcategoria: ensureOtroSubcat(), id_proveedor: fallbackProvider(),
      // Promedio redondeado "mitad hacia arriba" con aritmética entera (igual que ROUND(AVG()) de MySQL).
      prod_cantidad: 0, prod_costo: Math.max(0, Math.floor((2 * g.costo + g.n) / (2 * g.n))),
      prod_venta: Math.max(0, Math.floor((2 * g.venta + g.n) / (2 * g.n))),
      prod_ubicacion: null, prod_ruta_imagen: null, prod_estado: 'Eliminado', prod_fecha: g.fecha ?? today,
    });
  }

  await insert('sf_categoria', categorias);
  await insert('sf_subcategoria', subcats);
  await insert('sf_marca', marcas);
  await insert('sf_proveedor', proveedores);
  await insert('sf_producto', productos);

  // ---------------- Clientes (+ marcadores) ----------------
  let mergedNames = 0;
  const emptyClient = { cli_rut: null, cli_tipo_cliente: 'Persona', cli_giro: null, cli_direccion: null, cli_comuna: null, cli_ciudad: null, cli_telefono: null, cli_correo: null };
  const clientes = (await read('sf_cliente', 'SELECT * FROM {sf_cliente} ORDER BY id_cliente')).map(c => {
    let nombre = clean(c.cli_nombre);
    let giro = clean(c.cli_giro);
    if (giro && nombre && giro.toUpperCase().startsWith(nombre.toUpperCase())) {
      if (giro.length > nombre.length) { nombre = giro; mergedNames += 1; } // el nombre venía truncado; el giro traía la razón social
      giro = null;
    }
    const comuna = titleEs(text(c.cli_comuna, 50, 'Cliente comuna'));
    return {
      id_cliente: c.id_cliente, cli_rut: cleanRut(c.cli_rut), cli_tipo_cliente: rutIsCompany(c.cli_rut) ? 'Empresa' : 'Persona',
      cli_nombre: text(nombre, 250, 'Cliente nombre') || '(sin nombre)', cli_giro: text(giro, 250, 'Cliente giro'),
      cli_direccion: text(c.cli_direccion, 250, 'Cliente dirección'), cli_comuna: comuna, cli_ciudad: comuna,
      cli_telefono: text(c.cli_telefono, 20, 'Cliente teléfono'), cli_correo: text(c.cli_correo, 100, 'Cliente correo'),
    };
  });
  const pedidoRows = await read('sf_pedido', 'SELECT * FROM {sf_pedido} ORDER BY id_n_pedido');
  const existingClients = new Set(clientes.map(c => c.id_cliente));
  const ghostClients = [...new Set(pedidoRows.map(r => r.id_cliente))].filter(id => id > 0 && !existingClients.has(id)); // id 0 = sin cliente
  const placeholderClientId = Math.max(0, ...existingClients, ...ghostClients) + 1;
  for (const id of ghostClients) clientes.push({ id_cliente: id, ...emptyClient, cli_nombre: `Cliente eliminado (id ${id})` });
  clientes.push({ id_cliente: placeholderClientId, ...emptyClient, cli_nombre: 'Cliente no registrado (migración)' });
  await insert('sf_cliente', clientes);

  // ---------------- Vendedores ----------------
  const vendedores = (await read('sf_vendedor', 'SELECT * FROM {sf_vendedor} ORDER BY id_vendedor')).map(v => ({
    id_vendedor: v.id_vendedor, vend_nombre: text(v.vend_nombre, 100, 'Vendedor nombre') || `Vendedor ${v.id_vendedor}`,
    vend_telefono: text(v.vend_telefono, 20, 'Vendedor teléfono'), vend_fecha_ingreso: date(v.vend_fecha, today, 'Vendedor fecha'),
  }));
  const vendIds = new Set(vendedores.map(v => v.id_vendedor));
  await insert('sf_vendedor', vendedores);

  // ---------------- Pedidos (+ cabeceras reconstruidas) ----------------
  const docRows = await read('sf_pedido_terminado', 'SELECT * FROM {sf_pedido_terminado} ORDER BY id_documento');
  const vendedorPorPedido = new Map(docRows.map(r => [r.id_n_pedido, vendIds.has(r.id_vendedor) ? r.id_vendedor : null]));
  const numKey = value => clean(value, NO_PLACEHOLDERS);
  const pedidoPorNumero = new Map();
  const pedidos = pedidoRows.map(p => {
    let numero = (numKey(p.nump_numero) || `SN-${p.id_n_pedido}`).slice(0, 11);
    if (pedidoPorNumero.has(numero)) {
      warn('Pedidos con número repetido → se agregó un sufijo');
      numero = `${numero.slice(0, 6)}-D${p.id_n_pedido}`.slice(0, 11);
    } else {
      pedidoPorNumero.set(numero, p.id_n_pedido);
    }
    const estado = String(p.nump_estado || 'PENDIENTE').trim().toUpperCase();
    return {
      id_n_pedido: p.id_n_pedido, nump_numero: numero, nump_fecha: date(p.nump_fecha, today, 'Pedido fecha'),
      id_cliente: existingClients.has(p.id_cliente) || ghostClients.includes(p.id_cliente) ? p.id_cliente : placeholderClientId,
      id_vendedor: vendedorPorPedido.get(p.id_n_pedido) ?? null,
      nump_estado: ORDER_STATES.has(estado) ? estado : 'PENDIENTE', nump_observacion: clean(p.nump_observacion),
    };
  });
  let nextId = Math.max(0, ...pedidos.map(p => p.id_n_pedido)) + 1;
  let rebuilt = 0;
  const missingOrders = new Map(); // número -> fecha mínima, en orden de aparición
  for (const s of salidaRows) {
    const key = numKey(s.nump_numero) ?? '';
    if (pedidoPorNumero.has(key)) continue;
    const prev = missingOrders.get(key);
    if (prev === undefined || (isValidDate(s.salip_fecha) && (!prev || s.salip_fecha < prev))) missingOrders.set(key, isValidDate(s.salip_fecha) ? s.salip_fecha : prev ?? null);
  }
  for (const [numero, fecha] of missingOrders) {
    pedidos.push({
      id_n_pedido: nextId, nump_numero: (numero || `SN-${nextId}`).slice(0, 11), nump_fecha: fecha ?? today, id_cliente: placeholderClientId,
      id_vendedor: null, nump_estado: 'PENDIENTE', nump_observacion: 'Cabecera reconstruida en la migración: existía detalle sin pedido.',
    });
    pedidoPorNumero.set(numero, nextId);
    nextId += 1;
    rebuilt += 1;
  }
  await insert('sf_pedido', pedidos);

  // ---------------- Salida de productos ----------------
  const fechaPedido = new Map(pedidos.map(p => [p.id_n_pedido, p.nump_fecha]));
  let futureDates = 0;
  const salidas = [];
  for (const r of salidaRows) {
    const qty = Number(r.salip_cantidad);
    if (!(qty > 0)) { warn('Líneas de salida con cantidad 0 o negativa → omitidas'); continue; }
    const idPedido = pedidoPorNumero.get(numKey(r.nump_numero) ?? '');
    let fecha = r.salip_fecha;
    if (!isValidDate(fecha)) { fecha = fechaPedido.get(idPedido); warn('Líneas de salida con fecha inválida → fecha del pedido'); } else if (fecha > today) { fecha = fechaPedido.get(idPedido); futureDates += 1; } // años imposibles (2556, 2631...)
    salidas.push({
      id_salida_p: r.id_salida, id_n_pedido: idPedido, id_producto: r.id_producto, salip_fecha: fecha,
      salip_cantidad: qty, salip_costo: uint(r.salip_costo, 'Salida costo'), salip_venta: uint(r.salip_venta, 'Salida venta'),
    });
  }
  await insert('sf_salida_productos', salidas);

  // ---------------- Documentos ----------------
  const pedidoIds = new Set(pedidos.map(p => p.id_n_pedido));
  const pedidosConDoc = new Set();
  const documentos = [];
  for (const r of docRows) {
    if (!pedidoIds.has(r.id_n_pedido)) { warn('Documentos de un pedido inexistente → omitidos'); continue; }
    if (pedidosConDoc.has(r.id_n_pedido)) { warn('Pedidos con más de un documento → se conservó el primero'); continue; }
    pedidosConDoc.add(r.id_n_pedido);
    documentos.push({
      id_documento: r.id_documento, docu_tipo: DOC_TYPES[String(r.docu_tipo ?? '').trim().toUpperCase()] ?? 'SIN DOCUMENTO',
      docu_numero: (clean(r.docu_numero, NO_PLACEHOLDERS) || 'S/N').slice(0, 20), docu_fecha: date(r.docu_fecha, fechaPedido.get(r.id_n_pedido), 'Documento fecha'),
      id_n_pedido: r.id_n_pedido, id_vendedor: vendIds.has(r.id_vendedor) ? r.id_vendedor : null,
      docu_costo: uint(r.docu_costo, 'Documento costo'), docu_venta: uint(r.docu_venta, 'Documento venta'),
    });
  }
  await insert('sf_pedido_terminado', documentos);

  // ---------------- Usuarios (contraseñas cifradas) ----------------
  // La columna "contraseña" puede tener el nombre con encoding roto: se lee por posición.
  const usuarios = [];
  if (await tableExists(conn, V('t_usuarios'))) {
    const [legacyUsers] = await conn.query({ sql: `SELECT * FROM \`${V('t_usuarios')}\``, rowsAsArray: true });
    const names = new Set();
    for (const [usuario, clave, permisoRaw] of legacyUsers) {
      const nombre = String(usuario ?? '').trim().slice(0, 30);
      if (!nombre || names.has(nombre.toLowerCase())) { warn('Usuarios vacíos o repetidos → omitidos'); continue; }
      names.add(nombre.toLowerCase());
      const permiso = capitalize(String(permisoRaw ?? '').trim());
      usuarios.push({
        usu_nombre: nombre, usu_password_hash: await bcrypt.hash(String(clave ?? ''), 12),
        usu_permiso: ROLES.includes(permiso) ? permiso : 'Consulta',
      });
    }
  }
  await insert('sf_usuario', usuarios);

  const totalSpellings = [...spellings.values()].reduce((a, m) => a + m.size, 0);
  const lines = [
    ...inserted.map(([t, n]) => `${t}: ${n} filas`),
    `subcategorías de filtros movidas a 'Filtros': ${fixedSubcats}`,
    `marcas originales -> normalizadas: ${totalSpellings} -> ${marcas.length}`,
    `productos borrados recuperados del historial: ${ghostIds.length}`,
    `clientes borrados recuperados: ${ghostClients.length}`,
    `pedidos sin cliente -> 'Cliente no registrado': ${pedidos.filter(p => p.id_cliente === placeholderClientId).length}`,
    `nombres de cliente completados desde el giro: ${mergedNames}`,
    `pedidos reconstruidos (detalle sin cabecera): ${rebuilt}`,
    `líneas con fecha futura -> fecha del pedido: ${futureDates}`,
    ...[...avisos].map(([msg, n]) => `aviso · ${msg}: ${n}`),
  ];
  lines.forEach(l => log(`  ${l}`));
  return lines;
}

// ---------------------------------------------------------------------------
export async function up({ conn, log }) {
  const state = await detectState(conn);
  log(`  estado detectado: ${state}`);

  if (state === 'v2') return 'La base ya tenía la estructura v2: no se modificó.';

  if (state === 'vacia') {
    await runSqlFile(conn, SCHEMA_SQL);
    await runSqlFile(conn, TRIGGERS_SQL);
    await ensureAdmin(conn, log);
    return 'Base vacía: se creó la estructura v2.';
  }

  const procedures = await routineNames(conn);

  if (state === 'convertida') {
    await recreateProcedures(conn, log, procedures);
    return 'La conversión ya estaba completa (faltaba registrarla): se recrearon los procedimientos.';
  }

  if (state === 'v1') await renameV1Tables(conn, log);
  if (state === 'reanudar') await dropPartialV2(conn, log);

  await runSqlFile(conn, SCHEMA_SQL);
  const lines = await transform(conn, log);
  // Solo para pruebas: permite verificar que una conversión interrumpida se reanuda bien.
  if (process.env.MIGRACION_FALLO_SIMULADO === '001') throw new Error('Fallo simulado para probar la reanudación');
  await runSqlFile(conn, TRIGGERS_SQL);
  await recreateProcedures(conn, log, procedures);
  await ensureAdmin(conn, log);
  return [`Conversión desde ${state === 'v1' ? 'la base original' : 'respaldo_v1_* (reanudada)'}`, ...lines,
    'Las tablas originales quedaron como respaldo_v1_*.'].join('\n');
}
