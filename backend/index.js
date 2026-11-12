const express = require('express');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

const { analizarFactura } = require('./services/agentServiceFacturas');
const { getContext, rememberInvoice } = require('./memory/agentMemory');
const { conversarConAgente } = require('./services/chatService');
const { createPdfBuffer } = require('./services/invoicePdfService');
const { sequelize } = require('./models');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Solo se permiten archivos de imagen (JPEG, PNG, WebP).'), false);
  },
});

async function backfillFingerprintsFacturas() {
  const { Factura, FacturaItem } = require('./models');
  const { construirFingerprint } = require('./services/agentServiceFacturas');

  const pendientes = await Factura.findAll({
    where: { fingerprint: null },
    include: [{ model: FacturaItem, as: 'items' }],
    order: [['id', 'ASC']],
  });

  if (!pendientes.length) return;

  let actualizadas = 0;
  for (const factura of pendientes) {
    const row = factura.toJSON();
    const normalizada = {
      numero_factura: row.numero_factura,
      fecha_emision: row.fecha_emision,
      moneda: row.moneda,
      emisor: { nombre: row.emisor_nombre, nif_rfc: row.emisor_nif_rfc, direccion: row.emisor_direccion },
      receptor: { nombre: row.receptor_nombre, nif_rfc: row.receptor_nif_rfc },
      subtotal: row.subtotal,
      impuestos: row.impuestos,
      total: row.total,
      items: row.items || [],
    };
    const fingerprint = construirFingerprint(normalizada);

    try {
      await factura.update({ fingerprint });
      actualizadas += 1;
    } catch (error) {
      // Si ya existe otro registro con exactamente el mismo contenido,
      // dejamos este registro histórico sin fingerprint. La comprobación
      // por contenido durante el guardado seguirá detectando el duplicado.
      if (error?.name !== 'SequelizeUniqueConstraintError') throw error;
    }
  }

  if (actualizadas) console.log(`Fingerprints sincronizados: ${actualizadas} factura(s) existentes.`);
}

async function asegurarEsquemaFacturas() {
  const database = sequelize.getDatabaseName();
  const [columnas] = await sequelize.query(`
    SELECT COUNT(*) AS total
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = 'facturas'
      AND COLUMN_NAME = 'fingerprint'
  `, { replacements: [database] });

  if (Number(columnas[0].total) === 0) {
    console.log('Agregando columna fingerprint a facturas...');
    await sequelize.query(`
      ALTER TABLE facturas
      ADD COLUMN fingerprint VARCHAR(64) NULL
    `);
  }

  const [indices] = await sequelize.query(`
    SELECT COUNT(*) AS total
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = ?
      AND TABLE_NAME = 'facturas'
      AND INDEX_NAME = 'uq_facturas_fingerprint'
  `, { replacements: [database] });

  if (Number(indices[0].total) === 0) {
    await sequelize.query(`
      ALTER TABLE facturas
      ADD UNIQUE KEY uq_facturas_fingerprint (fingerprint)
    `);
  }
}

app.get('/api/health', async (req, res) => {
  let database = 'disconnected';
  try {
    await sequelize.authenticate();
    database = 'connected';
  } catch {}
  res.json({ status: 'ok', service: 'SistemaVision BE', database });
});

app.post('/api/facturas/analizar', upload.single('factura'), async (req, res) => {
  try {
    let imagenInput = null;
    let mimeType = 'image/jpeg';

    if (req.file) {
      imagenInput = req.file.buffer;
      mimeType = req.file.mimetype;
    } else if (req.body?.imagen) {
      imagenInput = req.body.imagen;
    } else if (req.body?.url) {
      imagenInput = req.body.url;
    }

    if (!imagenInput) {
      return res.status(400).json({
        success: false,
        error: 'Debe adjuntar una imagen en "factura" o enviar "imagen"/"url".',
      });
    }

    const sessionId = req.body?.session_id || 'default';
    const resultado = await analizarFactura(imagenInput, {
      mimeType,
      detail: req.body?.detail || 'low',
      context: getContext(sessionId),
    });

    rememberInvoice(sessionId, resultado);

    return res.json({
      success: true,
      data: resultado,
      memory: getContext(sessionId),
    });
  } catch (error) {
    console.error('Error al analizar factura:', error);
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      error: error.message || 'Error interno al procesar la factura.',
      ...(error.statusCode === 409 ? { duplicate: true, facturaExistente: error.facturaExistente } : {}),
    });
  }
});

app.get('/api/facturas/memoria/:sessionId', (req, res) => {
  res.json({ success: true, data: getContext(req.params.sessionId) });
});

app.post('/api/chat', async (req, res) => {
  try {
    const sessionId = req.body?.session_id || 'default';
    const message = req.body?.message;
    const result = await conversarConAgente(sessionId, message, getContext(sessionId));
    return res.json({
      success: true,
      data: result,
      memory: getContext(sessionId),
    });
  } catch (error) {
    console.error('Error en chat del agente:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'No se pudo procesar la solicitud del asistente.',
    });
  }
});


