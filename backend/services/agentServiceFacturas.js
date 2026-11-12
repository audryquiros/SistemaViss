const fs = require('fs');
const path = require('path');
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
    '.gif': 'image/gif',
  };
  const detectedMime = mimeMap[ext] || mimeType;
  return `data:${detectedMime};base64,${fs.readFileSync(absPath).toString('base64')}`;
}

function normalizarFactura(data) {
  const factura = data?.factura || data;
  return {
    emisor: factura?.emisor || { nombre: null, nif_rfc: null, direccion: null },
    receptor: factura?.receptor || { nombre: null, nif_rfc: null },
    numero_factura: factura?.numero_factura ?? null,
    fecha_emision: factura?.fecha_emision ?? null,
    moneda: factura?.moneda ?? null,
    subtotal: factura?.subtotal ?? null,
    impuestos: factura?.impuestos ?? null,
    total: factura?.total ?? null,
    items: Array.isArray(factura?.items) ? factura.items : [],
    confianza: factura?.confianza ?? null,
    observaciones: factura?.observaciones ?? null,
  };
}

function necesitaReintento(factura) {
  const camposCriticos = [
    factura?.numero_factura,
    factura?.fecha_emision,
    factura?.total,
  ];
  return camposCriticos.filter((v) => v !== null && v !== undefined && String(v).trim() !== '').length < 2;
}

function construirHerramientas() {
  return [
    {
      type: 'function',
      name: 'guardar_factura',
      description: 'Guarda una factura ya extraída en la base de datos MySQL. Úsala cuando los datos de la factura sean suficientemente claros.',
      parameters: {
        type: 'object',
        properties: {
          factura: {
            type: 'object',
            properties: {
              emisor: { type: 'object' },
              receptor: { type: 'object' },
              numero_factura: { type: ['string', 'null'] },
              fecha_emision: { type: ['string', 'null'] },
              moneda: { type: ['string', 'null'] },
              subtotal: { type: ['number', 'string', 'null'] },
              impuestos: { type: ['number', 'string', 'null'] },
              total: { type: ['number', 'string', 'null'] },
              items: { type: 'array' },
            },
            required: ['numero_factura', 'fecha_emision', 'total', 'items'],
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
      'Analiza la imagen, extrae datos estructurados y decide cuándo usar la herramienta disponible. ' +
      'Si la imagen está borrosa o faltan datos críticos, no inventes información. ' +
      'Devuelve siempre un JSON de factura cuando termines.',
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: prompt },
        { type: 'input_text', text: `Contexto de memoria de la sesión: ${JSON.stringify(context)}` },
        { type: 'input_image', image_url: imageUrl, detail },
      ],
    }],
    tools: construirHerramientas(),
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
      if (content?.type === 'output_text' && content?.text) texts.push(content.text);
    }
  }
  return texts.join('\n');
}

function extraerToolCall(response) {
  return (response?.output || []).find(
    (item) => item?.type === 'function_call' && item?.name === 'guardar_factura'
  );
}

async function ejecutarHerramientaGuardarFactura(args) {
  const { Factura, FacturaItem } = require('../models');
  const payload = normalizarFactura(args.factura);

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
  });

  if (payload.items.length) {
    await FacturaItem.bulkCreate(payload.items.map((item) => ({
      facturaId: factura.id,
      descripcion: item.descripcion ?? item.concepto ?? null,
      cantidad: item.cantidad ?? null,
      precio_unitario: item.precio_unitario ?? null,
      importe: item.importe ?? null,
    })));
  }

  return {
    id: factura.id,
    numero_factura: factura.numero_factura,
    total: factura.total,
    message: 'Factura guardada correctamente en MySQL.',
  };
}

async function analizarFactura(imagenInput, opciones = {}) {
  const imageUrl = resolverUrlImagen(imagenInput, opciones.mimeType);
  const prompt =
    opciones.prompt ||
    'Extrae esta factura en JSON. Campos: emisor (nombre, nif_rfc, direccion), receptor (nombre, nif_rfc), ' +
    'numero_factura, fecha_emision, moneda, subtotal, impuestos, total e items ' +
    '(descripcion, cantidad, precio_unitario, importe). Si no es visible, usa null. No inventes datos.';

  const context = opciones.context || {};
  let detail = opciones.detail || 'low';
  let attempts = 0;
  let factura = null;
  let toolResult = null;
  const trace = [];

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
      if (!necesitaReintento(factura)) {
        toolResult = await ejecutarHerramientaGuardarFactura(args);
        trace.push({ step: attempts, action: 'tool_guardar_factura', result: toolResult });

        // Cerramos el ciclo de tool calling devolviendo el resultado de la herramienta al modelo.
        const followUp = await fetch(OPENAI_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: DEFAULT_MODEL,
            instructions: 'Confirma brevemente que la factura fue procesada. No inventes datos adicionales.',
            input: [
              ...(response.output || []),
              {
                type: 'function_call_output',
                call_id: toolCall.call_id,
                output: JSON.stringify(toolResult),
              },
            ],
          }),
        });

        if (!followUp.ok) {
          const body = await followUp.text();
          throw new Error(`Error al completar el ciclo del agente (${followUp.status}): ${body}`);
        }

        const confirmation = await followUp.json();
        return {
          ...factura,
          persistido: true,
          facturaId: toolResult.id,
          nivel_detalle: detail,
          agentTrace: trace,
          agentConfirmation: extraerTextoRespuesta(confirmation) || toolResult.message,
        };
      }
    } else {
      const text = extraerTextoRespuesta(response);
      try {
        factura = normalizarFactura(JSON.parse(text));
      } catch {
        throw new Error('El agente no devolvió un JSON de factura válido.');
      }

      if (!necesitaReintento(factura)) {
        return { ...factura, persistido: false, nivel_detalle: detail, agentTrace: trace };
      }
    }

    if (detail === 'low') {
      detail = 'high';
      trace.push({ step: attempts, action: 'retry_detail_high', reason: 'Faltan campos críticos o la imagen requiere mayor detalle.' });
    } else {
      break;
    }
  }

  if (!factura) throw new Error('No fue posible extraer la información de la factura.');

  return {
    ...factura,
    persistido: false,
    nivel_detalle: detail,
    agentTrace: trace,
    observaciones: factura.observaciones || 'La imagen no permitió recuperar suficientes campos críticos.',
  };
}

module.exports = { analizarFactura };
