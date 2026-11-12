const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o';

function resolverUrlImagen(imagenInput, mimeType = 'image/jpeg') {
  if (Buffer.isBuffer(imagenInput)) {
    return `data:${mimeType};base64,${imagenInput.toString('base64')}`;
  }

  if (typeof imagenInput !== 'string' || !imagenInput.trim()) {
    throw new Error('Se requiere una imagen válida.');
  }

  const input = imagenInput.trim();
  if (input.startsWith('http://') || input.startsWith('https://') || input.startsWith('data:')) {
    return input;
  }

  const absPath = path.resolve(input);
  if (!fs.existsSync(absPath)) throw new Error('No se encontró la imagen indicada.');

  const ext = path.extname(absPath).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };

  const detectedMime = mimeMap[ext] || mimeType;
  return `data:${detectedMime};base64,${fs.readFileSync(absPath).toString('base64')}`;
}

function normalizarFactura(data) {
  const factura = data?.factura || data || {};

  return {
    emisor: {
      nombre: factura?.emisor?.nombre ?? null,
      nif_rfc: factura?.emisor?.nif_rfc ?? null,
      direccion: factura?.emisor?.direccion ?? null,
    },
    receptor: {
      nombre: factura?.receptor?.nombre ?? null,
      nif_rfc: factura?.receptor?.nif_rfc ?? null,
    },
    numero_factura: factura?.numero_factura ?? null,
    fecha_emision: factura?.fecha_emision ?? null,
    moneda: factura?.moneda ?? null,
    subtotal: numero(factura?.subtotal),
    impuestos: numero(factura?.impuestos),
    total: numero(factura?.total),
    items: Array.isArray(factura?.items)
      ? factura.items.map((item) => ({
          descripcion: item?.descripcion ?? item?.concepto ?? null,
          cantidad: numero(item?.cantidad),
          precio_unitario: numero(item?.precio_unitario),
          importe: numero(item?.importe),
        }))
      : [],
    confianza: factura?.confianza ?? null,
    observaciones: factura?.observaciones ?? null,
  };
}


