// Panel de inicio: indicadores, gráfico de ventas mensuales y listas de seguimiento.
import { api } from './api.js';
import { $, badge, esc, fmtCompactMoney, fmtDate, fmtMoney, fmtNumber, icon } from './ui.js';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthLabel = (key, withYear = false) => {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1]}${withYear ? ` ${y}` : ''}`;
};

function niceMax(value) {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find(s => s * exp * 4 >= value) * exp;
  return step * 4;
}

// Columnas de una sola serie: una sola tinta, sin leyenda (el título la nombra), tooltip por mes.
function renderChart(container, data, onSelect) {
  const tip = $('.chart-tip', container.parentNode);
  const draw = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    const pad = { top: 12, right: 8, bottom: 26, left: 62 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const max = niceMax(Math.max(...data.map(d => d.venta)));
    const band = plotW / data.length;
    const barW = Math.min(24, band * 0.62);
    const y = v => pad.top + plotH - (v / max) * plotH;
    const ticks = [0, 1, 2, 3, 4].map(i => (max / 4) * i);
    const narrow = width < 520;

    const grid = ticks.map(t => `
      <line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(t)}" y2="${y(t)}"/>
      <text class="axis-text" x="${pad.left - 10}" y="${y(t) + 4}" text-anchor="end">${fmtCompactMoney(t)}</text>`).join('');
    const bars = data.map((d, i) => {
      const cx = pad.left + band * i + band / 2;
      const top = y(d.venta);
      const hgt = pad.top + plotH - top;
      const r = Math.min(4, hgt, barW / 2);
      const x0 = cx - barW / 2;
      const x1 = cx + barW / 2;
      const base = pad.top + plotH;
      const path = hgt > 0
        ? `M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x1 - r} Q${x1},${top} ${x1},${top + r} V${base} Z`
        : '';
      const showLabel = !narrow || i % 2 === data.length % 2 || i === data.length - 1;
      return `
        ${path ? `<path class="bar" data-i="${i}" d="${path}"/>` : ''}
        ${showLabel ? `<text class="axis-text" x="${cx}" y="${height - 6}" text-anchor="middle">${monthLabel(d.mes)}</text>` : ''}
        <rect class="hit" data-i="${i}" x="${pad.left + band * i}" y="${pad.top}" width="${band}" height="${plotH}"><title>${monthLabel(d.mes, true)}</title></rect>`;
    }).join('');
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Ventas de los últimos 12 meses">${grid}${bars}</svg>`;

    const svg = $('svg', container);
    const hide = () => { tip.hidden = true; container.querySelectorAll('.bar').forEach(b => b.classList.remove('dim')); };
    svg.addEventListener('mousemove', e => {
      const hit = e.target.closest('.hit');
      if (!hit) return hide();
      const i = Number(hit.dataset.i);
      const d = data[i];
      container.querySelectorAll('.bar').forEach(b => b.classList.toggle('dim', Number(b.dataset.i) !== i));
      const margin = d.venta ? Math.round(((d.venta - d.costo) / d.venta) * 100) : 0;
      tip.innerHTML = `<b>${monthLabel(d.mes, true)}</b>
        <div class="row"><span><i class="key"></i>Ventas</span><span>${fmtMoney(d.venta)}</span></div>
        <div class="row"><span>Pedidos</span><span>${fmtNumber(d.pedidos)}</span></div>
        <div class="row"><span>Margen</span><span>${margin} %</span></div>`;
      const cx = pad.left + band * i + band / 2;
      tip.style.left = `${Math.min(Math.max(cx, 90), width - 90)}px`;
      tip.style.top = `${Math.max(y(d.venta) - 8, 70)}px`;
      tip.hidden = false;
    });
    svg.addEventListener('mouseleave', hide);
    svg.addEventListener('click', e => {
      const hit = e.target.closest('.hit');
      if (hit) onSelect(data[Number(hit.dataset.i)]);
    });
  };
  draw();
  const ro = new ResizeObserver(() => draw());
  ro.observe(container);
  return () => ro.disconnect();
}

