const { createPdfBuffer } = require('./invoicePdfService');

function safeFilename(value) {
  return String(value || 'factura').replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function normalizeInvoice(invoice) {
  return {
    id: invoice.id,
    numero_factura: invoice.numero_factura,
    fecha_emision: invoice.fecha_emision,
    moneda: invoice.moneda,
    emisor: {
      nombre: invoice.emisor_nombre,
      identificacion: invoice.emisor_nif_rfc,
      direccion: invoice.emisor_direccion,
    },
    receptor: {
      nombre: invoice.receptor_nombre,
      identificacion: invoice.receptor_nif_rfc,
    },
    subtotal: Number(invoice.subtotal || 0),
    impuestos: Number(invoice.impuestos || 0),
    total: Number(invoice.total || 0),
    items: (invoice.items || []).map((item) => ({
      descripcion: item.descripcion,
      cantidad: Number(item.cantidad || 0),
      precio_unitario: Number(item.precio_unitario || 0),
      importe: Number(item.importe || 0),
    })),
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createCsv(invoice) {
  const f = normalizeInvoice(invoice);
  const rows = [
    ['Factura', f.numero_factura],
    ['Fecha', f.fecha_emision],
    ['Moneda', f.moneda],
    ['Emisor', f.emisor.nombre],
    ['Identificación emisor', f.emisor.identificacion],
    ['Receptor', f.receptor.nombre],
    ['Identificación receptor', f.receptor.identificacion],
    [],
    ['Descripción', 'Cantidad', 'Precio unitario', 'Importe'],
    ...f.items.map((i) => [i.descripcion, i.cantidad, i.precio_unitario, i.importe]),
    [],
    ['Subtotal', f.subtotal],
    ['Impuestos', f.impuestos],
    ['Total', f.total],
  ];
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

function createTxt(invoice) {
  const f = normalizeInvoice(invoice);
  const lines = [
    `SISTEMAVISION - FACTURA ${f.numero_factura || ''}`,
    `Fecha: ${f.fecha_emision || ''}`,
    `Moneda: ${f.moneda || ''}`,
    `Emisor: ${f.emisor.nombre || ''}`,
    `Receptor: ${f.receptor.nombre || ''}`,
    '',
    'PRODUCTOS Y SERVICIOS',
    ...f.items.map((i) => `${i.descripcion} | ${i.cantidad} x ${i.precio_unitario} = ${i.importe}`),
    '',
    `Subtotal: ${f.subtotal}`,
    `Impuestos: ${f.impuestos}`,
    `Total: ${f.total}`,
  ];
  return lines.join('\n');
}

function createHtml(invoice) {
  const f = normalizeInvoice(invoice);
  const money = (n) => `${f.moneda || ''} ${Number(n || 0).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
  const rows = f.items.map((i) => `<tr><td>${escapeHtml(i.descripcion)}</td><td>${i.cantidad}</td><td>${money(i.precio_unitario)}</td><td>${money(i.importe)}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Factura ${escapeHtml(f.numero_factura)}</title><style>body{font-family:Arial,sans-serif;margin:40px;color:#182238}h1{margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left}th{background:#f3f5f8}.totales{margin-top:24px;margin-left:auto;width:320px}.totales div{display:flex;justify-content:space-between;padding:6px}.total{font-size:20px;font-weight:700;border-top:2px solid #182238}</style></head><body><h1>Factura ${escapeHtml(f.numero_factura || '')}</h1><p>${escapeHtml(f.fecha_emision || '')}</p><p><b>Emisor:</b> ${escapeHtml(f.emisor.nombre || '')}<br><b>Receptor:</b> ${escapeHtml(f.receptor.nombre || '')}</p><table><thead><tr><th>Descripción</th><th>Cantidad</th><th>Precio unitario</th><th>Importe</th></tr></thead><tbody>${rows}</tbody></table><div class="totales"><div><span>Subtotal</span><span>${money(f.subtotal)}</span></div><div><span>Impuestos</span><span>${money(f.impuestos)}</span></div><div class="total"><span>Total</span><span>${money(f.total)}</span></div></div></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

// XLSX mínimo válido: usa strings inline y una sola hoja, sin dependencias externas.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.data, 'utf8');
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30 + name.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    name.copy(localHeader, 30);
    local.push(localHeader, data);

    const centralHeader = Buffer.alloc(46 + name.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    name.copy(centralHeader, 46);
    central.push(centralHeader);
    offset += localHeader.length + data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const localBuffer = Buffer.concat(local);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(localBuffer.length, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([localBuffer, centralBuffer, end]);
}

function xlsxCell(value) {
  const text = escapeXml(String(value ?? ''));
  if (typeof value === 'number' && Number.isFinite(value)) return `<c t="n"><v>${value}</v></c>`;
  return `<c t="inlineStr"><is><t>${text}</t></is></c>`;
}
function escapeXml(value) { return String(value).replace(/[<>&'\"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c])); }

function createXlsx(invoice) {
  const f = normalizeInvoice(invoice);
  const rows = [
    ['Factura', f.numero_factura], ['Fecha', f.fecha_emision], ['Moneda', f.moneda],
    ['Emisor', f.emisor.nombre], ['Receptor', f.receptor.nombre], [],
    ['Descripción', 'Cantidad', 'Precio unitario', 'Importe'],
    ...f.items.map((i) => [i.descripcion, i.cantidad, i.precio_unitario, i.importe]),
    [], ['Subtotal', f.subtotal], ['Impuestos', f.impuestos], ['Total', f.total],
  ];
  const sheetRows = rows.map((row, index) => `<row r="${index + 1}">${row.map((v) => xlsxCell(v)).join('')}</row>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Factura" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: rels },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}


function createXml(invoice) {
  const f = normalizeInvoice(invoice);
  const esc = (v) => escapeXml(String(v ?? ''));
  const items = f.items.map((i) => `<item><descripcion>${esc(i.descripcion)}</descripcion><cantidad>${i.cantidad}</cantidad><precio_unitario>${i.precio_unitario}</precio_unitario><importe>${i.importe}</importe></item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<factura><numero>${esc(f.numero_factura)}</numero><fecha_emision>${esc(f.fecha_emision)}</fecha_emision><moneda>${esc(f.moneda)}</moneda><emisor><nombre>${esc(f.emisor.nombre)}</nombre><identificacion>${esc(f.emisor.identificacion)}</identificacion><direccion>${esc(f.emisor.direccion)}</direccion></emisor><receptor><nombre>${esc(f.receptor.nombre)}</nombre><identificacion>${esc(f.receptor.identificacion)}</identificacion></receptor><items>${items}</items><subtotal>${f.subtotal}</subtotal><impuestos>${f.impuestos}</impuestos><total>${f.total}</total></factura>`;
}

function buildExport(invoice, format) {
  const f = normalizeInvoice(invoice);
  const base = `factura-${safeFilename(f.numero_factura || f.id)}`;
  switch (format) {
    case 'pdf': return { buffer: createPdfBuffer(invoice), contentType: 'application/pdf', extension: 'pdf', filename: `${base}.pdf`, label: 'Descargar PDF' };
    case 'xlsx': case 'excel': return { buffer: createXlsx(invoice), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx', filename: `${base}.xlsx`, label: 'Descargar Excel' };
    case 'csv': return { buffer: Buffer.from('\ufeff' + createCsv(invoice), 'utf8'), contentType: 'text/csv; charset=utf-8', extension: 'csv', filename: `${base}.csv`, label: 'Descargar CSV' };
    case 'json': return { buffer: Buffer.from(JSON.stringify(f, null, 2), 'utf8'), contentType: 'application/json; charset=utf-8', extension: 'json', filename: `${base}.json`, label: 'Descargar JSON' };
    case 'xml': return { buffer: Buffer.from(createXml(invoice), 'utf8'), contentType: 'application/xml; charset=utf-8', extension: 'xml', filename: `${base}.xml`, label: 'Descargar XML' };
    case 'txt': return { buffer: Buffer.from(createTxt(invoice), 'utf8'), contentType: 'text/plain; charset=utf-8', extension: 'txt', filename: `${base}.txt`, label: 'Descargar TXT' };
    case 'html': return { buffer: Buffer.from(createHtml(invoice), 'utf8'), contentType: 'text/html; charset=utf-8', extension: 'html', filename: `${base}.html`, label: 'Descargar HTML' };
    default: throw new Error('Formato de exportación no soportado.');
  }
}

module.exports = { buildExport, normalizeInvoice };
