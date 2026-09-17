// Arranque de la aplicación: sesión, menú, sidebar, tema y enrutador por hash.
import { api } from './api.js';
import { renderModule } from './crud.js';
import { renderDashboard } from './dashboard.js';
import { $, $$, applyTheme, currentTheme, esc, h, icon, toast } from './ui.js';

window.SF = { modules: {}, user: null, empresa: { nombre: 'Santiago Filtros', slogan: null, url_img: null } };
const QUICK_LINKS = ['productos', 'pedidos', 'clientes'];
const mobile = () => matchMedia('(max-width: 960px)').matches;
let cleanup = null;

// Nombre, slogan y logo de la empresa (tabla sf_empresa) en el menú y el título de la pestaña.
function applyBranding(empresa) {
  Object.assign(window.SF.empresa, empresa);
  const { nombre, slogan, url_img: logo } = window.SF.empresa;
  $$('[data-brand-name]').forEach(el => { el.textContent = nombre; });
  $$('[data-brand-slogan]').forEach(el => { el.textContent = slogan || 'Sistema de gestión'; });
  const mark = $('.topbar .brand-mark');
  if (/^https?:\/\//i.test(logo || '')) {
    mark.classList.add('has-logo');
    mark.innerHTML = `<img data-fallback src="${esc(logo)}" alt="">`;
  } else {
    mark.classList.remove('has-logo');
    mark.innerHTML = icon('filterLogo');
  }
  document.title = document.title.replace(/·.*$/, `· ${nombre}`);
}
window.SF.applyBranding = applyBranding;

function buildShell(user, modules) {
  $('[data-menu-toggle]').innerHTML = icon('menu');
  $('[data-theme-toggle]').innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon');
  $('[data-sidebar-close]').innerHTML = icon('x');

  const groups = [];
  for (const mod of modules.filter(m => !m.hidden)) {
    let g = groups.find(x => x.name === mod.group);
    if (!g) groups.push(g = { name: mod.group, items: [] });
    g.items.push(mod);
  }
  $('#sidebar nav').innerHTML = `
    <div class="nav-group">
      <a class="nav-link" href="#/" data-route="" title="Inicio">${icon('home')}<span>Inicio</span></a>
    </div>
    ${groups.map(g => `
      <div class="nav-group">
        <div class="nav-title">${esc(g.name)}</div>
        ${g.items.map(m => `<a class="nav-link" href="#/${m.key}" data-route="${m.key}" title="${esc(m.title)}">${icon(m.icon)}<span>${esc(m.title)}</span></a>`).join('')}
      </div>`).join('')}`;

  $('.topnav').innerHTML = `<a href="#/" data-route="">${icon('home')} Inicio</a>` +
    QUICK_LINKS.filter(k => window.SF.modules[k])
      .map(k => `<a href="#/${k}" data-route="${k}">${icon(window.SF.modules[k].icon)} ${esc(window.SF.modules[k].title)}</a>`).join('');

  $('.user-menu').innerHTML = `
    <button class="user-btn" aria-haspopup="menu" aria-expanded="false">
      <span class="avatar">${esc(user.usuario.slice(0, 2))}</span>
      <span class="user-meta"><b>${esc(user.usuario)}</b><small>${esc(user.permiso)}</small></span>
      ${icon('chevronDown')}
    </button>
    <div class="dropdown" role="menu" hidden>
      <div class="dropdown-head"><b>${esc(user.usuario)}</b><small>Permiso: ${esc(user.permiso)}</small></div>
      ${window.SF.modules.empresa ? `<a href="#/empresa" role="menuitem">${icon('building')} Configuración de la empresa</a>` : ''}
      ${window.SF.modules.usuarios ? `<a href="#/usuarios" role="menuitem">${icon('key')} Usuarios</a>` : ''}
      <button data-theme-menu role="menuitem">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')} Cambiar tema</button>
      <button data-logout role="menuitem">${icon('logout')} Cerrar sesión</button>
    </div>`;
}

