// Controles de formulario y formato de celdas según el tipo de campo definido en el backend.
import { api } from './api.js';
import { openCropDialog } from './recorte.js';
import {
  $, badge, debounce, esc, fmtDate, fmtDateTime, fmtMoney, fmtNumber, fmtRut, h, icon, todayISO,
} from './ui.js';

// ------------------------------------------------------------------ Opciones de llaves foráneas
const optionsCache = new Map();

export function invalidateOptions(moduleKey) {
  optionsCache.delete(moduleKey);
}

export async function loadAllOptions(moduleKey) {
  if (!optionsCache.has(moduleKey)) {
    optionsCache.set(moduleKey, api.get(`/api/${moduleKey}/opciones`).catch(err => {
      optionsCache.delete(moduleKey);
      throw err;
    }));
  }
  return optionsCache.get(moduleKey);
}

export async function optionLabel(moduleKey, id) {
  const rows = await api.get(`/api/${moduleKey}/opciones?id=${encodeURIComponent(id)}`);
  return rows[0]?.label ?? `#${id}`;
}

// ------------------------------------------------------------------ Celdas
export function imageUrl(name) {
  return name ? `/uploads/productos/${encodeURIComponent(name)}` : '';
}

export function thumb(name) {
  if (!name) return `<span class="thumb">${icon('image')}</span>`;
  // Si el archivo no existe, app.js reemplaza la imagen por el ícono (atributo data-fallback).
  return `<img class="thumb" data-fallback src="${imageUrl(name)}" alt="" loading="lazy">`;
}

export function formatValue(field, row) {
  const v = row[field.name];
  switch (field.type) {
    case 'money': return fmtMoney(v);
    case 'decimal': return fmtNumber(v);
    case 'int': return fmtNumber(v);
    case 'date': return fmtDate(v);
    case 'datetime': return fmtDateTime(v);
    case 'bool': return v ? '<span class="badge success">Sí</span>' : '<span class="badge">No</span>';
    case 'enum': return v ? badge(v) : '—';
    case 'rut': return esc(fmtRut(v));
    case 'image': return thumb(v);
    case 'fk': return v == null ? '<span class="cell-muted">—</span>' : esc(row[`${field.name}__label`] ?? `#${v}`);
    case 'email': return v ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : '—';
    case 'url': return /^https?:\/\//i.test(v || '') ? `<a href="${esc(v)}" target="_blank" rel="noopener noreferrer">${esc(v)}</a>` : '—';
    default: return v == null || v === '' ? '<span class="cell-muted">—</span>' : esc(v);
  }
}

export const isNumeric = field => ['money', 'decimal', 'int'].includes(field.type);

