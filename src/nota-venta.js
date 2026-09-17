// Nota de venta en PDF de un pedido (formato de la nota impresa original).
//
// Los precios del sistema incluyen IVA y así se muestran en la tabla (igual que en Productos):
//   precio unitario  = precio de venta con IVA
//   total de línea   = cantidad × precio con IVA
//   TOTAL A PAGAR    = suma de los totales de línea (lo que paga el cliente)
//   TOTAL NETO       = TOTAL A PAGAR / 1,19 (redondeado)
//   I.V.A. 19%       = TOTAL A PAGAR − TOTAL NETO
// Así la columna Total suma exactamente el total a pagar, sin diferencias por redondeo.
import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { db } from './db.js';
import { ApiError } from './errores.js';
import { getLogoPng } from './logo.js';
import { MODULES, canRead } from './modules.js';

const IVA = 0.19;
const PAGE = { width: 595.28, height: 841.89, margin: 36 };
const CONTENT_W = PAGE.width - PAGE.margin * 2;
const COLORS = { text: '#111111', muted: '#555555', border: '#8a8f98', header: '#e7e9ec', navy: '#0f2a47', amber: '#f2b705', red: '#c0392b' };
const COLUMNS = [
  { key: 'cantidad', label: 'Cantidad', width: 62, align: 'right' },
  { key: 'codigo', label: 'Código', width: 128, align: 'center' },
  { key: 'marca', label: 'Marca', width: 108, align: 'center' },
  { key: 'unitario', label: 'Precio Unit.', width: 105, align: 'right' },
  { key: 'total', label: 'Total', width: CONTENT_W - 62 - 128 - 108 - 105, align: 'right' },
];
const ROW_H = 17;
const HEADER_H = 20;
const TOTALS_H = 3 * 19;
const FOOTER_H = 96;

const money = n => Math.round(n).toLocaleString('es-CL');
const qty = n => Number(n).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateCL = iso => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const rutCL = rut => {
  const [body, dv] = String(rut ?? '').split('-');
  return dv && /^\d+$/.test(body) ? `${Number(body).toLocaleString('es-CL')}-${dv}` : (rut ?? '');
};
const folio = numero => (/^\d+$/.test(numero) ? numero.padStart(6, '0') : numero);

function drawDefaultLogo(doc, x, y, size) {
  doc.roundedRect(x, y, size, size, 8).fill(COLORS.navy);
  const s = size / 24;
  const p = (px, py) => [x + px * s, y + py * s];
  doc.polygon(p(5, 5), p(19, 5), p(13.5, 12), p(13.5, 17.5), p(10.5, 19), p(10.5, 12)).fill(COLORS.amber);
}

// ---------------------------------------------------------------------------
//  Dibujo
// ---------------------------------------------------------------------------
const MIN_FONT = 6;

// Texto de una celda en una sola línea. Si no cabe, se achica la letra hasta MIN_FONT
// y solo entonces se corta con "…" (así los nombres largos de clientes se leen completos).
// Con wrap, si ni siquiera cabe con letra pequeña, usa hasta dos líneas.
function cellText(doc, text, x, y, width, height, { align = 'left', bold = false, size = 8.5, color = COLORS.text, wrap = false } = {}) {
  const value = String(text ?? '');
  const inner = width - 10;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
  let fontSize = size;
  const minFont = wrap ? 7.5 : MIN_FONT;
  while (fontSize > minFont && doc.fontSize(fontSize).widthOfString(value) > inner) fontSize -= 0.25;
  if (wrap && doc.fontSize(fontSize).widthOfString(value) > inner) {
    const small = 7;
    const blockH = doc.fontSize(small).currentLineHeight(true) * 2;
    doc.fillColor(color)
      .text(value, x + 5, y + (height - blockH) / 2, { width: inner, align, height: blockH + 1, ellipsis: true });
    return;
  }
  doc.fontSize(fontSize).fillColor(color)
    .text(value, x + 5, y + (height - fontSize) / 2 + 0.5, { width: inner, align, lineBreak: false, ellipsis: true, height: fontSize + 2 });
}

