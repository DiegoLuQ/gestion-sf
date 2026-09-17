// Catálogo en línea (/catalogo/<código>): productos disponibles con búsqueda y filtro por categoría.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmtDate = iso => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}-${m}-${y}`; };

const PAGE_SIZE = 48;
const clp = n => `$${Math.round(n).toLocaleString('es-CL')}`;
const token = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] ?? '');
const app = $('#app');
const state = { q: '', cat: '', limit: PAGE_SIZE };
let productos = [];

const NO_IMAGE = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>';
const ICON_BAD = '<svg class="i" viewBox="0 0 24 24"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.5"/></svg>';

function render() {
  const terms = normalize(state.q).split(/\s+/).filter(Boolean);
  const list = productos.filter(p => (!state.cat || p.categoria === state.cat) && terms.every(t => p._search.includes(t)));
  $('[data-count]').textContent = list.length === productos.length
    ? `${productos.length} productos`
    : `${list.length} ${list.length === 1 ? 'producto' : 'productos'} de ${productos.length}`;
  $('[data-grid]').innerHTML = list.length
    ? list.slice(0, state.limit).map(p => `
      <li class="item">
        <div class="item-media ${p.imagen ? '' : 'empty-media'}">${p.imagen
          ? `<img src="${esc(p.imagen)}" alt="${esc(`${p.codigo} ${p.marca}`)}" loading="lazy" decoding="async">`
          : NO_IMAGE}</div>
        <div class="item-body">
          <div class="item-top"><span class="item-code">${esc(p.codigo)}</span><span class="item-brand">${esc(p.marca)}</span></div>
          ${p.descripcion ? `<p class="item-desc">${esc(p.descripcion)}</p>` : ''}
          <div class="item-foot">
            <span class="product-cat">${esc(p.categoria)}</span>
            ${p.precio
              ? `<span class="item-price">${clp(p.precio)}<small>IVA incluido</small></span>`
              : '<span class="item-price consult">Consultar precio</span>'}
          </div>
        </div>
      </li>`).join('')
    : '<li class="empty" style="grid-column:1/-1">No encontramos productos con esa búsqueda.</li>';
  $('[data-more]').hidden = list.length <= state.limit;
}

async function init() {
  let data;
  try {
    const res = await fetch(`/api/catalogo-publico/${encodeURIComponent(token)}`, { headers: { Accept: 'application/json' } });
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'No pudimos cargar el catálogo.'), { status: res.status });
  } catch (err) {
    const title = err.status === 410 ? 'Catálogo no disponible' : err.status === 404 ? 'Enlace no válido' : 'No pudimos cargar el catálogo';
    app.innerHTML = `<div class="state-card"><div class="state-icon bad">${ICON_BAD}</div><h1>${esc(title)}</h1><p>${esc(err.message)}</p></div>`;
    return;
  }

  $('[data-empresa]').textContent = data.empresa.nombre;
  document.title = `Catálogo de productos · ${data.empresa.nombre}`;
  if (data.empresa.logo) {
    const img = new Image();
    img.alt = '';
    img.onload = () => { const mark = $('[data-logo]'); mark.classList.add('has-logo'); mark.replaceChildren(img); };
    img.src = data.empresa.logo;
  }

  productos = data.productos.map(p => ({ ...p, _search: normalize(`${p.codigo} ${p.descripcion} ${p.marca} ${p.categoria}`) }));
  app.replaceChildren($('#tpl-main').content.cloneNode(true));

  const cats = [...new Set(productos.map(p => p.categoria))];
  $('[data-resumen]').textContent = `${productos.length} productos disponibles en ${cats.length} categorías.`;
  $('[data-vence]').textContent = `Enlace válido hasta el ${fmtDate(data.vence)}`;
  $('[data-cats]').innerHTML = ['<button type="button" class="cat" data-cat="" aria-pressed="true">Todas</button>']
    .concat(cats.map(c => `<button type="button" class="cat" data-cat="${esc(c)}" aria-pressed="false">${esc(c)}</button>`)).join('');

  let timer;
  $('[data-search]').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value; state.limit = PAGE_SIZE; render(); }, 150);
  });
  $('[data-cats]').addEventListener('click', e => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    state.cat = btn.dataset.cat;
    state.limit = PAGE_SIZE;
    $$('.cat').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    render();
  });
  $('[data-more]').addEventListener('click', () => { state.limit += PAGE_SIZE; render(); });
  render();
}

init();