function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(String(valor).replace(/[^0-9.,-]/g, '').replace(/,(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}


function construirFingerprint(factura) {
  const identidad = {
    numero_factura: factura.numero_factura ? String(factura.numero_factura).trim().toUpperCase() : null,
    emisor_nif_rfc: factura.emisor?.nif_rfc ? String(factura.emisor.nif_rfc).trim().toUpperCase() : null,
    emisor_nombre: factura.emisor?.nombre ? String(factura.emisor.nombre).trim().toUpperCase() : null,
    receptor_nif_rfc: factura.receptor?.nif_rfc ? String(factura.receptor.nif_rfc).trim().toUpperCase() : null,
    fecha_emision: factura.fecha_emision ? String(factura.fecha_emision).trim() : null,
    moneda: factura.moneda ? String(factura.moneda).trim().toUpperCase() : null,
    total: numero(factura.total),
    items: (factura.items || []).map((item) => ({
      descripcion: item.descripcion ? String(item.descripcion).trim().toUpperCase() : null,
      cantidad: numero(item.cantidad),
      precio_unitario: numero(item.precio_unitario),
      importe: numero(item.importe),
    })),
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(identidad))
    .digest('hex');
}

class FacturaDuplicadaError extends Error {
  constructor(facturaExistente) {
    super(`La factura ${facturaExistente.numero_factura || ''} ya fue procesada anteriormente.`.trim());
    this.name = 'FacturaDuplicadaError';
    this.statusCode = 409;
    this.facturaExistente = facturaExistente;
  }
}

function validarFactura(factura) {
  const errores = [];
  const tolerancia = 0.02;
  const items = Array.isArray(factura.items) ? factura.items : [];

  for (const [index, item] of items.entries()) {
    const cantidad = numero(item.cantidad);
    const precio = numero(item.precio_unitario);
    const importe = numero(item.importe);

    if (cantidad !== null && precio !== null && importe !== null) {
      const esperado = cantidad * precio;
      if (Math.abs(esperado - importe) > tolerancia) {
        errores.push(`Item ${index + 1}: cantidad × precio unitario no coincide con el importe.`);
      }
    }
  }

  const importes = items
    .map((item) => numero(item.importe))
    .filter((value) => value !== null);
  const subtotal = numero(factura.subtotal);
  const impuestos = numero(factura.impuestos);
  const total = numero(factura.total);

  if (importes.length === items.length && items.length > 0 && subtotal !== null) {
    const sumaItems = importes.reduce((sum, value) => sum + value, 0);
    if (Math.abs(sumaItems - subtotal) > tolerancia) {
      errores.push(`La suma de los items (${sumaItems}) no coincide con el subtotal (${subtotal}).`);
    }
  }

  if (subtotal !== null && impuestos !== null && total !== null) {
    const esperadoTotal = subtotal + impuestos;
    if (Math.abs(esperadoTotal - total) > tolerancia) {
      errores.push(`Subtotal + impuestos (${esperadoTotal}) no coincide con el total (${total}).`);
    }
  }

  return {
    valido: errores.length === 0,
    errores,
  };
}

function necesitaReintento(factura) {
  const camposCriticos = [
    factura?.numero_factura,
    factura?.fecha_emision,
    factura?.total,
  ];

  return camposCriticos.filter(
    (v) => v !== null && v !== undefined && String(v).trim() !== ''
  ).length < 2;
}

function construirHerramientas() {
  return [
    {
      type: 'function',
      name: 'guardar_factura',
      description:
        'Guarda en MySQL una factura que ya fue extraída de la imagen. ' +
        'Usa esta herramienta cuando los datos sean suficientemente claros. ' +
        'El mismo número de factura puede existir si sus datos cambiaron; el duplicado se determina por fingerprint completo.',
      parameters: {
        type: 'object',
        properties: {
          factura: {
            type: 'object',
            properties: {
              emisor: {
                type: 'object',
                properties: {
                  nombre: { type: ['string', 'null'] },
                  nif_rfc: { type: ['string', 'null'] },
                  direccion: { type: ['string', 'null'] },
                },
                required: ['nombre', 'nif_rfc', 'direccion'],
                additionalProperties: false,
              },
              receptor: {
                type: 'object',
                properties: {
                  nombre: { type: ['string', 'null'] },
                  nif_rfc: { type: ['string', 'null'] },
                },
                required: ['nombre', 'nif_rfc'],
                additionalProperties: false,
              },
              numero_factura: { type: ['string', 'null'] },
              fecha_emision: { type: ['string', 'null'] },
              moneda: { type: ['string', 'null'] },
              subtotal: { type: ['number', 'string', 'null'] },
              impuestos: { type: ['number', 'string', 'null'] },
              total: { type: ['number', 'string', 'null'] },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    descripcion: { type: ['string', 'null'] },
                    cantidad: { type: ['number', 'string', 'null'] },
                    precio_unitario: { type: ['number', 'string', 'null'] },
                    importe: { type: ['number', 'string', 'null'] },
                  },
                  required: ['descripcion', 'cantidad', 'precio_unitario', 'importe'],
                  additionalProperties: false,
                },
              },
            },
            required: [
              'emisor',
              'receptor',
              'numero_factura',
              'fecha_emision',
              'moneda',
              'subtotal',
              'impuestos',
              'total',
              'items',
            ],
            additionalProperties: false,
          },
        },
        required: ['factura'],
        additionalProperties: false,
      },
    },
  ];
}