// ------------------------------------------------------------------ Combo con búsqueda remota
export function combo({ moduleKey, value = null, label = '', placeholder = 'Buscar…', id, onChange }) {
  const el = h(`
    <div class="combo">
      <input class="input" type="text" autocomplete="off" role="combobox" aria-expanded="false" ${id ? `id="${id}"` : ''}
        placeholder="${esc(placeholder)}" value="${esc(label)}">
      <button type="button" class="icon-btn sm combo-clear" aria-label="Limpiar" ${value == null ? 'hidden' : ''}>${icon('x')}</button>
      <div class="combo-list" role="listbox" hidden></div>
    </div>`);
  const input = $('input', el);
  const list = $('.combo-list', el);
  const clear = $('.combo-clear', el);
  let current = { value, label };
  let items = [];
  let active = -1;
  let seq = 0;

  const set = (val, lab, { silent = false } = {}) => {
    current = { value: val, label: lab };
    input.value = lab || '';
    clear.hidden = val == null;
    if (!silent) onChange?.(val, lab);
  };
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const render = () => {
    list.innerHTML = items.length
      ? items.map((it, i) => `<div role="option" data-i="${i}" class="${i === active ? 'active' : ''}">${esc(it.label)}</div>`).join('')
      : '<div class="combo-empty">Sin resultados</div>';
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };
  const search = debounce(async q => {
    const mine = ++seq;
    try {
      const rows = await api.get(`/api/${moduleKey}/opciones?q=${encodeURIComponent(q)}`);
      if (mine !== seq || document.activeElement !== input) return;
      items = rows;
      active = rows.length ? 0 : -1;
      render();
    } catch { /* se ignora: el usuario puede reintentar escribiendo */ }
  }, 250);

  input.addEventListener('focus', () => { input.select(); search(''); });
  input.addEventListener('input', () => search(input.value));
  input.addEventListener('keydown', e => {
    if (list.hidden && e.key === 'ArrowDown') { search(input.value); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, items.length - 1); render(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
    if (e.key === 'Enter' && !list.hidden) {
      e.preventDefault();
      if (items[active]) { set(items[active].value, items[active].label); close(); }
    }
    if (e.key === 'Escape' && !list.hidden) { e.stopPropagation(); close(); input.value = current.label || ''; }
  });
  input.addEventListener('blur', () => setTimeout(() => { close(); input.value = current.label || ''; }, 150));
  list.addEventListener('mousedown', e => {
    const opt = e.target.closest('[data-i]');
    if (!opt) return;
    e.preventDefault();
    const it = items[Number(opt.dataset.i)];
    set(it.value, it.label);
    close();
  });
  clear.addEventListener('click', () => { set(null, ''); input.focus(); });

  el.getValue = () => current.value;
  el.setValue = set;
  return el;
}

// ------------------------------------------------------------------ Registro elegido en un campo fk
// Para campos fk con `details`: carga el registro elegido y avisa al formulario con el evento
// `fk-record` (lo usan las tarjetas `info` y el `fill`). También pinta el `badge` junto a la etiqueta.
function formatDetail(item, record) {
  const v = record?.[item.key];
  if (v === null || v === undefined || v === '') return '—';
  if (item.type === 'date') return fmtDate(v);
  if (item.type === 'decimal') return fmtNumber(v);
  if (item.type === 'money') return fmtMoney(v);
  return esc(v);
}

function recordWatcher(field, wrap) {
  if (!field.details && !field.fill && !field.badge) return () => {};
  const badge = field.badge ? h('<span class="label-badge" hidden></span>') : null;
  if (badge) {
    // Texto y asterisco juntos a la izquierda; la etiqueta de dato a la derecha.
    const label = $('label', wrap);
    const text = document.createElement('span');
    text.append(...label.childNodes);
    label.append(text, badge);
  }
  let seq = 0;
  const emit = (record, userChange) => wrap.dispatchEvent(new CustomEvent('fk-record', {
    bubbles: true, detail: { name: field.name, record, userChange, fill: field.fill },
  }));
  return async (value, userChange) => {
    const mine = ++seq;
    if (value === '' || value === null || value === undefined) {
      if (badge) badge.hidden = true;
      emit(null, userChange);
      return;
    }
    try {
      const record = await api.get(`/api/${field.ref}/${encodeURIComponent(value)}`);
      if (mine !== seq) return;
      if (badge) {
        const n = Number(record[field.badge.key]);
        badge.textContent = n > 0 ? `${field.badge.label}: ${formatDetail(field.badge, record)} ${field.badge.suffix ?? ''}`.trim() : (field.badge.empty ?? '0');
        badge.classList.toggle('danger', !(n > 0));
        badge.hidden = false;
      }
      emit(record, userChange);
    } catch {
      if (mine === seq) emit(null, false);
    }
  };
}

// Campos que solo existen en el formulario (no se guardan): tarjeta de información, separador y total calculado.
function buildLayoutField(field) {
  const noop = () => {};
  let el;
  if (field.type === 'separator') {
    el = h(`<hr class="form-sep" data-field="${field.name}">`);
  } else if (field.type === 'info') {
    el = h(`<div class="form-info" data-field="${field.name}" data-source="${field.source}" hidden></div>`);
    el.renderRecord = record => {
      el.hidden = !record;
      if (!record) { el.innerHTML = ''; return; }
      el.innerHTML = field.items.map(i => `<div class="form-info-item ${i.align === 'end' ? 'end' : ''} ${i.grow ? 'grow' : ''}">
          <span>${esc(i.label)}</span><b>${formatDetail(i, record)}</b></div>`).join('');
    };
  } else if (field.type === 'calc') {
    const id = `f-${field.name}`;
    el = h(`<div class="field" data-field="${field.name}">
        <label for="${id}">${esc(field.label)}</label>
        <div class="control"><div class="input-affix"><span>$</span><input class="input" id="${id}" type="text" readonly tabindex="-1" value="0"></div></div>
      </div>`);
    el.recalc = values => {
      const total = field.multiply.reduce((acc, name) => acc * (Number(String(values[name] ?? '').replace(',', '.')) || 0), 1);
      $('input', el).value = Math.round(total).toLocaleString('es-CL');
    };
  }
  el.classList.add(field.full ? 'full' : `span-${field.span ?? 6}`);
  Object.assign(el, { getValue: () => undefined, setValue: noop, setError: noop, reset: noop });
  return el;
}

// ------------------------------------------------------------------ Controles de formulario
export function buildField(field, record, preset = {}) {
  if (field.formOnly) return buildLayoutField(field);
  const creating = !record;
  let value = record ? record[field.name] : preset[field.name];
  if (creating && (value === undefined || value === null) && field.defaultUserField) {
    value = window.SF.user?.[field.defaultUserField] ?? undefined; // p. ej. el vendedor asociado al usuario
  }
  if (creating && (value === undefined || value === null)) {
    value = field.default === 'today' ? todayISO() : field.default;
  }
  const id = `f-${field.name}`;
  const required = field.required ? '<span class="req" aria-hidden="true">*</span>' : '';
  const wrap = h(`<div class="field ${field.full ? 'full' : ''}" data-field="${field.name}">
      <label for="${id}">${esc(field.label)}${required}</label>
      <div class="control"></div>
      ${field.help ? `<div class="help">${esc(field.help)}</div>` : ''}
      <div class="error" hidden></div>
    </div>`);
  const control = $('.control', wrap);
  const ph = field.placeholder ? `placeholder="${esc(field.placeholder)}"` : '';
  const maxAttr = field.max ? `maxlength="${field.max}"` : '';
  const val = value == null ? '' : esc(value);
  let getValue;

  switch (field.type) {
    case 'textarea': {
      control.innerHTML = `<textarea class="input" id="${id}" ${maxAttr} ${ph}>${val}</textarea>`;
      getValue = () => $('textarea', control).value;
      break;
    }
    case 'money':
    case 'int': {
      control.innerHTML = `<div class="input-affix">${field.type === 'money' ? '<span>$</span>' : ''}
        <input class="input" id="${id}" type="number" inputmode="numeric" step="1" ${field.min != null ? `min="${field.min}"` : ''} value="${val}" ${ph}></div>`;
      if (field.type !== 'money') $('.input-affix', control).classList.remove('input-affix');
      getValue = () => $('input', control).value;
      break;
    }
    case 'decimal': {
      control.innerHTML = `<input class="input" id="${id}" type="number" inputmode="decimal" step="0.01" ${field.min != null ? `min="${field.min}"` : ''} value="${val}" ${ph}>`;
      getValue = () => $('input', control).value;
      break;
    }
    case 'date': {
      control.innerHTML = `<input class="input" id="${id}" type="date" value="${val}">`;
      getValue = () => $('input', control).value;
      break;
    }
    case 'email': {
      control.innerHTML = `<input class="input" id="${id}" type="email" autocomplete="off" ${maxAttr} value="${val}" ${ph}>`;
      getValue = () => $('input', control).value;
      break;
    }
    case 'url': {
      control.innerHTML = `<input class="input" id="${id}" type="url" inputmode="url" autocomplete="off" ${maxAttr} value="${val}" ${ph}>`;
      getValue = () => $('input', control).value;
      break;
    }
    case 'password': {
      control.innerHTML = `<input class="input" id="${id}" type="password" autocomplete="new-password" ${ph}>`;
      getValue = () => $('input', control).value;
      break;
    }
    case 'bool': {
      control.innerHTML = `<label class="switch"><input id="${id}" type="checkbox" ${value ? 'checked' : ''}><span>${value ? 'Sí' : 'No'}</span></label>`;
      const cb = $('input', control);
      cb.addEventListener('change', () => { $('span', control).textContent = cb.checked ? 'Sí' : 'No'; });
      getValue = () => (cb.checked ? 1 : 0);
      break;
    }
    case 'enum': {
      const opts = (field.required ? '' : '<option value="">—</option>') +
        field.options.map(o => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('');
      control.innerHTML = `<select class="input" id="${id}">${opts}</select>`;
      getValue = () => $('select', control).value;
      break;
    }
    case 'fk': {
      const ref = window.SF.modules[field.ref];
      const related = recordWatcher(field, wrap);
      if (ref?.fk_mode === 'select') {
        const select = h(`<select class="input" id="${id}"><option value="">${field.placeholder ? esc(field.placeholder) : 'Selecciona…'}</option></select>`);
        control.append(select);
        loadAllOptions(field.ref).then(rows => {
          select.insertAdjacentHTML('beforeend', rows.map(o =>
            `<option value="${o.value}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join(''));
        }).catch(() => select.insertAdjacentHTML('beforeend', '<option disabled>No se pudieron cargar las opciones</option>'));
        select.addEventListener('change', () => related(select.value, true));
        getValue = () => select.value;
        wrap.reset = () => { select.value = ''; related('', true); };
      } else {
        const label = record ? (record[`${field.name}__label`] ?? '') : '';
        const c = combo({
          moduleKey: field.ref, value: value ?? null, label, id, placeholder: field.placeholder || 'Escribe para buscar…',
          onChange: val => related(val, true),
        });
        if (value != null && !label) optionLabel(field.ref, value).then(l => c.setValue(value, l, { silent: true })).catch(() => {});
        control.append(c);
        getValue = () => c.getValue() ?? '';
        wrap.reset = () => c.setValue(null, ''); // avisa al formulario: limpia tarjetas y precios
      }
      // Registro ya elegido (al editar o al llegar filtrado): mostrar su información sin sobrescribir precios.
      if (value != null && value !== '') related(value, false);
      break;
    }
    case 'image': {
      control.innerHTML = `<div class="image-field">
          <div class="image-preview">${value ? `<img data-fallback src="${imageUrl(value)}" alt="">` : icon('image')}</div>
          <div>
            <input type="file" id="${id}" accept="image/jpeg,image/png,image/webp" hidden>
            <div class="image-buttons">
              <label for="${id}" class="btn btn-sm">${icon('image')} Elegir imagen</label>
              <button type="button" class="btn btn-sm" data-crop ${value ? '' : 'hidden'}>${icon('crop')} Recortar</button>
              ${value ? `<button type="button" class="btn btn-sm btn-ghost" data-remove>${icon('trash')} Quitar</button>` : ''}
            </div>
            <div class="help">JPG, PNG o WEBP de hasta 10 MB. Se recorta a 1:1 y se guarda como WEBP optimizado.</div>
          </div>
        </div>`;
      const fileInput = $('input[type=file]', control);
      const preview = $('.image-preview', control);
      const cropBtn = $('[data-crop]', control);
      wrap.imageAction = null;
      let pendingFile = null; // imagen nueva elegida (aún no subida)
      let pendingUrl = null;
      let lastCrop = null;
      const encuadre = result => (result.crop ? { crop: result.crop } : { modo: 'completa' });
      const showPreview = url => { preview.innerHTML = `<img src="${url}" alt="">`; };
      // Si la imagen guardada no existe en el servidor, no hay nada que recortar.
      $('img', preview)?.addEventListener('error', () => { if (!pendingFile) cropBtn.hidden = true; });

      fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        fileInput.value = ''; // permite volver a elegir el mismo archivo
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) {
          wrap.setError('El archivo supera el tamaño máximo (10 MB).');
          return;
        }
        wrap.setError('');
        const url = URL.createObjectURL(file);
        const result = await openCropDialog({ src: url });
        if (!result) { URL.revokeObjectURL(url); return; } // cancelado: se mantiene la imagen anterior
        if (pendingUrl) URL.revokeObjectURL(pendingUrl);
        pendingFile = file;
        pendingUrl = url;
        lastCrop = result.crop ?? null;
        wrap.imageAction = { type: 'upload', file, ...encuadre(result) };
        showPreview(result.previewUrl);
        cropBtn.hidden = false;
      });

      cropBtn.addEventListener('click', async () => {
        const result = await openCropDialog({ src: pendingUrl ?? imageUrl(value), initialCrop: lastCrop });
        if (!result) return;
        lastCrop = result.crop ?? null;
        wrap.imageAction = pendingFile
          ? { type: 'upload', file: pendingFile, ...encuadre(result) }
          : { type: 'recrop', ...encuadre(result) };
        showPreview(result.previewUrl);
      });

      $('[data-remove]', control)?.addEventListener('click', e => {
        wrap.imageAction = { type: 'remove' };
        pendingFile = null;
        preview.innerHTML = icon('image');
        cropBtn.hidden = true;
        e.currentTarget.remove();
      });
      getValue = () => undefined;
      // La etiqueta principal no debe abrir el selector dos veces.
      $('label', wrap).removeAttribute('for');
      break;
    }
    default: {
      control.innerHTML = `<input class="input" id="${id}" type="text" autocomplete="off" ${maxAttr} value="${field.type === 'rut' ? esc(value ? fmtRut(value) : '') : val}" ${ph}>`;
      getValue = () => $('input', control).value;
    }
  }

  wrap.getValue = getValue;
  // Deja el campo vacío para cargar el siguiente registro (formularios que siguen abiertos al guardar).
  wrap.reset ??= () => wrap.setValue('');
  wrap.setValue = v => {
    const el = control.querySelector('input:not([type=file]), textarea, select');
    if (el) el.value = v ?? '';
  };
  if (!field.full && field.span) wrap.classList.add(`span-${field.span}`);
  wrap.setError = msg => {
    const err = $('.error', wrap);
    err.hidden = !msg;
    err.textContent = msg || '';
    wrap.classList.toggle('has-error', Boolean(msg));
  };
  return wrap;
}