function drawHeader(doc, data, logo) {
  const top = PAGE.margin;
  const x = PAGE.margin;
  const boxH = 72;

  // Logo
  const logoSize = boxH;
  doc.lineWidth(0.8).strokeColor(COLORS.border).roundedRect(x, top, logoSize, logoSize, 6).stroke();
  if (logo) {
    try {
      doc.image(logo, x + 5, top + 5, { fit: [logoSize - 10, logoSize - 10], align: 'center', valign: 'center' });
    } catch {
      drawDefaultLogo(doc, x + 10, top + 10, logoSize - 20);
    }
  } else {
    drawDefaultLogo(doc, x + 10, top + 10, logoSize - 20);
  }

  // Cliente, fecha y RUT
  const cx = x + logoSize + 10;
  const numW = 140;
  const cw = CONTENT_W - logoSize - 10 - numW - 10;
  const rowH = boxH / 3;
  const rows = [['Cliente:', data.cliente], ['Fecha:', dateCL(data.fecha)], ['Rut:', rutCL(data.rut)]];
  rows.forEach(([label, value], i) => {
    const ry = top + i * rowH;
    doc.lineWidth(0.8).strokeColor(COLORS.border).rect(cx, ry, cw, rowH).stroke();
    cellText(doc, label, cx, ry, 52, rowH, { bold: true, size: 8.5 });
    cellText(doc, value, cx + 44, ry, cw - 44, rowH, { size: 9, wrap: i === 0 });
  });

  // Número y título
  const nx = x + CONTENT_W - numW;
  doc.lineWidth(0.8).strokeColor(COLORS.border).rect(nx, top, numW, boxH).stroke();
  doc.font('Helvetica-Bold').fontSize(24).fillColor(COLORS.text).text(folio(data.numero), nx, top + 12, { width: numW, align: 'center', lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(10).text('NOTA DE VENTA', nx, top + 44, { width: numW, align: 'center', lineBreak: false });
  if (data.estado === 'ANULADO') {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.red).text('ANULADO', nx, top + 58, { width: numW, align: 'center', lineBreak: false });
  }
  return top + boxH + 16;
}

function drawTableHeader(doc, y) {
  let x = PAGE.margin;
  doc.rect(x, y, CONTENT_W, HEADER_H).fill(COLORS.header);
  for (const col of COLUMNS) {
    doc.lineWidth(0.8).strokeColor(COLORS.border).rect(x, y, col.width, HEADER_H).stroke();
    cellText(doc, col.label, x, y, col.width, HEADER_H, { align: 'center', size: 9 });
    x += col.width;
  }
  return y + HEADER_H;
}

function drawRow(doc, y, row) {
  let x = PAGE.margin;
  for (const col of COLUMNS) {
    doc.lineWidth(0.6).strokeColor(COLORS.border).rect(x, y, col.width, ROW_H).stroke();
    cellText(doc, row[col.key], x, y, col.width, ROW_H, { align: col.align });
    x += col.width;
  }
  return y + ROW_H;
}

function drawTotals(doc, y, totals) {
  const labelW = 110;
  const valueW = COLUMNS.at(-1).width;
  const x = PAGE.margin + CONTENT_W - labelW - valueW;
  const lines = [['TOTAL NETO', totals.neto], ['I.V.A. 19%', totals.iva], ['TOTAL A PAGAR', totals.total]];
  lines.forEach(([label, value], i) => {
    const ry = y + i * 19;
    doc.lineWidth(0.8).strokeColor(COLORS.border).rect(x, ry, labelW, 19).stroke().rect(x + labelW, ry, valueW, 19).stroke();
    cellText(doc, label, x, ry, labelW, 19, { align: 'right', bold: true, size: 9 });
    cellText(doc, money(value), x + labelW, ry, valueW, 19, { align: 'right', bold: i === 2, size: 9.5 });
  });
  return y + TOTALS_H;
}

function drawSignature(doc) {
  const bottom = PAGE.height - PAGE.margin;
  const top = bottom - FOOTER_H;
  const x = PAGE.margin;
  const leftW = 250;
  doc.page.margins.bottom = 0;
  doc.lineWidth(0.8).strokeColor(COLORS.text).moveTo(x, bottom - 24).lineTo(x + leftW, bottom - 24).stroke();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.text).text('FIRMA CLIENTE', x + 4, bottom - 18, { lineBreak: false });
  doc.lineWidth(0.8).strokeColor(COLORS.border).rect(x + leftW + 40, top, CONTENT_W - leftW - 40, FOOTER_H).stroke();
}