async function llamarOpenAI({ imageUrl, detail, prompt, context }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Falta configurar OPENAI_API_KEY en el archivo .env');

  const body = {
    model: DEFAULT_MODEL,
    instructions:
      'Eres un agente especialista en lectura y extracción de facturas. ' +
      'Debes analizar la imagen, extraer datos estructurados y usar la herramienta guardar_factura ' +
      'cuando los datos sean suficientemente claros. Si la imagen está borrosa o faltan datos críticos, ' +
      'no inventes información. Si necesitas más detalle, el backend realizará un segundo intento. ' +
      'No inventes datos.',
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          {
            type: 'input_text',
            text: `Contexto de memoria de la sesión: ${JSON.stringify(context)}`,
          },
          { type: 'input_image', image_url: imageUrl, detail },
        ],
      },
    ],
    tools: construirHerramientas(),
    tool_choice: 'required',
  };

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Error de OpenAI (${response.status}): ${errorBody}`);
  }

  return response.json();
}

function extraerTextoRespuesta(response) {
  if (response?.output_text) return response.output_text;

  const texts = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && content?.text) {
        texts.push(content.text);
      }
    }
  }

  return texts.join('\n');
}

function extraerToolCall(response) {
  return (response?.output || []).find(
    (item) => item?.type === 'function_call' && item?.name === 'guardar_factura'
  );
}

function parsearJSON(texto) {
  if (!texto) return null;

  let limpio = String(texto).trim();

  // Permite respuestas tipo ```json ... ```.
  limpio = limpio.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  try {
    return JSON.parse(limpio);
  } catch {
    // Busca el primer objeto JSON válido dentro del texto.
    const inicio = limpio.indexOf('{');
    const final = limpio.lastIndexOf('}');

    if (inicio !== -1 && final > inicio) {
      try {
        return JSON.parse(limpio.slice(inicio, final + 1));
      } catch {
        return null;
      }
    }

    return null;
  }
}

async function encontrarFacturaDuplicada(Factura, FacturaItem, payload, fingerprint) {
  // Primera comprobación: fingerprint exacto para registros nuevos.
  const porFingerprint = await Factura.findOne({
    where: { fingerprint },
    include: [{ model: FacturaItem, as: 'items' }],
    attributes: ['id', 'numero_factura', 'fecha_emision', 'total', 'createdAt', 'fingerprint'],
  });

  if (porFingerprint) return porFingerprint;

  // Compatibilidad con facturas antiguas que fueron guardadas antes de
  // incorporar el campo fingerprint. Se compara el contenido completo,
  // no solamente el número de factura.
  if (payload.numero_factura) {
    const candidatas = await Factura.findAll({
      where: { numero_factura: payload.numero_factura },
      include: [{ model: FacturaItem, as: 'items' }],
      attributes: [
        'id', 'numero_factura', 'fecha_emision', 'moneda',
        'emisor_nombre', 'emisor_nif_rfc', 'emisor_direccion',
        'receptor_nombre', 'receptor_nif_rfc', 'subtotal', 'impuestos',
        'total', 'raw_json', 'createdAt', 'fingerprint',
      ],
      order: [['id', 'ASC']],
      limit: 25,
    });

    for (const candidata of candidatas) {
      if (candidata.fingerprint && candidata.fingerprint === fingerprint) return candidata;

      const datos = candidata.toJSON();
      const reconstruida = normalizarFactura({
        numero_factura: datos.numero_factura,
        fecha_emision: datos.fecha_emision,
        moneda: datos.moneda,
        emisor: {
          nombre: datos.emisor_nombre,
          nif_rfc: datos.emisor_nif_rfc,
          direccion: datos.emisor_direccion,
        },
        receptor: {
          nombre: datos.receptor_nombre,
          nif_rfc: datos.receptor_nif_rfc,
        },
        subtotal: datos.subtotal,
        impuestos: datos.impuestos,
        total: datos.total,
        items: datos.items || [],
      });

      if (construirFingerprint(reconstruida) === fingerprint) return candidata;
    }
  }

  return null;
}

async function ejecutarHerramientaGuardarFactura(args) {
  const { Factura, FacturaItem, sequelize } = require('../models');
  const payload = normalizarFactura(args.factura);
  const validacion = validarFactura(payload);

  if (!validacion.valido) {
    throw new Error(`La factura no se puede guardar porque falló la validación: ${validacion.errores.join(' ')}`);
  }

  const fingerprint = construirFingerprint(payload);

  const existente = await encontrarFacturaDuplicada(Factura, FacturaItem, payload, fingerprint);
  if (existente) {
    throw new FacturaDuplicadaError(existente.toJSON());
  }

  // Importante: el número de factura NO basta para marcar un duplicado.
  // Una factura con el mismo número pero con cambios reales en sus datos
  // genera otro fingerprint y puede almacenarse.

  const transaction = await sequelize.transaction();

  try {
    const factura = await Factura.create({
      numero_factura: payload.numero_factura,
      fecha_emision: payload.fecha_emision,
      moneda: payload.moneda,
      emisor_nombre: payload.emisor?.nombre,
      emisor_nif_rfc: payload.emisor?.nif_rfc,
      emisor_direccion: payload.emisor?.direccion,
      receptor_nombre: payload.receptor?.nombre,
      receptor_nif_rfc: payload.receptor?.nif_rfc,
      subtotal: payload.subtotal,
      impuestos: payload.impuestos,
      total: payload.total,
      raw_json: payload,
      nivel_detalle: args.nivel_detalle || null,
      fingerprint,
    }, { transaction });

    if (payload.items.length) {
      await FacturaItem.bulkCreate(
        payload.items.map((item) => ({
          facturaId: factura.id,
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario,
          importe: item.importe,
        })),
        { transaction }
      );
    }

    await transaction.commit();

    return {
      id: factura.id,
      numero_factura: factura.numero_factura,
      total: factura.total,
      message: 'Factura guardada correctamente en MySQL.',
    };
  } catch (error) {
    await transaction.rollback();

    if (error?.name === 'SequelizeUniqueConstraintError') {
      const duplicada = await encontrarFacturaDuplicada(Factura, FacturaItem, payload, fingerprint);
      if (duplicada) throw new FacturaDuplicadaError(duplicada.toJSON());
    }

    throw error;
  }
}

async function analizarFactura(imagenInput, opciones = {}) {
  const imageUrl = resolverUrlImagen(imagenInput, opciones.mimeType);
  const prompt =
    opciones.prompt ||
    'Extrae esta factura. Debes identificar: emisor (nombre, nif_rfc, direccion), ' +
    'receptor (nombre, nif_rfc), numero_factura, fecha_emision, moneda, subtotal, ' +
    'impuestos, total e items (descripcion, cantidad, precio_unitario, importe). ' +
    'Si un dato no es visible, usa null. No inventes datos.';

  const context = opciones.context || {};
  let detail = opciones.detail || 'low';
  let attempts = 0;
  let factura = null;
  let toolResult = null;
  const trace = [];
  let ultimaValidacion = null;

  while (attempts < 2) {
    attempts += 1;
    trace.push({ step: attempts, action: `vision_${detail}` });

    const response = await llamarOpenAI({ imageUrl, detail, prompt, context });
    const toolCall = extraerToolCall(response);

    if (toolCall) {
      let args;
      try {
        args = JSON.parse(toolCall.arguments);
      } catch {
        throw new Error('OpenAI devolvió argumentos inválidos para la herramienta guardar_factura.');
      }

      factura = normalizarFactura(args.factura);
      const validacion = validarFactura(factura);
      ultimaValidacion = validacion;
      trace.push({ step: attempts, action: 'validacion_factura', result: validacion });

      if (!necesitaReintento(factura) && validacion.valido) {
        toolResult = await ejecutarHerramientaGuardarFactura({ ...args, nivel_detalle: detail });
        trace.push({
          step: attempts,
          action: 'tool_guardar_factura',
          result: toolResult,
        });

        return {
          ...factura,
          persistido: true,
          facturaId: toolResult.id,
          nivel_detalle: detail,
          agentTrace: trace,
          agentConfirmation: toolResult.message,
        };
      }
    } else {
      // Fallback para modelos/configuraciones que devuelvan texto en vez del tool call.
      const parsed = parsearJSON(extraerTextoRespuesta(response));
      if (parsed) {
        factura = normalizarFactura(parsed);
        const validacion = validarFactura(factura);
        ultimaValidacion = validacion;
        trace.push({ step: attempts, action: 'validacion_factura', result: validacion });

        if (!necesitaReintento(factura) && validacion.valido) {
          toolResult = await ejecutarHerramientaGuardarFactura({ factura, nivel_detalle: detail });
          trace.push({
            step: attempts,
            action: 'fallback_guardar_factura',
            result: toolResult,
          });

          return {
            ...factura,
            persistido: true,
            facturaId: toolResult.id,
            nivel_detalle: detail,
            agentTrace: trace,
            agentConfirmation: toolResult.message,
          };
        }
      }
    }

    if (detail === 'low') {
      detail = 'high';
      trace.push({
        step: attempts,
        action: 'retry_detail_high',
        reason: ultimaValidacion?.valido === false
          ? `La validación detectó inconsistencias: ${ultimaValidacion.errores.join(' ')}`
          : 'Faltan campos críticos o la imagen requiere mayor detalle.',
      });
    } else {
      break;
    }
  }

  if (!factura) {
    throw new Error(
      'El agente no pudo extraer una factura estructurada. Verifica que la imagen sea legible y que contenga una factura.'
    );
  }

  return {
    ...factura,
    persistido: false,
    nivel_detalle: detail,
    agentTrace: trace,
    observaciones:
      factura.observaciones ||
      (ultimaValidacion?.errores?.length
        ? `La factura no se guardó porque la validación detectó inconsistencias: ${ultimaValidacion.errores.join(' ')}`
        : 'La imagen no permitió recuperar suficientes campos críticos.'),
    validacion: ultimaValidacion,
  };
}

module.exports = { analizarFactura, construirFingerprint, FacturaDuplicadaError };