function wireShell() {
  const body = document.body;
  // En tablets horizontales y notebooks chicos (961–1279 px) el menú lateral parte compacto (solo íconos)
  // para dejar espacio a las tablas. Desde 1280 px se respeta la preferencia guardada.
  const compactRange = matchMedia('(min-width: 961px) and (max-width: 1279px)');
  const savedPreference = () => { try { return localStorage.getItem('sf-sidebar'); } catch { return null; } };
  const applySidebarMode = () => {
    body.classList.toggle('sidebar-collapsed', compactRange.matches || savedPreference() === 'collapsed');
  };
  // Estado inicial sin animación (evita que el menú "salte" al cargar la página).
  body.classList.add('no-anim');
  applySidebarMode();
  setTimeout(() => body.classList.remove('no-anim'), 60);
  compactRange.addEventListener('change', applySidebarMode);

  $('[data-menu-toggle]').addEventListener('click', () => {
    if (mobile()) {
      body.classList.toggle('sidebar-open');
    } else {
      body.classList.toggle('sidebar-collapsed');
      if (!compactRange.matches) {
        try { localStorage.setItem('sf-sidebar', body.classList.contains('sidebar-collapsed') ? 'collapsed' : 'open'); } catch { /* */ }
      }
    }
  });
  const closeSidebar = () => body.classList.remove('sidebar-open');
  $('.overlay').addEventListener('click', closeSidebar);
  $('[data-sidebar-close]').addEventListener('click', closeSidebar);
  $('#sidebar').addEventListener('click', e => { if (e.target.closest('.nav-link')) closeSidebar(); });

  const toggleTheme = () => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    $('[data-theme-toggle]').innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon');
    route(); // el gráfico toma los colores nuevos al redibujarse
  };
  $('[data-theme-toggle]').addEventListener('click', toggleTheme);

  const menu = $('.user-menu');
  const btn = $('.user-btn', menu);
  const dropdown = $('.dropdown', menu);
  const setOpen = open => { dropdown.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', e => { e.stopPropagation(); setOpen(dropdown.hidden); });
  document.addEventListener('click', e => { if (!menu.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { setOpen(false); closeSidebar(); } });
  dropdown.addEventListener('click', async e => {
    if (e.target.closest('a')) setOpen(false);
    if (e.target.closest('[data-theme-menu]')) { setOpen(false); toggleTheme(); }
    if (e.target.closest('[data-logout]')) {
      try { await api.post('/api/auth/logout'); } catch { /* se redirige igual */ }
      location.href = '/acceso-sf';
    }
  });

  // Imágenes de producto cuyo archivo no existe: se reemplazan por un ícono.
  document.addEventListener('error', e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-fallback')) return;
    const mark = img.closest('.brand-mark');
    if (mark) {
      mark.classList.remove('has-logo');
      mark.innerHTML = icon('filterLogo');
      return;
    }
    const holder = h(`<span class="${img.classList.contains('thumb') ? 'thumb' : ''}">${icon('image')}</span>`);
    if (img.classList.contains('details-image')) img.remove(); else img.replaceWith(holder);
  }, true);

  window.addEventListener('hashchange', route);
}

function navigate(hash, { force = false } = {}) {
  if (location.hash === hash && force) route();
  else location.hash = hash;
}

function route() {
  cleanup?.();
  cleanup = null;
  $$('.modal-backdrop').forEach(m => m.remove());
  document.body.style.overflow = '';
  const raw = location.hash.replace(/^#\/?/, '');
  const [key, qs = ''] = raw.split('?');
  const view = $('#view');
  const mod = window.SF.modules[key];

  $$('[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === (mod ? key : '')));
  const crumbs = $('.crumbs');
  if (mod) {
    crumbs.innerHTML = `<span>${esc(mod.group)}</span>${icon('chevronRight')}<b>${esc(mod.title)}</b>`;
    document.title = `${mod.title} · ${window.SF.empresa.nombre}`;
    renderModule(view, mod, new URLSearchParams(qs), { navigate });
  } else {
    if (key) history.replaceState(null, '', '#/');
    crumbs.innerHTML = '<b>Inicio</b>';
    document.title = `Inicio · ${window.SF.empresa.nombre}`;
    renderDashboard(view, { navigate }).then(stop => { cleanup = stop || null; });
  }
  window.scrollTo(0, 0);
}

async function boot() {
  try {
    const [user, meta, empresa] = await Promise.all([
      api.get('/api/auth/me'),
      api.get('/api/meta'),
      api.get('/api/empresa/publico').catch(() => ({})),
    ]);
    window.SF.user = user;
    window.SF.modules = Object.fromEntries(meta.modules.map(m => [m.key, m]));
    buildShell(user, meta.modules);
    applyBranding(empresa);
    wireShell();
    route();
  } catch (err) {
    if (err.status !== 401) {
      $('#view').innerHTML = `<div class="card table-state">${icon('alert')}<div>${esc(err.message)}</div></div>`;
      toast(err.message, 'error');
    }
  }
}

boot();
