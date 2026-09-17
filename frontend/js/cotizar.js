// Cotización por enlace: el cliente busca productos, indica cantidades y envía sus datos.
// El borrador (productos y datos) se guarda en este navegador para no perderlo si cierra la página.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const PAGE_SIZE = 60;
const MAX_CANTIDAD = 99999;
const token = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] ?? '');
const draftKey = `sf-cotizacion-${token}`;
const app = $('#app');

let productos = [];
let cliente = null; // cliente del enlace, cuando está asociado a uno
let byId = new Map();
const state = { q: '', cat: '', limit: PAGE_SIZE };
let cart = new Map(); // id -> cantidad

// ---------------------------------------------------------------- Borrador
function loadDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey) || '{}');
    cart = new Map(Object.entries(draft.items ?? {}).map(([id, qty]) => [Number(id), Number(qty)]).filter(([id, qty]) => byId.has(id) && qty > 0));
    return draft.form ?? {};
  } catch { return {}; }
}
function saveDraft() {
  const form = $('[data-form]');
  const data = form ? Object.fromEntries(['nombre', 'celular', 'rut', 'comentario'].map(k => [k, form[k]?.value ?? ''])) : {};
  try { localStorage.setItem(draftKey, JSON.stringify({ items: Object.fromEntries(cart), form: data })); } catch { /* sin almacenamiento */ }
}
function clearDraft() {
  try { localStorage.removeItem(draftKey); } catch { /* sin almacenamiento */ }
}

