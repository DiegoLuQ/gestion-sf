// Utilidades de interfaz: íconos, DOM, formatos, toasts, modales y tema.

const ICONS = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  filterLogo: '<path d="M4 4h16l-6 8v6l-4 2v-8z"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  truck: '<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 11h6M9 15h4"/>',
  outbox: '<path d="M4 13h4l1 3h6l1-3h4"/><path d="M4 13 6 5h12l2 8v6H4z"/><path d="M12 11V2M9 5l3-3 3 3"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  badge: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16a3 3 0 0 1 6 0M15 10h3M15 13h3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  pdf: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15l3 3 3-3"/>',
  building: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M16 9h2a2 2 0 0 1 2 2v10M2 21h20"/><path d="M8 7h4M8 11h4M8 15h4"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7M8 11h5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  send: '<path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4z"/>',
  inbox: '<path d="M3 13h5l1 3h6l1-3h5"/><path d="M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/>',
};

export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.box}</svg>`;
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function h(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ------------------------------------------------------------------ Formatos
const moneyFmt = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 });
export const fmtMoney = v => (v === null || v === undefined || v === '' ? '—' : moneyFmt.format(v));
export const fmtNumber = v => (v === null || v === undefined || v === '' ? '—' : numFmt.format(v));

export function fmtDate(v) {
  if (!v) return '—';
  const [y, m, d] = String(v).slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

export function fmtDateTime(v) {
  if (!v) return '—';
  return `${fmtDate(v)} ${String(v).slice(11, 16)}`;
}

export function fmtRut(v) {
  if (!v) return '—';
  const [body, dv] = String(v).split('-');
  const digits = (body || '').replace(/\D/g, '');
  if (!dv || !digits) return v;
  return `${Number(digits).toLocaleString('es-CL')}-${dv}`;
}

export function fmtCompactMoney(v) {
  const abs = Math.abs(v);
  if (abs >= 1e6) return `$${(v / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 })} M`;
  if (abs >= 1e3) return `$${(v / 1e3).toLocaleString('es-CL', { maximumFractionDigits: 0 })} mil`;
  return `$${v}`;
}

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const BADGES = {
  Disponible: 'success', Descontinuado: '', Eliminado: 'danger',
  PENDIENTE: 'warning', PAGADO: 'success', CHEQUE: 'info', ANULADO: 'danger',
  FACTURA: 'info', BOLETA: 'info', 'NOTA DE VENTA': '', 'SIN DOCUMENTO': 'warning',
  Administrador: 'info', Vendedor: 'success', Consulta: '', Empresa: 'info', Persona: '',
};
export function badge(text) {
  return `<span class="badge ${BADGES[text] ?? ''}">${esc(text)}</span>`;
}

// ------------------------------------------------------------------ Toasts
export function toast(message, type = 'success') {
  const box = $('#toasts');
  const el = h(`<div class="toast ${type}" role="status">${icon(type === 'error' ? 'alert' : 'check')}<div>${esc(message)}</div></div>`);
  box.append(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
}

// ------------------------------------------------------------------ Modales
export function openModal({ title, body, footer = '', size = '' }) {
  const backdrop = h(`
    <div class="modal-backdrop">
      <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head"><h2>${esc(title)}</h2>
          <button class="icon-btn sm" data-close aria-label="Cerrar">${icon('x')}</button></div>
        <div class="modal-body"></div>
        <div class="modal-foot"></div>
      </div>
    </div>`);
  const modal = $('.modal', backdrop);
  const bodyEl = $('.modal-body', backdrop);
  const footEl = $('.modal-foot', backdrop);
  typeof body === 'string' ? (bodyEl.innerHTML = body) : bodyEl.append(body);
  typeof footer === 'string' ? (footEl.innerHTML = footer) : footEl.append(footer);
  if (!footer) footEl.remove();
  const previousFocus = document.activeElement;

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = $$('.modal-backdrop').length ? 'hidden' : '';
    previousFocus?.focus?.();
  };
  const onKey = e => {
    if (e.key === 'Escape' && backdrop === $$('.modal-backdrop').at(-1)) close();
  };
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  backdrop.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  document.body.style.overflow = 'hidden';
  setTimeout(() => ($('input:not([type=hidden]):not([disabled]), select, textarea', modal) || $('[data-close]', modal))?.focus(), 30);
  return { el: modal, body: bodyEl, foot: footEl, close };
}

export function confirmDialog({ title, message, confirmText = 'Eliminar', danger = true }) {
  return new Promise(resolve => {
    let done = false;
    const m = openModal({
      title, size: 'sm',
      body: `<div class="confirm-body"><div class="confirm-icon">${icon('alert')}</div><div><b>${esc(title)}</b><p>${esc(message)}</p></div></div>`,
      footer: `<button class="btn" data-close>Cancelar</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmText)}</button>`,
    });
    const finish = value => { if (!done) { done = true; resolve(value); } };
    $('[data-ok]', m.el).addEventListener('click', () => { finish(true); m.close(); });
    new MutationObserver((_, obs) => { if (!m.el.isConnected) { finish(false); obs.disconnect(); } })
      .observe(document.body, { childList: true });
    setTimeout(() => $('[data-ok]', m.el).focus(), 40);
  });
}

// ------------------------------------------------------------------ Tema
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('sf-theme', theme); } catch { /* sin almacenamiento */ }
}
export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function setBusy(button, busy, label) {
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${label ? esc(label) : ''}`;
  } else if (button.dataset.label) {
    button.disabled = false;
    button.innerHTML = button.dataset.label;
  }
}
