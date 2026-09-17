// Catálogo en línea (Productos > Catálogo): crear enlaces con vencimiento y descargar el PDF. Solo Administrador.
import { api } from './api.js';
import { $, $$, confirmDialog, esc, fmtDate, h, icon, openModal, setBusy, toast, todayISO } from './ui.js';

const addDays = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const linkUrl = token => `${location.origin}/catalogo/${token}`;

async function copy(url) {
  try {
    await navigator.clipboard.writeText(url);
    toast('Enlace copiado. Pégalo donde quieras enviarlo.');
  } catch {
    window.prompt('Copia el enlace:', url);
  }
}
const shareWhatsApp = url => window.open(
  `https://wa.me/?text=${encodeURIComponent(`Hola, te comparto nuestro catálogo de productos: ${url}`)}`, '_blank', 'noopener');

function estado(e) {
  if (!e.activo) return '<span class="badge">Desactivado</span>';
  if (e.vencido) return '<span class="badge danger">Vencido</span>';
  return '<span class="badge success">Vigente</span>';
}

export function open() {
  const today = todayISO();
  const body = h(`<div>
    <p class="cell-muted" style="margin:0 0 16px">
      Comparte el catálogo en línea con un enlace que vence. Muestra imagen, código, descripción, marca, categoría
      y precio de venta (con IVA) de los productos disponibles, sin stock.
    </p>
    <form class="form-grid" data-create novalidate>
      <div class="field span-8">
        <label for="cat-nombre">Cliente o referencia <span class="req">*</span></label>
        <input class="input" id="cat-nombre" name="nombre" maxlength="100" placeholder="Ej.: Taller Los Aromos">
        <div class="help">Solo lo ves tú, para reconocer el enlace.</div>
      </div>
      <div class="field span-4">
        <label for="cat-expira">Vence el <span class="req">*</span></label>
        <input class="input" id="cat-expira" name="expira" type="date" min="${today}" max="${addDays(today, 730)}" value="${addDays(today, 30)}">
        <div class="help" data-quick>
          Rápido: <a href="#" data-days="7">7 días</a> · <a href="#" data-days="30">30 días</a> · <a href="#" data-days="90">90 días</a>
        </div>
      </div>
      <div class="full" style="display:flex;justify-content:flex-end">
        <button class="btn btn-primary" type="submit">${icon('link')} Crear enlace</button>
      </div>
    </form>

    <div class="card" data-created hidden style="margin-top:14px;padding:14px;border-color:var(--success)">
      <b style="display:block;margin-bottom:8px">Enlace creado</b>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="input" data-created-url readonly style="flex:1;min-width:220px">
        <button class="btn" type="button" data-created-copy>${icon('copy')} Copiar</button>
        <button class="btn" type="button" data-created-wa>${icon('send')} WhatsApp</button>
      </div>
    </div>

    <h3 style="font-size:14px;margin:22px 0 8px">Enlaces creados</h3>
    <div class="table-wrap card" data-list><div class="table-state" style="padding:16px">Cargando…</div></div>
  </div>`);

  const footer = h(`<div style="display:contents">
    <button class="btn btn-accent" type="button" data-pdf>${icon('pdf')} Descargar PDF</button>
    <span class="spacer"></span>
    <button class="btn" type="button" data-close>Cerrar</button>
  </div>`);

  const m = openModal({ title: 'Catálogo de productos', body, footer });
  const form = $('[data-create]', body);
  let enlaces = [];

  const fieldError = (name, message) => {
    const field = form[name].closest('.field');
    $('.error', field)?.remove();
    field.classList.toggle('has-error', Boolean(message));
    if (message) field.append(h(`<div class="error">${esc(message)}</div>`));
  };

  function renderList() {
    const wrap = $('[data-list]', body);
    if (!enlaces.length) {
      wrap.innerHTML = '<div class="table-state" style="padding:16px">Aún no hay enlaces de catálogo.</div>';
      return;
    }
    wrap.innerHTML = `<table class="data compact">
      <thead><tr><th>Referencia</th><th>Vence</th><th>Estado</th><th class="actions"></th></tr></thead>
      <tbody>${enlaces.map(e => `<tr data-id="${e.id}">
        <td data-label="Referencia"><b>${esc(e.nombre)}</b><br><small class="cell-muted">Creado el ${fmtDate(e.creado_en)}</small></td>
        <td data-label="Vence">${fmtDate(e.expira)}</td>
        <td data-label="Estado">${estado(e)}</td>
        <td class="actions" style="white-space:nowrap">
          <button class="icon-btn sm" data-act="copy" title="Copiar enlace" aria-label="Copiar enlace">${icon('copy')}</button>
          <button class="icon-btn sm" data-act="wa" title="Enviar por WhatsApp" aria-label="Enviar por WhatsApp">${icon('send')}</button>
          <button class="icon-btn sm" data-act="open" title="Ver catálogo" aria-label="Ver catálogo">${icon('eye')}</button>
          <button class="icon-btn sm" data-act="toggle" title="${e.activo ? 'Desactivar' : 'Activar'}" aria-label="${e.activo ? 'Desactivar' : 'Activar'}">${icon(e.activo ? 'eyeOff' : 'check')}</button>
          <button class="icon-btn sm danger" data-act="delete" title="Eliminar" aria-label="Eliminar">${icon('trash')}</button>
        </td></tr>`).join('')}</tbody></table>`;
  }

  async function load() {
    try {
      enlaces = await api.get('/api/catalogo/enlaces');
      renderList();
    } catch (err) {
      $('[data-list]', body).innerHTML = `<div class="table-state" style="padding:16px">${esc(err.message)}</div>`;
    }
  }

  $('[data-quick]', body).addEventListener('click', e => {
    const a = e.target.closest('[data-days]');
    if (!a) return;
    e.preventDefault();
    form.expira.value = addDays(today, Number(a.dataset.days));
    fieldError('expira', '');
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    fieldError('nombre', '');
    fieldError('expira', '');
    const button = $('[type=submit]', form);
    setBusy(button, true, 'Creando…');
    try {
      const enlace = await api.post('/api/catalogo/enlaces', { nombre: form.nombre.value, expira: form.expira.value });
      enlaces.unshift(enlace);
      renderList();
      const url = linkUrl(enlace.token);
      $('[data-created]', body).hidden = false;
      $('[data-created-url]', body).value = url;
      $('[data-created-copy]', body).onclick = () => copy(url);
      $('[data-created-wa]', body).onclick = () => shareWhatsApp(url);
      form.nombre.value = '';
      toast('Enlace de catálogo creado.');
    } catch (err) {
      for (const [name, message] of Object.entries(err.errors ?? {})) if (form[name]) fieldError(name, message);
      if (!Object.keys(err.errors ?? {}).length) toast(err.message, 'error');
    } finally {
      setBusy(button, false);
    }
  });

  $('[data-list]', body).addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const enlace = enlaces.find(x => x.id === Number(btn.closest('tr').dataset.id));
    const url = linkUrl(enlace.token);
    const act = btn.dataset.act;
    if (act === 'copy') return copy(url);
    if (act === 'wa') return shareWhatsApp(url);
    if (act === 'open') return window.open(url, '_blank', 'noopener');
    try {
      if (act === 'toggle') {
        Object.assign(enlace, await api.put(`/api/catalogo/enlaces/${enlace.id}`, { activo: !enlace.activo }));
        toast(enlace.activo ? 'Enlace activado.' : 'Enlace desactivado.');
      } else if (act === 'delete') {
        const ok = await confirmDialog({ title: 'Eliminar enlace', message: `El enlace "${enlace.nombre}" dejará de funcionar.` });
        if (!ok) return;
        await api.del(`/api/catalogo/enlaces/${enlace.id}`);
        enlaces = enlaces.filter(x => x !== enlace);
        toast('Enlace eliminado.');
      }
      renderList();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('[data-pdf]', m.el).addEventListener('click', async ev => {
    const button = ev.currentTarget;
    setBusy(button, true, 'Generando PDF…');
    try {
      const filename = await api.download('/api/catalogo/pdf');
      toast(`Descargado: ${filename}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(button, false);
    }
  });

  load();
  $$('input', form)[0].focus();
}