// ---------------------------------------------------------------- API
async function request(method, body) {
  const res = await fetch(`/api/cotizar/${encodeURIComponent(token)}`, {
    method,
    headers: { Accept: 'application/json', 'X-Requested-With': 'fetch', ...(body && { 'Content-Type': 'application/json' }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'No se pudo completar la solicitud. Intenta de nuevo.');
    Object.assign(err, { status: res.status, errors: data.errors || {} });
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------- Estados
const NO_IMAGE = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>';
const ICON_OK = '<svg class="i" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>';
const ICON_BAD = '<svg class="i" viewBox="0 0 24 24"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.5"/></svg>';

function showMessage(title, text) {
  document.body.classList.remove('sheet-open');
  app.innerHTML = `<div class="state-card"><div class="state-icon bad">${ICON_BAD}</div><h1>${esc(title)}</h1><p>${esc(text)}</p></div>`;
}

function showSuccess({ numero, nombre }, items) {
  document.body.classList.remove('sheet-open');
  app.innerHTML = `
    <div class="state-card">
      <div class="state-icon ok">${ICON_OK}</div>
      <h1>¡Gracias, ${esc(nombre.split(' ')[0])}!</h1>
      <p>Recibimos tu solicitud${numero ? ` <b>N° ${esc(numero)}</b>` : ''}. Te contactaremos con los precios y la disponibilidad.</p>
      <ul class="summary">${items.map(([id, qty]) => {
        const p = byId.get(id);
        return `<li><span><b>${esc(p.codigo)}</b> · ${esc(p.marca)}</span><b>${qty} ${qty === 1 ? 'unidad' : 'unidades'}</b></li>`;
      }).join('')}</ul>
      <button type="button" class="btn" data-again>Hacer otra cotización</button>
    </div>`;
  window.scrollTo(0, 0);
  $('[data-again]').addEventListener('click', () => { cart = new Map(); renderMain({}); window.scrollTo(0, 0); });
}

// ---------------------------------------------------------------- Catálogo
function filtered() {
  const terms = normalize(state.q).split(/\s+/).filter(Boolean);
  return productos.filter(p => (!state.cat || p.categoria === state.cat) && terms.every(t => p._search.includes(t)));
}

function qtyControl(id, qty, cls = '') {
  return `<span class="qty ${cls}" data-qty="${id}">
    <button type="button" data-step="-1" aria-label="Quitar uno">−</button>
    <input type="number" inputmode="numeric" min="0" max="${MAX_CANTIDAD}" value="${qty}" aria-label="Cantidad">
    <button type="button" data-step="1" aria-label="Agregar uno">+</button>
  </span>`;
}

function productAction(p) {
  const qty = cart.get(p.id);
  return qty
    ? qtyControl(p.id, qty)
    : `<button type="button" class="btn btn-add" data-add="${p.id}">Agregar</button>`;
}

function renderProducts() {
  const list = filtered();
  const shown = list.slice(0, state.limit);
  $('[data-count]').textContent = list.length === productos.length
    ? `${productos.length} productos disponibles`
    : `${list.length} ${list.length === 1 ? 'producto' : 'productos'} de ${productos.length}`;
  $('[data-products]').innerHTML = shown.length
    ? shown.map(p => `
      <li class="product ${cart.has(p.id) ? 'added' : ''}" data-id="${p.id}">
        <div class="product-thumb">${p.imagen
          ? `<img src="${esc(p.imagen)}" alt="${esc(p.codigo)}" loading="lazy" decoding="async" width="64" height="64">`
          : NO_IMAGE}</div>
        <div>
          <div class="product-top"><span class="product-code">${esc(p.codigo)}</span><span class="product-brand">${esc(p.marca)}</span></div>
          ${p.descripcion ? `<p class="product-desc">${esc(p.descripcion)}</p>` : ''}
          <span class="product-cat">${esc(p.categoria)}</span>
        </div>
        <div class="product-action">${productAction(p)}</div>
      </li>`).join('')
    : '<li class="empty">No encontramos productos con esa búsqueda. Puedes contarnos lo que necesitas en el comentario.</li>';
  $('[data-more]').hidden = list.length <= state.limit;
}

function refreshProduct(id) {
  const li = $(`.product[data-id="${id}"]`);
  if (!li) return;
  li.classList.toggle('added', cart.has(id));
  $('.product-action', li).innerHTML = productAction(byId.get(id));
}

// ---------------------------------------------------------------- Carrito
function renderCart() {
  const items = [...cart];
  $('[data-cart-items]').innerHTML = items.map(([id, qty]) => {
    const p = byId.get(id);
    return `<li class="cart-item">
      <div><b>${esc(p.codigo)}</b><small>${esc(p.marca)}${p.descripcion ? ` · ${esc(p.descripcion)}` : ''}</small></div>
      ${qtyControl(id, qty)}
      <button type="button" class="icon-btn cart-remove" data-remove="${id}" aria-label="Quitar ${esc(p.codigo)}">
        <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>
      </button>
    </li>`;
  }).join('');
  $('[data-cart-empty]').hidden = items.length > 0;
  $('[data-cart-count]').textContent = items.length;
  $('[data-bar-count]').textContent = items.length;
  $('[data-bar-label]').textContent = items.length === 1 ? 'producto' : 'productos';
  if (items.length) setError('items', '');
}

function setQty(id, qty) {
  qty = Math.max(0, Math.min(MAX_CANTIDAD, Math.trunc(Number(qty)) || 0));
  if (qty > 0) cart.set(id, qty); else cart.delete(id);
  refreshProduct(id);
  renderCart();
  saveDraft();
}

// ---------------------------------------------------------------- Formulario
function setError(name, message) {
  const el = $(`[data-error="${name}"]`);
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
  el.closest('.field')?.classList.toggle('has-error', Boolean(message));
}

function openSheet(open) {
  $('[data-cart]').classList.toggle('open', open);
  document.body.classList.toggle('sheet-open', open);
  if (open) $('[data-cart-close]').focus();
}

async function submit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const button = $('[data-submit]');
  const formError = $('[data-form-error]');
  formError.hidden = true;
  ['nombre', 'celular', 'rut', 'comentario', 'items'].forEach(n => setError(n, ''));

  const body = {
    nombre: cliente ? cliente.nombre : form.nombre.value.trim(),
    celular: cliente ? '' : form.celular.value.trim(),
    rut: cliente ? '' : form.rut.value.trim(),
    comentario: form.comentario.value.trim(),
    sitio_web: form.sitio_web.value,
    items: [...cart].map(([id, cantidad]) => ({ id, cantidad })),
  };
  let invalid = false;
  if (!cliente && body.nombre.length < 2) { setError('nombre', 'Ingresa tu nombre.'); invalid = true; }
  if (!body.items.length) { setError('items', 'Agrega al menos un producto a tu cotización.'); invalid = true; }
  if (invalid) { (!cliente && body.nombre.length < 2 ? form.nombre : button).focus(); return; }

  button.disabled = true;
  button.textContent = 'Enviando…';
  try {
    const result = await request('POST', body);
    const items = [...cart];
    clearDraft();
    showSuccess(result, items);
  } catch (err) {
    for (const [name, message] of Object.entries(err.errors ?? {})) setError(name, message);
    formError.textContent = err.message;
    formError.hidden = false;
    button.disabled = false;
    button.textContent = 'Enviar cotización';
  }
}

// ---------------------------------------------------------------- Vista principal
function renderMain(formValues) {
  app.replaceChildren($('#tpl-main').content.cloneNode(true));

  const cats = [...new Set(productos.map(p => p.categoria))].sort((a, b) => a.localeCompare(b, 'es'));
  $('[data-cats]').innerHTML = [`<button type="button" class="cat" data-cat="" aria-pressed="true">Todas</button>`]
    .concat(cats.map(c => `<button type="button" class="cat" data-cat="${esc(c)}" aria-pressed="false">${esc(c)}</button>`)).join('');

  const form = $('[data-form]');
  // Enlace de un cliente: se saluda por su nombre y se ocultan los campos de identidad.
  if (cliente) {
    $('[data-cliente]').innerHTML = `Cotización para <b>${esc(cliente.nombre)}</b>`;
    $('[data-cliente]').hidden = false;
    $('[data-datos-titulo]').textContent = 'Envíanos tu cotización';
    $$('[data-solo-publico]').forEach(el => { el.hidden = true; });
  }
  for (const [k, v] of Object.entries(formValues)) if (form[k] && typeof v === 'string' && !form[k].closest('[data-solo-publico]')) form[k].value = v;

  state.q = ''; state.cat = ''; state.limit = PAGE_SIZE;
  renderProducts();
  renderCart();

  let timer;
  $('[data-search]').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value; state.limit = PAGE_SIZE; renderProducts(); }, 150);
  });
  $('[data-cats]').addEventListener('click', e => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    state.cat = btn.dataset.cat;
    state.limit = PAGE_SIZE;
    $$('.cat').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    renderProducts();
  });
  $('[data-more]').addEventListener('click', () => { state.limit += PAGE_SIZE; renderProducts(); });

  form.addEventListener('input', () => saveDraft());
  form.addEventListener('submit', submit);
  $('[data-cart-open]').addEventListener('click', () => openSheet(true));
  $('[data-cart-close]').addEventListener('click', () => openSheet(false));
}

