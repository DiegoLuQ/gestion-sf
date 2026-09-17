// Vista CRUD genérica: se arma a partir de la definición del módulo que entrega /api/meta.
import { api } from './api.js';
import {
  buildField, combo, formatValue, imageUrl, invalidateOptions, isNumeric, loadAllOptions, optionLabel,
} from './fields.js';
import {
  $, $$, confirmDialog, debounce, esc, fmtMoney, fmtNumber, h, icon, openModal, setBusy, toast,
} from './ui.js';

const newLabel = mod => `${mod.gender === 'f' ? 'Nueva' : 'Nuevo'} ${mod.singular}`;
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
const formatBytes = n => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toLocaleString('es-CL', { maximumFractionDigits: 1 })} MB`
  : `${Math.max(1, Math.round(n / 1024)).toLocaleString('es-CL')} KB`);

function formatExtra(extra, row) {
  const v = row[extra.name];
  if (v === null || v === undefined) return '<span class="cell-muted">—</span>';
  if (extra.type === 'money') return fmtMoney(v);
  if (extra.name.endsWith('_pct')) return `${fmtNumber(v)} %`;
  if (extra.type === 'int' || extra.type === 'decimal') return fmtNumber(v);
  return esc(v);
}

function cellHtml(col, row) {
  if (col.kind === 'extra') return formatExtra(col, row);
  let html = formatValue(col, row);
  if (col.name === 'prod_cantidad' && row.prod_estado === 'Disponible' && Number(row.prod_cantidad) <= Number(row.prod_stock_minimo)) {
    html = `<span class="badge danger plain">Bajo</span> ${html}`;
  }
  return html;
}

// Registro único (p. ej. configuración de la empresa): formulario directo con vista previa.
async function renderSingleton(root, mod) {
  root.innerHTML = `<div class="page"><div class="page-head"><div><h1>${icon(mod.icon)} ${esc(mod.title)}</h1><p>Cargando…</p></div></div></div>`;
  let record;
  try {
    record = (await api.get(`/api/${mod.key}?size=10`)).rows[0];
    if (!record) throw new Error('No existe el registro de configuración.');
  } catch (err) {
    root.innerHTML = `<div class="page"><div class="card table-state">${icon('alert')}<div>${esc(err.message)}</div></div></div>`;
    return;
  }

  root.innerHTML = `
    <div class="page settings-page">
      <div class="page-head">
        <div>
          <h1>${icon(mod.icon)} ${esc(mod.title)}</h1>
          <p>Estos datos identifican a la empresa en el menú, en el inicio de sesión y en los documentos.</p>
        </div>
      </div>
      <div class="settings-grid">
        <form class="card" id="form-${mod.key}" novalidate>
          <div class="card-head"><div><h2>Datos de la empresa</h2><p>Los campos con * son obligatorios.</p></div></div>
          <div class="card-body"><div class="form-grid"></div></div>
          ${mod.can_write ? `<div class="modal-foot">
            <button type="button" class="btn" data-reset>Descartar cambios</button>
            <button type="submit" class="btn btn-primary" data-save>${icon('check')} Guardar cambios</button>
          </div>` : ''}
        </form>
        <aside class="card brand-preview" aria-label="Vista previa">
          <div class="card-head"><div><h2>Vista previa</h2><p>Así se verá en el menú superior.</p></div></div>
          <div class="card-body">
            <div class="preview-bar">
              <span class="brand-mark" data-prev-logo></span>
              <span class="preview-text"><b data-prev-name></b><small data-prev-slogan></small></span>
            </div>
            <dl class="details single">
              <div><dt>RUT</dt><dd data-prev-rut></dd></div>
              <div><dt>Correo</dt><dd data-prev-mail></dd></div>
            </dl>
          </div>
        </aside>
      </div>
    </div>`;

  const form = $('form', root);
  const grid = $('.form-grid', form);
  const saveBtn = $('[data-save]', root);
  let controls = [];

  const valueOf = name => controls.find(c => c.dataset.field === name)?.getValue() ?? '';
  const preview = () => {
    $('[data-prev-name]', root).textContent = valueOf('emp_nombre') || 'Nombre de la empresa';
    $('[data-prev-slogan]', root).textContent = valueOf('emp_slogan') || 'Sistema de gestión';
    $('[data-prev-rut]', root).textContent = valueOf('emp_rut') || '—';
    $('[data-prev-mail]', root).textContent = valueOf('emp_correo') || '—';
    const logo = $('[data-prev-logo]', root);
    const url = valueOf('emp_url_img');
    if (/^https?:\/\//i.test(url)) {
      logo.classList.add('has-logo');
      logo.innerHTML = `<img data-fallback src="${esc(url)}" alt="Logo">`;
    } else {
      logo.classList.remove('has-logo');
      logo.innerHTML = icon('filterLogo');
    }
  };

  const fill = rec => {
    controls = mod.fields.filter(f => !f.readonly).map(f => buildField(f, rec));
    grid.replaceChildren(...controls);
    if (!mod.can_write) grid.querySelectorAll('input, textarea, select').forEach(el => { el.disabled = true; });
    preview();
  };
  fill(record);
  form.addEventListener('input', debounce(preview, 250));
  $('[data-reset]', root)?.addEventListener('click', () => fill(record));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!mod.can_write) return;
    controls.forEach(c => c.setError(''));
    const payload = Object.fromEntries(controls.map(c => [c.dataset.field, c.getValue()]));
    setBusy(saveBtn, true, 'Guardando…');
    try {
      record = await api.put(`/api/${mod.key}/${record[mod.pk]}`, payload);
      fill(record);
      window.SF.applyBranding?.({ nombre: record.emp_nombre, slogan: record.emp_slogan, url_img: record.emp_url_img });
      toast('Configuración guardada.');
    } catch (err) {
      const names = Object.keys(err.errors || {});
      names.forEach(n => controls.find(c => c.dataset.field === n)?.setError(err.errors[n]));
      if (names.length) $('.has-error input, .has-error textarea', form)?.focus();
      toast(err.message, 'error');
    } finally {
      setBusy(saveBtn, false);
    }
  });
}

export function renderModule(root, mod, params, ctx) {
  if (mod.singleton) return renderSingleton(root, mod);
  return renderList(root, mod, params, ctx);
}

function renderList(root, mod, params, { navigate }) {
  const state = {
    page: Math.max(Number(params.get('page')) || 1, 1),
    size: Number(params.get('size')) || 25,
    q: params.get('q') || '',
    sort: params.get('sort') || mod.order[0],
    dir: params.get('dir') || mod.order[1],
    desde: params.get('desde') || '',
    hasta: params.get('hasta') || '',
    filters: {},
  };
  for (const [k, v] of params) if (k.startsWith('f_') && v) state.filters[k.slice(2)] = v;

  const fieldsByName = Object.fromEntries(mod.fields.map(f => [f.name, f]));
  const columns = [
    ...mod.fields.filter(f => f.list).map(f => ({ ...f, kind: 'field' })),
    ...mod.extras.map(e => ({ ...e, kind: 'extra' })),
  ];
  const primaryName = columns.find(c => c.type !== 'image')?.name;
  const filterFields = mod.fields.filter(f => f.filter);
  let seq = 0;
  let lastRows = [];

  // Acciones extra del módulo: navegar a otro módulo filtrado, descargar un archivo (p. ej. la nota de venta),
  // copiar o compartir un enlace público, o escribir por WhatsApp.
  const actionVisible = (a, row) => !a.showIf
    || (a.showIf.notEmpty ? Boolean(String(row?.[a.showIf.field] ?? '').trim()) : row?.[a.showIf.field] === a.showIf.equals);
  const fillUrl = (template, row) => template.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(row[key] ?? ''));
  async function runAction(a, row, btn) {
    // Enlace público (p. ej. /cotizar/<código>): se copia o se comparte con la dirección completa del sitio.
    if (a.copy) {
      const url = location.origin + fillUrl(a.copy, row);
      try {
        await navigator.clipboard.writeText(url);
        toast('Enlace copiado. Pégalo donde quieras enviarlo.');
      } catch {
        window.prompt('Copia el enlace:', url);
      }
      return;
    }
    if (a.share) {
      const url = location.origin + fillUrl(a.share, row);
      const text = `Hola, te comparto el enlace para armar tu cotización: ${url}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      return;
    }
    if (a.whatsapp) {
      let phone = String(row[a.whatsapp] ?? '').replace(/\D/g, '');
      if (phone.length === 9 && phone.startsWith('9')) phone = `56${phone}`;
      if (phone.length < 8) { toast('El número no es válido para WhatsApp.', 'error'); return; }
      window.open(`https://wa.me/${phone}`, '_blank', 'noopener');
      return;
    }
    if (!a.download) {
      navigate(`#/${a.module}?f_${a.filter}=${row[mod.pk]}`);
      return;
    }
    const url = fillUrl(a.download, row);
    setBusy(btn, true, btn.classList.contains('icon-btn') ? '' : 'Generando…');
    try {
      const filename = await api.download(url);
      toast(`Descargado: ${filename}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(btn, false);
    }
  }

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>${icon(mod.icon)} ${esc(mod.title)}</h1>
          <p data-count>Cargando…</p>
        </div>
        <div class="page-actions">
          ${(mod.page_actions ?? []).map((a, i) => `<button class="btn" data-tool="${i}">${icon(a.icon)} <span>${esc(a.label)}</span></button>`).join('')}
          <button class="btn" data-export>${icon('download')} <span>Exportar CSV</span></button>
          ${mod.can_create ? `<button class="btn btn-primary" data-new>${icon('plus')} ${esc(newLabel(mod))}</button>` : ''}
        </div>
      </div>
      <div class="card">
        <div class="toolbar">
          <div class="search">${icon('search')}
            <input class="input" type="search" placeholder="Buscar en ${esc(mod.title.toLowerCase())}…" value="${esc(state.q)}" aria-label="Buscar">
          </div>
          <div data-filters style="display:contents"></div>
          ${mod.date_field ? `
            <div class="date-range">
              <input class="input" type="date" data-desde value="${esc(state.desde)}" aria-label="Desde">
              <span class="cell-muted">a</span>
              <input class="input" type="date" data-hasta value="${esc(state.hasta)}" aria-label="Hasta">
            </div>` : ''}
          <button class="btn btn-ghost" data-clear hidden>${icon('x')} Limpiar</button>
        </div>
        <div class="chips"></div>
        <div class="table-wrap">
          <div class="loading-bar" hidden></div>
          <table class="data"><thead></thead><tbody></tbody></table>
        </div>
        <div class="pager"></div>
      </div>
    </div>`;

  const tbody = $('tbody', root);
  const thead = $('thead', root);
  const pager = $('.pager', root);
  const loadingBar = $('.loading-bar', root);
  const countEl = $('[data-count]', root);

  // ---------------------------------------------------------------- Estado <-> URL
  function queryString({ forExport = false } = {}) {
    const p = new URLSearchParams();
    if (!forExport) {
      if (state.page > 1) p.set('page', state.page);
      if (state.size !== 25) p.set('size', state.size);
    }
    if (state.q) p.set('q', state.q);
    if (state.sort !== mod.order[0] || state.dir !== mod.order[1]) { p.set('sort', state.sort); p.set('dir', state.dir); }
    if (state.desde) p.set('desde', state.desde);
    if (state.hasta) p.set('hasta', state.hasta);
    for (const [k, v] of Object.entries(state.filters)) if (v !== '' && v != null) p.set(`f_${k}`, v);
    return p.toString();
  }

  function syncUrl() {
    const qs = queryString();
    history.replaceState(null, '', `#/${mod.key}${qs ? `?${qs}` : ''}`);
    const active = state.q || state.desde || state.hasta || Object.keys(state.filters).length;
    $('[data-clear]', root).hidden = !active;
  }

  function update(changes, { resetPage = true } = {}) {
    Object.assign(state, changes);
    if (resetPage) state.page = 1;
    syncUrl();
    load();
  }

  function setFilter(name, value) {
    const filters = { ...state.filters };
    if (value === '' || value == null) delete filters[name]; else filters[name] = value;
    update({ filters });
    renderChips();
  }

  // ---------------------------------------------------------------- Filtros
  function renderFilters() {
    const box = $('[data-filters]', root);
    for (const f of filterFields) {
      const current = state.filters[f.name] ?? '';
      if (f.type === 'enum' || f.type === 'bool') {
        const opts = f.type === 'bool' ? [['1', 'Sí'], ['0', 'No']] : f.options.map(o => [o, o]);
        const sel = h(`<select class="input" aria-label="${esc(f.label)}">
          <option value="">${esc(f.label)}: todos</option>
          ${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(current) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        </select>`);
        sel.addEventListener('change', () => setFilter(f.name, sel.value));
        box.append(sel);
      } else if (f.type === 'fk' && window.SF.modules[f.ref]?.fk_mode === 'select') {
        const sel = h(`<select class="input" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}: todos</option></select>`);
        loadAllOptions(f.ref).then(rows => {
          sel.insertAdjacentHTML('beforeend', rows.map(o =>
            `<option value="${o.value}" ${String(o.value) === String(current) ? 'selected' : ''}>${esc(o.label)}</option>`).join(''));
        }).catch(() => {});
        sel.addEventListener('change', () => setFilter(f.name, sel.value));
        box.append(sel);
      } else if (f.type === 'fk' && window.SF.modules[f.ref]) {
        const c = combo({
          moduleKey: f.ref, value: current || null, placeholder: `${f.label}: todos`,
          onChange: value => setFilter(f.name, value ?? ''),
        });
        c.style.flex = '1 1 220px';
        c.style.maxWidth = '300px';
        if (current) optionLabel(f.ref, current).then(label => { $('input', c).value = label; }).catch(() => {});
        box.append(c);
      }
    }
  }

  // Filtros activos que no tienen control visible (por ejemplo, al llegar desde "Ver detalle").
  function renderChips() {
    const chips = $('.chips', root);
    chips.innerHTML = '';
    for (const [name, value] of Object.entries(state.filters)) {
      const f = fieldsByName[name];
      if (!f || f.filter) continue;
      const chip = h(`<span class="chip">${esc(f.label)}: <span data-label>#${esc(value)}</span>
        <button aria-label="Quitar filtro">${icon('x')}</button></span>`);
      if (f.type === 'fk') optionLabel(f.ref, value).then(l => { $('[data-label]', chip).textContent = l; }).catch(() => {});
      $('button', chip).addEventListener('click', () => setFilter(name, ''));
      chips.append(chip);
    }
  }

  // ---------------------------------------------------------------- Tabla
  function renderHead() {
    thead.innerHTML = `<tr>${columns.map(c => {
      const sorted = state.sort === c.name;
      const arrow = sorted ? (state.dir === 'asc' ? '▲' : '▼') : '';
      const sortable = c.type !== 'image';
      return `<th class="${sortable ? 'sortable' : ''} ${isNumeric(c) || c.type === 'money' ? 'num' : ''} ${c.hideMd ? 'hide-md' : ''}" data-sort="${sortable ? c.name : ''}"
        ${sorted ? `aria-sort="${state.dir === 'asc' ? 'ascending' : 'descending'}"` : ''}>${esc(c.label)}<span class="sort-ind">${arrow}</span></th>`;
    }).join('')}<th><span class="sr-only">Acciones</span></th></tr>`;
  }

  function rowActions(row) {
    const id = row[mod.pk];
    return `
      <button class="icon-btn sm" data-act="view" data-id="${id}" title="Ver">${icon('eye')}</button>
      ${mod.actions.map((a, i) => (actionVisible(a, row)
        ? `<button class="icon-btn sm" data-act="custom" data-i="${i}" data-id="${id}" title="${esc(a.label)}" aria-label="${esc(a.label)}">${icon(a.icon)}</button>`
        : '')).join('')}
      ${mod.can_write ? `
        <button class="icon-btn sm" data-act="edit" data-id="${id}" title="Editar">${icon('edit')}</button>
        <button class="icon-btn sm danger" data-act="delete" data-id="${id}" title="Eliminar">${icon('trash')}</button>` : ''}`;
  }

  function renderRows(rows) {
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${columns.length + 1}" class="table-state">${icon('search')}<div>No hay registros que coincidan.</div></td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(row => `<tr class="link-row" data-id="${row[mod.pk]}">
      ${columns.map(c => `<td data-label="${esc(c.label)}" class="${isNumeric(c) || c.type === 'money' ? 'num' : ''} ${c.hideMd ? 'hide-md' : ''}${c.name === primaryName ? 'primary-cell' : ''} ${c.type === 'date' || c.type === 'datetime' ? 'nowrap' : ''} ${c.type === 'text' || c.type === 'fk' || c.type === 'textarea' ? 'clip' : ''}">${cellHtml(c, row)}</td>`).join('')}
      <td class="actions">${rowActions(row)}</td>
    </tr>`).join('');
  }

  function renderPager(total) {
    const pages = Math.max(Math.ceil(total / state.size), 1);
    const from = total ? (state.page - 1) * state.size + 1 : 0;
    const to = Math.min(state.page * state.size, total);
    const nums = new Set([1, pages, state.page - 1, state.page, state.page + 1].filter(n => n >= 1 && n <= pages));
    const sorted = [...nums].sort((a, b) => a - b);
    let buttons = '';
    sorted.forEach((n, i) => {
      if (i && n - sorted[i - 1] > 1) buttons += '<span class="cell-muted">…</span>';
      buttons += `<button class="page-btn ${n === state.page ? 'current' : ''}" data-page="${n}" ${n === state.page ? 'aria-current="page"' : ''}>${n.toLocaleString('es-CL')}</button>`;
    });
    pager.innerHTML = `
      <div>Mostrando <b>${from.toLocaleString('es-CL')}–${to.toLocaleString('es-CL')}</b> de <b>${total.toLocaleString('es-CL')}</b></div>
      <div class="pager-controls">
        <button class="page-btn" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''} aria-label="Anterior">${icon('chevronLeft')}</button>
        ${buttons}
        <button class="page-btn" data-page="${state.page + 1}" ${state.page >= pages ? 'disabled' : ''} aria-label="Siguiente">${icon('chevronRight')}</button>
        <select class="input" aria-label="Filas por página">
          ${[10, 25, 50, 100].map(n => `<option value="${n}" ${n === state.size ? 'selected' : ''}>${n} / pág.</option>`).join('')}
        </select>
      </div>`;
    $('select', pager).addEventListener('change', e => update({ size: Number(e.target.value) }));
  }

  async function load() {
    const mine = ++seq;
    loadingBar.hidden = false;
    renderHead();
    try {
      const data = await api.get(`/api/${mod.key}?${queryString()}`);
      if (mine !== seq) return;
      const pages = Math.max(Math.ceil(data.total / state.size), 1);
      if (state.page > pages) { state.page = pages; syncUrl(); return load(); }
      lastRows = data.rows;
      renderRows(data.rows);
      renderPager(data.total);
      countEl.textContent = `${data.total.toLocaleString('es-CL')} ${data.total === 1 ? 'registro' : 'registros'}`;
    } catch (err) {
      if (mine !== seq) return;
      tbody.innerHTML = `<tr><td colspan="${columns.length + 1}" class="table-state">${icon('alert')}<div>${esc(err.message)}</div>
        <button class="btn btn-sm" data-retry style="margin-top:10px">${icon('refresh')} Reintentar</button></td></tr>`;
      countEl.textContent = 'Error al cargar';
    } finally {
      if (mine === seq) loadingBar.hidden = true;
    }
  }

  // ---------------------------------------------------------------- Detalle
  async function openView(id) {
    let row;
    try {
      row = await api.get(`/api/${mod.key}/${id}`);
    } catch (err) { return toast(err.message, 'error'); }

    const image = mod.fields.find(f => f.type === 'image');
    const items = [
      ...mod.fields.filter(f => f.type !== 'password' && f.type !== 'image' && !f.formOnly)
        .map(f => `<div class="${f.full ? 'full' : ''}"><dt>${esc(f.label)}</dt><dd>${formatValue(f, row)}</dd></div>`),
      ...mod.extras.map(e => `<div><dt>${esc(e.label)}</dt><dd>${formatExtra(e, row)}</dd></div>`),
    ].join('');
    const body = h(`<div>
      ${image && row[image.name] ? `<img class="details-image" data-fallback src="${imageUrl(row[image.name])}" alt="" style="margin-bottom:12px">` : ''}
      <dl class="details">${items}</dl>
      <div data-related></div>
    </div>`);
    const footer = h(`<div style="display:contents">
      ${mod.actions.map((a, i) => (actionVisible(a, row)
        ? `<button class="btn ${a.download ? 'btn-accent' : ''}" data-go="${i}">${icon(a.icon)} ${esc(a.label)}</button>`
        : '')).join('')}
      <span class="spacer"></span>
      <button class="btn" data-close>Cerrar</button>
      ${mod.can_write ? `<button class="btn btn-primary" data-edit>${icon('edit')} Editar</button>` : ''}
    </div>`);
    const title = `${capitalize(mod.singular)} ${row[primaryName] && typeof row[primaryName] !== 'object' && !fieldsByName[primaryName]?.ref ? `· ${row[primaryName]}` : `#${id}`}`;
    const m = openModal({ title, body, footer });
    $$('[data-go]', m.el).forEach(btn => btn.addEventListener('click', () => {
      const a = mod.actions[Number(btn.dataset.go)];
      if (a.module) m.close();
      runAction(a, row, btn);
    }));
    $('[data-edit]', m.el)?.addEventListener('click', () => { m.close(); openForm(row); });

    // Registros relacionados (p. ej. el detalle de un pedido)
    for (const a of mod.actions) {
      const rel = a.module && window.SF.modules[a.module];
      if (!rel) continue;
      const relCols = rel.fields.filter(f => f.list && f.name !== a.filter && f.type !== 'image');
      const section = h(`<div style="margin-top:20px"><h3 style="font-size:14px;margin:0 0 8px">${esc(rel.title)}</h3>
        <div class="table-wrap card"><div class="table-state" style="padding:16px">Cargando…</div></div></div>`);
      $('[data-related]', body).append(section);
      api.get(`/api/${a.module}?f_${a.filter}=${id}&size=100`).then(data => {
        const wrap = $('.table-wrap', section);
        if (!data.rows.length) { wrap.innerHTML = '<div class="table-state" style="padding:16px">Sin registros.</div>'; return; }
        const totalField = relCols.find(f => f.name.endsWith('_total') || f.name === 'docu_venta');
        const sum = totalField ? data.rows.reduce((acc, r) => acc + Number(r[totalField.name] || 0), 0) : null;
        wrap.innerHTML = `<table class="data compact"><thead><tr>${relCols.map(f => `<th class="${isNumeric(f) ? 'num' : ''}">${esc(f.label)}</th>`).join('')}</tr></thead>
          <tbody>${data.rows.map(r => `<tr>${relCols.map(f => `<td data-label="${esc(f.label)}" class="${isNumeric(f) ? 'num' : ''}">${formatValue(f, r)}</td>`).join('')}</tr>`).join('')}
          ${sum !== null && data.rows.length > 1 ? `<tr><td colspan="${relCols.length - 1}" data-label="" style="text-align:right"><b>Total</b></td><td class="num" data-label="Total"><b>${fmtMoney(sum)}</b></td></tr>` : ''}
          </tbody></table>`;
      }).catch(err => { $('.table-wrap', section).innerHTML = `<div class="table-state" style="padding:16px">${esc(err.message)}</div>`; });
    }
  }

  // ---------------------------------------------------------------- Formulario
  async function openForm(record = null) {
    if (record) {
      try { record = await api.get(`/api/${mod.key}/${record[mod.pk]}`); } catch (err) { return toast(err.message, 'error'); }
    }
    const formId = `form-${mod.key}`;
    const form = h(`<form class="form-grid" id="${formId}" novalidate></form>`);
    const visible = mod.fields.filter(f => (!f.readonly || f.formOnly) && !(!record && f.hideOnCreate));
    const controls = visible.map(f => buildField(f, record, state.filters));
    form.append(...controls);

    let saveBtn = null;
    const chosenRecords = {}; // registros elegidos en los campos fk (p. ej. el producto con su stock)

    // Totales calculados en el formulario (p. ej. cantidad × venta unitaria).
    const calcs = controls.filter(c => c.recalc);
    const recalc = () => {
      if (!calcs.length) return;
      const values = Object.fromEntries(controls.map(c => [c.dataset.field, c.getValue()]));
      calcs.forEach(c => c.recalc(values));
    };

    // Límite de stock en vivo: la cantidad no puede superar lo disponible del producto elegido.
    // Al editar una línea del mismo producto, su cantidad original vuelve al stock antes de descontar.
    const limited = visible.filter(f => f.stockLimit);
    let overLimit = false;
    const checkLimits = () => {
      overLimit = false;
      for (const f of limited) {
        const control = controls.find(c => c.dataset.field === f.name);
        const chosen = chosenRecords[f.stockLimit.source];
        const raw = String(control.getValue() ?? '').replace(',', '.');
        if (!chosen || raw === '') { control.setError(''); continue; }
        let available = Number(chosen[f.stockLimit.key]) || 0;
        if (record && String(record[f.stockLimit.source]) === String(chosen[window.SF.modules[visible.find(x => x.name === f.stockLimit.source).ref].pk])) {
          available += Number(record[f.name]) || 0;
        }
        if (Number(raw) > available) {
          overLimit = true;
          control.setError(available > 0
            ? `Stock insuficiente: solo hay ${fmtNumber(available)} disponible${available === 1 ? '' : 's'}.`
            : 'Stock insuficiente: este producto no tiene unidades disponibles.');
        } else {
          control.setError('');
        }
      }
      if (saveBtn && !saveBtn.querySelector('.spinner')) {
        saveBtn.disabled = overLimit;
        saveBtn.title = overLimit ? 'La cantidad supera el stock disponible' : '';
      }
    };

    form.addEventListener('input', () => { recalc(); checkLimits(); });
    recalc();

    // Registro elegido en un campo fk: actualizar sus tarjetas de información y, si lo cambió
    // el usuario, copiar sus valores a otros campos (p. ej. precios del producto).
    form.addEventListener('fk-record', e => {
      const { name, record: chosen, userChange, fill } = e.detail;
      chosenRecords[name] = chosen;
      controls.filter(c => c.dataset.source === name).forEach(c => c.renderRecord(chosen));
      if (userChange && chosen && fill) {
        for (const [target, key] of Object.entries(fill)) controls.find(c => c.dataset.field === target)?.setValue(chosen[key]);
      }
      recalc();
      checkLimits();
    });

    // Valores propuestos por el servidor al crear (p. ej. el siguiente número de pedido), editables.
    if (!record) {
      for (const f of visible.filter(x => x.defaultFrom && state.filters[x.name] == null)) {
        const input = controls.find(c => c.dataset.field === f.name)?.querySelector('input');
        if (!input) continue;
        input.placeholder = 'Calculando…';
        api.get(f.defaultFrom)
          .then(({ valor }) => { if (!input.value) input.value = valor ?? ''; })
          .catch(() => {})
          .finally(() => { input.placeholder = ''; });
      }
    }
    const m = openModal({
      title: record ? `Editar ${mod.singular}` : newLabel(mod),
      body: form,
      footer: `<button type="button" class="btn" data-close>Cancelar</button>
               <button type="submit" class="btn btn-primary" form="${formId}" data-save>${icon('check')} Guardar</button>`,
    });
    saveBtn = $('[data-save]', m.el);
    checkLimits();

    form.addEventListener('submit', async e => {
      e.preventDefault();
      checkLimits();
      if (overLimit) return; // Enter con la cantidad sobre el stock: no se envía
      controls.forEach(c => c.setError(''));
      const payload = {};
      for (const c of controls) {
        const value = c.getValue();
        if (value !== undefined) payload[c.dataset.field] = value;
      }
      setBusy(saveBtn, true, 'Guardando…');
      let saved;
      try {
        saved = record
          ? await api.put(`/api/${mod.key}/${record[mod.pk]}`, payload)
          : await api.post(`/api/${mod.key}`, payload);
      } catch (err) {
        setBusy(saveBtn, false);
        const names = Object.keys(err.errors || {});
        names.forEach(n => controls.find(c => c.dataset.field === n)?.setError(err.errors[n]));
        if (names.length) $('.has-error input, .has-error select, .has-error textarea', form)?.focus();
        return toast(err.message, 'error');
      }

      const imageControl = controls.find(c => c.imageAction);
      let imageNote = '';
      if (imageControl) {
        const id = saved[mod.pk];
        try {
          const action = imageControl.imageAction;
          if (action.type === 'upload') {
            const fd = new FormData();
            if (action.crop) fd.append('recorte', JSON.stringify(action.crop));
            if (action.modo) fd.append('modo', action.modo);
            fd.append('imagen', action.file);
            const r = await api.upload(`/api/${mod.key}/${id}/imagen`, fd);
            imageNote = ` Imagen ${r.ancho}×${r.alto} optimizada a WEBP: ${formatBytes(r.bytes_original)} → ${formatBytes(r.bytes_final)}.`;
          } else if (action.type === 'recrop') {
            const r = await api.post(`/api/${mod.key}/${id}/imagen/recorte`, action.crop ? { recorte: action.crop } : { modo: action.modo });
            imageNote = ` Imagen recortada (${r.ancho}×${r.alto}).`;
          } else {
            await api.del(`/api/${mod.key}/${id}/imagen`);
          }
        } catch (err) {
          toast(`Se guardó el ${mod.singular}, pero la imagen falló: ${err.message}`, 'error');
        }
      }
      invalidateOptions(mod.key);
      m.close();
      toast(`${record ? 'Cambios guardados.' : `${capitalize(mod.singular)} ${mod.gender === 'f' ? 'creada' : 'creado'}.`}${imageNote}`);
      load();
    });
  }

  async function remove(id) {
    const row = lastRows.find(r => String(r[mod.pk]) === String(id));
    const name = row && primaryName ? String(row[`${primaryName}__label`] ?? row[primaryName] ?? '') : '';
    const ok = await confirmDialog({
      title: `¿Eliminar ${mod.singular}?`,
      message: `${name ? `«${name}» ` : ''}se eliminará de forma permanente.${mod.key === 'pedidos' ? ' Sus líneas de salida también se eliminarán y el stock se devolverá.' : ''}`,
    });
    if (!ok) return;
    try {
      await api.del(`/api/${mod.key}/${id}`);
      invalidateOptions(mod.key);
      toast(`${capitalize(mod.singular)} ${mod.gender === 'f' ? 'eliminada' : 'eliminado'}.`);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---------------------------------------------------------------- Eventos
  const searchInput = $('.search input', root);
  searchInput.addEventListener('input', debounce(() => update({ q: searchInput.value.trim() }), 350));
  $('[data-desde]', root)?.addEventListener('change', e => update({ desde: e.target.value }));
  $('[data-hasta]', root)?.addEventListener('change', e => update({ hasta: e.target.value }));
  $('[data-clear]', root).addEventListener('click', () => navigate(`#/${mod.key}`, { force: true }));
  $('[data-new]', root)?.addEventListener('click', () => openForm());
  // Herramientas propias del módulo (p. ej. el catálogo en Productos): se cargan solo al usarlas.
  $$('[data-tool]', root).forEach(btn => btn.addEventListener('click', async () => {
    const { tool } = mod.page_actions[Number(btn.dataset.tool)];
    try {
      const m = await import(`./${tool}.js`);
      m.open();
    } catch (err) {
      toast(err.message || 'No se pudo abrir la herramienta.', 'error');
    }
  }));
  $('[data-export]', root).addEventListener('click', () => {
    const qs = queryString({ forExport: true });
    window.location.href = `/api/${mod.key}/exportar${qs ? `?${qs}` : ''}`;
  });

  thead.addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (!th || !th.dataset.sort) return;
    const name = th.dataset.sort;
    update({ sort: name, dir: state.sort === name && state.dir === 'asc' ? 'desc' : 'asc' });
  });
  pager.addEventListener('click', e => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    update({ page: Number(btn.dataset.page) }, { resetPage: false });
    root.querySelector('.card').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  tbody.addEventListener('click', e => {
    if (e.target.closest('[data-retry]')) return load();
    const btn = e.target.closest('[data-act]');
    if (!btn) {
      const tr = e.target.closest('tr[data-id]');
      if (tr && !e.target.closest('a')) openView(tr.dataset.id);
      return;
    }
    const { act, id } = btn.dataset;
    if (act === 'view') openView(id);
    if (act === 'edit') openForm({ [mod.pk]: id });
    if (act === 'delete') remove(id);
    if (act === 'custom') {
      const a = mod.actions[Number(btn.dataset.i)];
      const row = lastRows.find(r => String(r[mod.pk]) === String(id)) ?? { [mod.pk]: id };
      runAction(a, row, btn);
    }
  });

  renderFilters();
  renderChips();
  syncUrl();
  load();
}
