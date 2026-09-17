// Datos del panel de inicio.
import { Router } from 'express';
import { db } from './db.js';

const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const dateISO = d => `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;

export const dashboardRouter = Router();

dashboardRouter.get('/dashboard', async (req, res) => {
  const today = new Date();
  const firstMonth = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  const currentKey = monthKey(today);
  const previousKey = monthKey(new Date(today.getFullYear(), today.getMonth() - 1, 1));

  const [monthlyRows, counts, top, low, recent] = await Promise.all([
    db.all('SELECT mes, pedidos, venta, costo FROM v_ventas_mensuales WHERE mes BETWEEN ? AND ?', [monthKey(firstMonth), currentKey]),
    db.one(`SELECT (SELECT COUNT(*) FROM sf_producto WHERE prod_estado = 'Disponible') AS productos,
                   (SELECT COUNT(*) FROM v_producto_stock_bajo) AS stock_bajo,
                   (SELECT COUNT(*) FROM sf_cliente) AS clientes,
                   (SELECT COUNT(*) FROM sf_pedido WHERE nump_estado = 'PENDIENTE') AS pendientes,
                   (SELECT COUNT(*) FROM sf_pedido WHERE nump_fecha > CURDATE()) AS fechas_futuras`),
    db.all(`SELECT p.id_producto, p.prod_codigo, p.prod_descripcion, SUM(s.salip_cantidad) AS unidades, SUM(s.salip_total) AS venta
            FROM sf_salida_productos s JOIN sf_producto p ON p.id_producto = s.id_producto
            WHERE s.salip_fecha BETWEEN ? AND CURDATE() GROUP BY p.id_producto ORDER BY venta DESC LIMIT 6`, [dateISO(firstMonth)]),
    db.all('SELECT * FROM v_producto_stock_bajo ORDER BY prod_cantidad ASC, prod_descripcion LIMIT 8'),
    db.all(`SELECT id_n_pedido, nump_numero, nump_fecha, nump_estado, cli_nombre, items, total_venta
            FROM v_pedido_resumen WHERE nump_fecha <= CURDATE() ORDER BY nump_fecha DESC, id_n_pedido DESC LIMIT 6`),
  ]);

  const byMonth = new Map(monthlyRows.map(r => [r.mes, r]));
  const ventas = [];
  for (let d = new Date(firstMonth); d <= today; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const r = byMonth.get(monthKey(d));
    ventas.push({ mes: monthKey(d), pedidos: Number(r?.pedidos ?? 0), venta: Number(r?.venta ?? 0), costo: Number(r?.costo ?? 0) });
  }
  const current = ventas.find(m => m.mes === currentKey) ?? { venta: 0, pedidos: 0 };
  const previous = ventas.find(m => m.mes === previousKey) ?? { venta: 0 };

  res.json({
    kpis: {
      ...Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)])),
      venta_mes: current.venta,
      venta_mes_anterior: previous.venta,
      pedidos_mes: current.pedidos,
    },
    ventas,
    top,
    stock_bajo: low,
    recientes: recent,
  });
});