export async function buildNotaVenta(pedidoId) {
  const pedido = await db.one(
    `SELECT p.nump_numero AS numero, p.nump_fecha AS fecha, p.nump_estado AS estado, c.cli_nombre AS cliente, c.cli_rut AS rut
     FROM sf_pedido p JOIN sf_cliente c ON c.id_cliente = p.id_cliente WHERE p.id_n_pedido = ?`, [pedidoId]);
  if (!pedido) throw new ApiError('Pedido no encontrado.', 404);

  const lineas = await db.all(
    `SELECT s.salip_cantidad AS cantidad, s.salip_venta AS venta, pr.prod_codigo AS codigo, m.marca_nombre AS marca
     FROM sf_salida_productos s
     JOIN sf_producto pr ON pr.id_producto = s.id_producto
     JOIN sf_marca m ON m.id_marca = pr.id_marca
     WHERE s.id_n_pedido = ? ORDER BY s.id_salida_p`, [pedidoId]);
  if (!lineas.length) throw new ApiError('El pedido no tiene productos: agrega líneas de salida antes de generar la nota de venta.', 422);

  const rows = lineas.map(l => {
    const bruto = Number(l.cantidad) * Number(l.venta);
    return {
      cantidad: qty(l.cantidad),
      codigo: l.codigo,
      marca: l.marca,
      unitario: money(Number(l.venta)),
      total: money(bruto),
      bruto,
    };
  });
  const total = Math.round(rows.reduce((a, r) => a + r.bruto, 0));
  const neto = Math.round(total / (1 + IVA));
  const totals = { neto, iva: total - neto, total };

  const empresa = await db.one('SELECT emp_nombre, emp_url_img FROM sf_empresa WHERE id_empresa = 1');
  const logo = await getLogoPng(empresa?.emp_url_img);

  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE.margin,
    bufferPages: true,
    info: { Title: `Nota de venta ${folio(pedido.numero)}`, Author: empresa?.emp_nombre || 'Santiago Filtros' },
  });

  let y = drawHeader(doc, pedido, logo);
  y = drawTableHeader(doc, y);
  const rowsBottom = PAGE.height - PAGE.margin - 24;
  for (const row of rows) {
    if (y + ROW_H > rowsBottom) {
      doc.addPage();
      y = drawTableHeader(doc, PAGE.margin);
    }
    y = drawRow(doc, y, row);
  }
  if (y + 8 + TOTALS_H > PAGE.height - PAGE.margin - FOOTER_H - 12) {
    doc.addPage();
    y = PAGE.margin;
  }
  drawTotals(doc, y + 8, totals);
  drawSignature(doc);

  const { count } = doc.bufferedPageRange();
  if (count > 1) {
    for (let i = 0; i < count; i += 1) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // escribir bajo el margen sin que pdfkit agregue una página nueva
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
        .text(`Nota de venta ${folio(pedido.numero)} · página ${i + 1} de ${count}`, PAGE.margin, PAGE.height - 22,
          { width: CONTENT_W, align: 'right', lineBreak: false });
    }
  }
  doc.end();
  return { doc, filename: `nota_venta_${folio(pedido.numero).replace(/[^\w-]/g, '_')}.pdf` };
}

export const notaVentaRouter = Router();

notaVentaRouter.get('/pedidos/:id/nota-venta.pdf', async (req, res) => {
  if (!canRead(MODULES.pedidos, req.user.permiso)) throw new ApiError('No tienes permiso para esta acción.', 403);
  if (!/^\d+$/.test(req.params.id)) throw new ApiError('Pedido no encontrado.', 404);
  const { doc, filename } = await buildNotaVenta(Number(req.params.id));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.ver ? 'inline' : 'attachment'}; filename="${filename}"`);
  doc.pipe(res);
});
