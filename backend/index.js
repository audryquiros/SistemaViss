const express = require('express');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

const { analizarFactura } = require('./services/agentServiceFacturas');
const { getContext, rememberInvoice } = require('./memory/agentMemory');
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
    return res.status(500).json({
      success: false,
      error: error.message || 'Error interno al procesar la factura.',
    });
  }
});

app.get('/api/facturas/memoria/:sessionId', (req, res) => {
  res.json({ success: true, data: getContext(req.params.sessionId) });
});

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
    await sequelize.sync();
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
