const express = require('express');
const cors = require('cors');
const multer = require('multer');
require('dotenv').config();

const { analizarFactura } = require('./services/agentServiceFacturas');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuración de middlewares
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Configurar multer en memoria para procesar la imagen sin guardarla en disco
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // Máximo 15MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de imagen (JPEG, PNG, WebP).'), false);
    }
  },
});

// Ruta de health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'SistemaVision BE' });
});

/**
 * Endpoint para procesar la factura con el agentServiceFacturas
 * Admite:
 * 1) Archivo subido vía FormData (campo 'factura')
 * 2) JSON con `imagen` en base64 / data URI o `url`
 */
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
        error: 'Debe adjuntar un archivo de imagen en el campo "factura" o enviar "imagen" en el body.',
      });
    }

    const resultado = await analizarFactura(imagenInput, { mimeType });

    return res.json({
      success: true,
      data: resultado,
    });
  } catch (error) {
    console.error('Error al analizar factura:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error interno al procesar la factura.',
    });
  }
});

// Manejo de errores de multer y generales
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, error: `Error en la subida: ${err.message}` });
  } else if (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
});

module.exports = app;

