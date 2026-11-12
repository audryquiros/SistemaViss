const express = require('express');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

const { analizarFactura, ejecutarHerramientaGuardarFactura } = require('./services/agentServiceFacturas');
const { getContext, rememberInvoice } = require('./memory/agentMemory');
const { conversarConAgente } = require('./services/chatService');
const { createPdfBuffer } = require('./services/invoicePdfService');
const { buildExport } = require('./services/exportService');
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


app.post('/api/facturas/manual', async (req, res) => {
  try {
    const factura = req.body?.factura;
    if (!factura) {
      return res.status(400).json({ success: false, error: 'Debes enviar los datos de la factura.' });
    }

    // El número se genera exclusivamente en backend. Nunca confiamos en un número enviado por el frontend.
    const anio = Number(String(factura.fecha_emision || new Date().toISOString().slice(0, 10)).slice(0, 4)) || new Date().getFullYear();
    const numeroAutomatico = await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        'INSERT INTO secuencias_factura (anio, ultimo_numero) VALUES (?, 0) ON DUPLICATE KEY UPDATE ultimo_numero = ultimo_numero',
        { replacements: [anio], transaction }
      );
      const [[seq]] = await sequelize.query(
        'SELECT ultimo_numero FROM secuencias_factura WHERE anio = ? FOR UPDATE',
        { replacements: [anio], transaction }
      );
      const siguiente = Number(seq?.ultimo_numero || 0) + 1;
      await sequelize.query(
        'UPDATE secuencias_factura SET ultimo_numero = ? WHERE anio = ?',
        { replacements: [siguiente, anio], transaction }
      );
      return `FAC-${anio}-${String(siguiente).padStart(5, '0')}`;
    });
    const facturaSinNumero = { ...factura, numero_factura: numeroAutomatico };
    const resultado = await ejecutarHerramientaGuardarFactura({
      factura: facturaSinNumero,
      nivel_detalle: 'manual',
    });

    const { Factura, FacturaItem } = require('./models');
    const guardada = await Factura.findByPk(resultado.id, {
      include: [{ model: FacturaItem, as: 'items' }],
    });

    if (!guardada) {
      return res.status(500).json({ success: false, error: 'La factura se guardó, pero no pudo recuperarse para generar el archivo.' });
    }

    const plain = guardada.toJSON();
    const formato = String(req.body?.formato || 'pdf').toLowerCase();
    const formatosPermitidos = ['pdf', 'excel', 'csv', 'json', 'xml', 'html', 'txt'];
    if (!formatosPermitidos.includes(formato)) {
      return res.status(400).json({ success: false, error: 'Formato de factura no soportado.' });
    }

    return res.status(201).json({
      success: true,
      message: `Factura ${plain.numero_factura || ''} creada correctamente.`.trim(),
      data: plain,
      download: {
        id: plain.id,
        format: formato,
        label: `Descargar ${formato === 'excel' ? 'Excel' : formato.toUpperCase()}`,
        url: `/api/facturas/${plain.id}/export/${formato}`,
      },
    });
  } catch (error) {
    console.error('Error creando factura manual:', error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'No se pudo crear la factura.',
      ...(error.statusCode === 409 ? { duplicate: true, facturaExistente: error.facturaExistente } : {}),
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
    try {
      const file = buildExport(f, format);
      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
      return res.send(file.buffer);
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message || 'Formato no soportado.' });
    }
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