// Eventos delegados en #app: se registran una sola vez aunque la vista se vuelva a dibujar.
function bindAppEvents() {
  // Agregar, sumar, restar, escribir cantidad y quitar (lista y carrito).
  app.addEventListener('click', e => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const id = Number(add.dataset.add);
      setQty(id, 1);
      $(`.product[data-id="${id}"] .qty input`)?.select();
      return;
    }
    const step = e.target.closest('[data-step]');
    if (step) {
      const id = Number(step.closest('[data-qty]').dataset.qty);
      setQty(id, (cart.get(id) ?? 0) + Number(step.dataset.step));
      return;
    }
    const remove = e.target.closest('[data-remove]');
    if (remove) setQty(Number(remove.dataset.remove), 0);
  });
  app.addEventListener('change', e => {
    const box = e.target.closest('[data-qty]');
    if (box && e.target.matches('input')) setQty(Number(box.dataset.qty), e.target.value);
  });
  app.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.closest('[data-qty]') && e.target.matches('input')) { e.preventDefault(); e.target.blur(); }
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('[data-cart]')) openSheet(false); });
}

// ---------------------------------------------------------------- Inicio
async function init() {
  try {
    const data = await request('GET');
    $('[data-empresa]').textContent = data.empresa.nombre;
    document.title = `Solicitud de cotización · ${data.empresa.nombre}`;
    if (data.empresa.logo) {
      const img = new Image();
      img.alt = '';
      img.onload = () => { const mark = $('[data-logo]'); mark.classList.add('has-logo'); mark.replaceChildren(img); };
      img.src = data.empresa.logo;
    }
    cliente = data.cliente;
    productos = data.productos.map(p => ({ ...p, _search: normalize(`${p.codigo} ${p.descripcion} ${p.marca} ${p.categoria}`) }));
    byId = new Map(productos.map(p => [p.id, p]));
    bindAppEvents();
    renderMain(loadDraft());
  } catch (err) {
    const title = err.status === 410 ? 'Enlace no disponible' : err.status === 404 ? 'Enlace no válido' : 'No pudimos cargar la página';
    showMessage(title, err.message);
  }
}

init();