app.get('/api/facturas/:id/export/:format', async (req, res) => {
  try {
    const { Factura, FacturaItem } = require('./models');
    const factura = await Factura.findByPk(req.params.id, {
      include: [{ model: FacturaItem, as: 'items' }],
    });
    if (!factura) return res.status(404).json({ success: false, error: 'Factura no encontrada.' });

    const f = factura.toJSON();
    const format = String(req.params.format).toLowerCase();
    const safeNumber = String(f.numero_factura || f.id).replace(/[^a-zA-Z0-9_-]/g, '_');

    if (format === 'pdf') {
      const buffer = createPdfBuffer(f);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="factura-${safeNumber}.pdf"`);
      return res.send(buffer);
    }

    const money = (value) => Number(value || 0).toFixed(2);
    const items = Array.isArray(f.items) ? f.items : [];

    if (format === 'json') {
      const body = JSON.stringify(f, null, 2);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="factura-${safeNumber}.json"`);
      return res.send(body);
    }

    if (format === 'csv') {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [
        ['Factura', 'Fecha', 'Emisor', 'Receptor', 'Moneda', 'Subtotal', 'Impuestos', 'Total'],
        [f.numero_factura, f.fecha_emision, f.emisor_nombre, f.receptor_nombre, f.moneda, money(f.subtotal), money(f.impuestos), money(f.total)],
        [],
        ['Descripción', 'Cantidad', 'Precio unitario', 'Importe'],
        ...items.map(i => [i.descripcion, i.cantidad, money(i.precio_unitario), money(i.importe)]),
      ];
      const body = rows.map(row => row.map(esc).join(',')).join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="factura-${safeNumber}.csv"`);
      return res.send('﻿' + body);
    }

    if (format === 'excel') {
      // SpreadsheetML es un formato XML nativo de Excel y no requiere dependencias externas.
      const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const row = (cells) => `<Row>${cells.map(v => `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`).join('')}</Row>`;
      const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>
      <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
        <Worksheet ss:Name="Factura"><Table>
          ${row(['Factura', f.numero_factura])}${row(['Fecha', f.fecha_emision])}${row(['Emisor', f.emisor_nombre])}${row(['Receptor', f.receptor_nombre])}${row(['Moneda', f.moneda])}${row(['Subtotal', money(f.subtotal)])}${row(['Impuestos', money(f.impuestos)])}${row(['Total', money(f.total)])}
          ${row([])}${row(['Descripción', 'Cantidad', 'Precio unitario', 'Importe'])}
          ${items.map(i => row([i.descripcion, i.cantidad, money(i.precio_unitario), money(i.importe)])).join('')}
        </Table></Worksheet></Workbook>`;
      res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="factura-${safeNumber}.xls"`);
      return res.send(xml);
    }

    if (format === 'html') {
      const body = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Factura ${escHtml(f.numero_factura)}</title><style>body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;color:#172033}h1{margin-bottom:4px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.card{border:1px solid #ddd;padding:16px;border-radius:10px}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left}.total{font-size:22px;font-weight:700}</style></head><body><h1>Factura ${escHtml(f.numero_factura)}</h1><p>${escHtml(f.fecha_emision)}</p><div class="grid"><div class="card"><b>Emisor</b><div>${escHtml(f.emisor_nombre)}</div><div>${escHtml(f.emisor_nif_rfc)}</div></div><div class="card"><b>Receptor</b><div>${escHtml(f.receptor_nombre)}</div><div>${escHtml(f.receptor_nif_rfc)}</div></div></div><table><thead><tr><th>Descripción</th><th>Cantidad</th><th>Precio</th><th>Importe</th></tr></thead><tbody>${items.map(i => `<tr><td>${escHtml(i.descripcion)}</td><td>${escHtml(i.cantidad)}</td><td>${money(i.precio_unitario)}</td><td>${money(i.importe)}</td></tr>`).join('')}</tbody></table><p>Subtotal: ${money(f.subtotal)} ${escHtml(f.moneda)}</p><p>Impuestos: ${money(f.impuestos)} ${escHtml(f.moneda)}</p><p class="total">Total: ${money(f.total)} ${escHtml(f.moneda)}</p></body></html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="factura-${safeNumber}.html"`);
      return res.send(body);
    }

    if (format === 'txt') {
      const lines = [
        `FACTURA ${f.numero_factura || ''}`,
        `Fecha: ${f.fecha_emision || ''}`,
        `Emisor: ${f.emisor_nombre || ''}`,
        `Receptor: ${f.receptor_nombre || ''}`,
        '', 'DETALLE',
        ...items.map(i => `${i.descripcion} | Cantidad: ${i.cantidad} | Precio: ${money(i.precio_unitario)} | Importe: ${money(i.importe)}`),
        '', `Subtotal: ${money(f.subtotal)} ${f.moneda || ''}`,
        `Impuestos: ${money(f.impuestos)} ${f.moneda || ''}`,
        `Total: ${money(f.total)} ${f.moneda || ''}`,
      ];
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="factura-${safeNumber}.txt"`);
      return res.send(lines.join('\n'));
    }

    return res.status(400).json({ success: false, error: 'Formato no soportado. Usa pdf, excel, csv, json, html o txt.' });
  } catch (error) {
    console.error('Error exportando factura:', error);
    return res.status(500).json({ success: false, error: 'No se pudo generar el archivo.' });
  }
});

function escHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

app.get('/api/facturas', async (req, res) => {
  try {
    const { Factura, FacturaItem } = require('./models');
    const facturas = await Factura.findAll({
      include: [{ model: FacturaItem, as: 'items' }],
      order: [['createdAt', 'DESC']],
    });
    res.json({ success: true, data: facturas });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, error: `Error en la subida: ${err.message}` });
  }
  if (err) return res.status(400).json({ success: false, error: err.message });
  next();
});

async function iniciarServidor() {
  try {
    await sequelize.authenticate();
    await asegurarEsquemaFacturas();
    await sequelize.sync();
    await backfillFingerprintsFacturas();
    console.log('Base de datos MySQL conectada y tablas sincronizadas.');
  } catch (error) {
    console.error('No se pudo conectar/sincronizar MySQL:', error.message);
  }

  app.listen(PORT, () => {
    console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
  });
}

if (require.main === module) iniciarServidor();

module.exports = app;