export async function renderDashboard(root, { navigate }) {
  root.innerHTML = `<div class="page"><div class="page-head"><div><h1>${icon('home')} Inicio</h1><p>Cargando indicadores…</p></div></div></div>`;
  let data;
  try {
    data = await api.get('/api/dashboard');
  } catch (err) {
    root.innerHTML = `<div class="page"><div class="card table-state">${icon('alert')}<div>${esc(err.message)}</div></div></div>`;
    return;
  }
  const { kpis } = data;
  const change = kpis.venta_mes_anterior ? Math.round(((kpis.venta_mes - kpis.venta_mes_anterior) / kpis.venta_mes_anterior) * 100) : null;
  const total12 = data.ventas.reduce((a, m) => a + m.venta, 0);
  const topMax = Math.max(...data.top.map(t => Number(t.venta)), 1);
  const now = new Date();
  const hello = now.getHours() < 12 ? 'Buenos días' : now.getHours() < 20 ? 'Buenas tardes' : 'Buenas noches';
  const modules = window.SF.modules;

  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div>
        <h1>${esc(hello)}, ${esc(window.SF.user.usuario)}</h1>
        <p>${now.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>
      <div class="page-actions">
        ${modules.pedidos?.can_write ? `<a class="btn btn-accent" href="#/pedidos">${icon('plus')} Ir a pedidos</a>` : ''}
        ${modules.productos ? `<a class="btn" href="#/productos">${icon('box')} Productos</a>` : ''}
      </div>
    </div>

    <div class="kpis">
      <div class="card kpi">
        <div class="kpi-top">Ventas del mes <span class="kpi-icon">${icon('money')}</span></div>
        <div class="kpi-value">${fmtMoney(kpis.venta_mes)}</div>
        <div class="kpi-sub">${change === null ? 'Sin datos del mes anterior' : `<span class="${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '▲' : '▼'} ${Math.abs(change)} %</span> vs. mes anterior`}</div>
      </div>
      <a class="card kpi" href="#/pedidos?f_nump_estado=PENDIENTE" style="color:inherit;text-decoration:none">
        <div class="kpi-top">Pedidos pendientes <span class="kpi-icon amber">${icon('clipboard')}</span></div>
        <div class="kpi-value">${fmtNumber(kpis.pendientes)}</div>
        <div class="kpi-sub">${fmtNumber(kpis.pedidos_mes)} pedidos este mes</div>
      </a>
      <a class="card kpi" href="#/productos?f_prod_estado=Disponible" style="color:inherit;text-decoration:none">
        <div class="kpi-top">Productos disponibles <span class="kpi-icon green">${icon('box')}</span></div>
        <div class="kpi-value">${fmtNumber(kpis.productos)}</div>
        <div class="kpi-sub">en catálogo activo</div>
      </a>
      <div class="card kpi">
        <div class="kpi-top">Stock bajo o agotado <span class="kpi-icon red">${icon('alert')}</span></div>
        <div class="kpi-value">${fmtNumber(kpis.stock_bajo)}</div>
        <div class="kpi-sub">productos por reponer</div>
      </div>
      <a class="card kpi" href="#/clientes" style="color:inherit;text-decoration:none">
        <div class="kpi-top">Clientes <span class="kpi-icon">${icon('users')}</span></div>
        <div class="kpi-value">${fmtNumber(kpis.clientes)}</div>
        <div class="kpi-sub">registrados</div>
      </a>
    </div>

    <div class="dash-grid">
      <div class="card">
        <div class="card-head">
          <div><h2>Ventas de los últimos 12 meses</h2><p>${fmtMoney(total12)} en total · clic en un mes para ver sus salidas</p></div>
          <button class="btn btn-sm" data-toggle-table>${icon('table')} <span>Ver tabla</span></button>
        </div>
        <div class="card-body" style="position:relative">
          <div class="chart" data-chart></div>
          <div class="chart-tip" hidden></div>
          <div class="table-wrap" data-chart-table hidden>
            <table class="data compact">
              <thead><tr><th>Mes</th><th class="num">Pedidos</th><th class="num">Ventas</th><th class="num">Costo</th><th class="num">Margen</th></tr></thead>
              <tbody>${data.ventas.map(m => `<tr>
                <td data-label="Mes">${monthLabel(m.mes, true)}</td>
                <td class="num" data-label="Pedidos">${fmtNumber(m.pedidos)}</td>
                <td class="num" data-label="Ventas">${fmtMoney(m.venta)}</td>
                <td class="num" data-label="Costo">${fmtMoney(m.costo)}</td>
                <td class="num" data-label="Margen">${fmtMoney(m.venta - m.costo)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Productos más vendidos</h2><p>Últimos 12 meses, por monto</p></div></div>
        <div class="card-body">
          ${data.top.length ? `<ol class="rank">${data.top.map((t, i) => `
            <li class="link-row" data-product="${t.id_producto}">
              <span class="pos">${i + 1}</span>
              <span class="name"><b>${esc(t.prod_codigo)}</b><small>${esc(t.prod_descripcion)}</small>
                <span class="meter"><i style="width:${(Number(t.venta) / topMax) * 100}%"></i></span></span>
              <span class="val">${fmtMoney(t.venta)}<br><small class="cell-muted">${fmtNumber(t.unidades)} u.</small></span>
            </li>`).join('')}</ol>` : '<div class="table-state">Sin ventas en el período.</div>'}
        </div>
      </div>
    </div>

    <div class="dash-grid even">
      <div class="card">
        <div class="card-head"><div><h2>Pedidos recientes</h2></div><a class="btn btn-sm" href="#/pedidos">Ver todos</a></div>
        <div class="table-wrap">
          <table class="data compact">
            <thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>Estado</th><th class="num">Total</th></tr></thead>
            <tbody>${data.recientes.map(p => `<tr class="link-row" data-order="${p.id_n_pedido}">
              <td data-label="N°" class="primary-cell">${esc(p.nump_numero)}</td>
              <td data-label="Fecha">${fmtDate(p.nump_fecha)}</td>
              <td data-label="Cliente" class="clip">${esc(p.cli_nombre)}</td>
              <td data-label="Estado">${badge(p.nump_estado)}</td>
              <td data-label="Total" class="num">${fmtMoney(p.total_venta)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Stock bajo</h2><p>Disponibles con stock igual o menor al mínimo</p></div></div>
        <div class="table-wrap">
          ${data.stock_bajo.length ? `<table class="data compact">
            <thead><tr><th>Código</th><th>Descripción</th><th>Marca</th><th class="num">Stock</th></tr></thead>
            <tbody>${data.stock_bajo.map(p => `<tr class="link-row" data-product="${p.id_producto}">
              <td data-label="Código" class="primary-cell">${esc(p.prod_codigo)}</td>
              <td data-label="Descripción" class="clip">${esc(p.prod_descripcion)}</td>
              <td data-label="Marca">${esc(p.marca_nombre)}</td>
              <td data-label="Stock" class="num"><span class="badge ${Number(p.prod_cantidad) === 0 ? 'danger' : 'warning'} plain">${fmtNumber(p.prod_cantidad)}</span></td></tr>`).join('')}</tbody>
          </table>` : '<div class="table-state">Todo el stock está sobre el mínimo.</div>'}
        </div>
      </div>
    </div>
  </div>`;

  const chartEl = $('[data-chart]', root);
  const stop = renderChart(chartEl, data.ventas, month => {
    const [y, m] = month.mes.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    navigate(`#/salidas?desde=${month.mes}-01&hasta=${month.mes}-${String(last).padStart(2, '0')}`);
  });
  const toggle = $('[data-toggle-table]', root);
  toggle.addEventListener('click', () => {
    const table = $('[data-chart-table]', root);
    table.hidden = !table.hidden;
    chartEl.hidden = !table.hidden;
    $('span', toggle).textContent = table.hidden ? 'Ver tabla' : 'Ver gráfico';
    toggle.querySelector('svg').outerHTML = icon(table.hidden ? 'table' : 'chart');
  });
  root.addEventListener('click', e => {
    const product = e.target.closest('[data-product]');
    const order = e.target.closest('[data-order]');
    if (product) navigate(`#/productos?q=${encodeURIComponent(product.querySelector('.primary-cell, b')?.textContent || '')}`);
    if (order) navigate(`#/salidas?f_id_n_pedido=${order.dataset.order}`);
  });
  return stop;
}

