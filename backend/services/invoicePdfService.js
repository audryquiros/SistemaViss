function escapePdfText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

function money(value, currency = '') {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${currency} ${value ?? ''}`.trim();
  return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

function wrapText(text, maxChars = 72) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if ((line + ' ' + word).length <= maxChars) line += ' ' + word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function buildContent(invoice) {
  const lines = [];
  const text = (x, y, value, size = 10) => {
    lines.push(`/F1 ${size} Tf ${x} ${y} Td (${escapePdfText(value)}) Tj`);
  };
  const line = (x1, y1, x2, y2) => lines.push(`${x1} ${y1} m ${x2} ${y2} l S`);

  let y = 760;
  text(50, y, 'SISTEMAVISION', 18); y -= 25;
  text(50, y, 'Factura', 12);
  text(430, y, invoice.numero_factura || 'Sin numero', 12); y -= 18;
  text(50, y, `Fecha de emision: ${invoice.fecha_emision || 'No disponible'}`, 9); y -= 20;
  line(50, y, 545, y); y -= 22;

  text(50, y, 'EMISOR', 8); y -= 14;
  for (const l of wrapText(invoice.emisor_nombre || 'No disponible', 48)) { text(50, y, l, 10); y -= 13; }
  if (invoice.emisor_nif_rfc) { text(50, y, `Identificacion: ${invoice.emisor_nif_rfc}`, 8); y -= 13; }

  text(310, y + 27, 'RECEPTOR', 8);
  for (const l of wrapText(invoice.receptor_nombre || 'No disponible', 34)) { text(310, y + 13, l, 10); y -= 13; }
  if (invoice.receptor_nif_rfc) { text(310, y + 13, `Identificacion: ${invoice.receptor_nif_rfc}`, 8); y -= 13; }
  y -= 8;

  line(50, y, 545, y); y -= 20;
  text(50, y, 'DETALLE', 8); y -= 16;
  text(50, y, 'Descripcion', 8);
  text(340, y, 'Cant.', 8);
  text(395, y, 'Precio', 8);
  text(475, y, 'Importe', 8); y -= 13;
  line(50, y, 545, y); y -= 15;

  const items = Array.isArray(invoice.items) ? invoice.items : [];
  for (const item of items) {
    const descLines = wrapText(item.descripcion || 'Sin descripcion', 43);
    text(50, y, descLines[0], 8);
    text(340, y, String(item.cantidad ?? ''), 8);
    text(395, y, money(item.precio_unitario, invoice.moneda), 8);
    text(475, y, money(item.importe, invoice.moneda), 8);
    y -= 12;
    for (let i = 1; i < descLines.length; i++) { text(50, y, descLines[i], 8); y -= 11; }
    if (y < 170) break;
  }

  y -= 8;
  line(350, y, 545, y); y -= 17;
  text(350, y, 'Subtotal', 9); text(475, y, money(invoice.subtotal, invoice.moneda), 9); y -= 15;
  text(350, y, 'Impuestos', 9); text(475, y, money(invoice.impuestos, invoice.moneda), 9); y -= 18;
  text(350, y, 'TOTAL', 11); text(470, y, money(invoice.total, invoice.moneda), 11);

  y = 70;
  line(50, y, 545, y); y -= 15;
  text(50, y, 'Documento generado por SistemaVision a partir de la factura almacenada.', 7);

  return lines.join('\n');
}

function createPdfBuffer(invoice) {
  const content = buildContent(invoice);
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  const pages = add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  const page = add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const stream = `BT\n${content}\nET`;
  const contentObj = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  add(contentObj);

  let pdf = '%PDF-1.4\n%âãÏÓ\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

module.exports = { createPdfBuffer };
