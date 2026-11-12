const { Factura, FacturaItem } = require('../models');
const { rememberChat } = require('../memory/agentMemory');
require('dotenv').config();

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_VISION_MODEL || 'gpt-4o';

function normalizarFormato(formato = '') {
  const value = String(formato).toLowerCase();
  if (value.includes('json')) return 'json';
  if (value.includes('csv')) return 'csv';
  if (value.includes('tabla')) return 'tabla';
  if (value.includes('detalle') || value.includes('detall')) return 'detalle';
  if (value.includes('resumen')) return 'resumen';
  return 'texto';
}

function crearRespuestaVisual(facturas, formato) {
  if (!facturas.length) {
    return {
      type: 'empty',
      title: 'No encontré esa factura',
      message: 'No hay facturas guardadas que coincidan con tu solicitud.',
      data: [],
    };
  }

  const primera = facturas[0];

  if (formato === 'json') {
    return {
      type: 'json',
      title: facturas.length === 1 ? `Factura ${primera.numero_factura || ''}`.trim() : 'Facturas encontradas',
      message: `Encontré ${facturas.length} factura${facturas.length === 1 ? '' : 's'}.`,
      data: facturas,
    };
  }

  if (formato === 'tabla') {
    return {
      type: 'table',
      title: facturas.length === 1 ? `Factura ${primera.numero_factura || ''}`.trim() : 'Facturas encontradas',
      message: `Encontré ${facturas.length} factura${facturas.length === 1 ? '' : 's'} para tu búsqueda.`,
      data: facturas,
    };
  }

  if (formato === 'detalle') {
    return {
      type: 'invoice',
      title: `Factura ${primera.numero_factura || 'sin número'}`,
      message: 'Aquí tienes el detalle completo de la factura.',
      data: [primera],
    };
  }

  if (formato === 'resumen') {
    return {
      type: 'summary',
      title: `Factura ${primera.numero_factura || 'sin número'}`,
      message: `Encontré ${facturas.length} factura${facturas.length === 1 ? '' : 's'}. Te muestro un resumen de la más reciente.`,
      data: [primera],
    };
  }

  return {
    type: 'text',
    title: `Factura ${primera.numero_factura || 'sin número'}`,
    message: `Encontré ${facturas.length} factura${facturas.length === 1 ? '' : 's'}.`,
    data: facturas,
  };
}

function facturaPublica(factura) {
  const plain = factura.toJSON ? factura.toJSON() : factura;
  return {
    id: plain.id,
    numero_factura: plain.numero_factura,
    fecha_emision: plain.fecha_emision,
    moneda: plain.moneda,
    emisor: {
      nombre: plain.emisor_nombre,
      nif_rfc: plain.emisor_nif_rfc,
      direccion: plain.emisor_direccion,
    },
    receptor: {
      nombre: plain.receptor_nombre,
      nif_rfc: plain.receptor_nif_rfc,
    },
    subtotal: plain.subtotal,
    impuestos: plain.impuestos,
    total: plain.total,
    nivel_detalle: plain.nivel_detalle,
    items: (plain.items || []).map((item) => ({
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
      importe: item.importe,
    })),
  };
}

async function buscarFacturas({ numero_factura, emisor, limite = 5 } = {}) {
  const where = {};
  if (numero_factura) where.numero_factura = String(numero_factura).trim();
  if (emisor) {
    const { Op } = require('sequelize');
    where.emisor_nombre = { [Op.like]: `%${String(emisor).trim()}%` };
  }

  const facturas = await Factura.findAll({
    where,
    include: [{ model: FacturaItem, as: 'items' }],
    order: [['createdAt', 'DESC']],
    limit: Math.min(Math.max(Number(limite) || 5, 1), 10),
  });

  return facturas.map(facturaPublica);
}

function construirHerramientas() {
  return [
    {
      type: 'function',
      name: 'buscar_facturas',
      description:
        'Consulta facturas guardadas en MySQL. Usa numero_factura cuando el usuario mencione una factura concreta. ' +
        'Si solo indica un emisor, puedes buscar por emisor. Devuelve los datos necesarios para responder.',
      parameters: {
        type: 'object',
        properties: {
          numero_factura: { type: ['string', 'null'], description: 'Número exacto o parcial de la factura.' },
          emisor: { type: ['string', 'null'], description: 'Nombre del emisor si fue mencionado.' },
          limite: { type: ['integer', 'null'], description: 'Cantidad máxima de resultados.' },
        },
        required: ['numero_factura', 'emisor', 'limite'],
        additionalProperties: false,
      },
    },
  ];
}

async function llamarOpenAI(input, tools = construirHerramientas()) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Falta configurar OPENAI_API_KEY en el archivo .env');

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      instructions:
        'Eres el asistente de SistemaVision. Ayudas a consultar facturas almacenadas en MySQL. ' +
        'Nunca inventes datos. Si el usuario pide una factura concreta, usa buscar_facturas. ' +
        'Si pide un formato, respétalo. Puedes responder en JSON, CSV, tabla Markdown, resumen o texto. ' +
        'No expongas detalles internos de herramientas ni claves.',
      input,
      ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Error de OpenAI (${response.status}): ${body}`);
  }
  return response.json();
}

function extraerTexto(response) {
  if (response?.output_text) return response.output_text;
  return (response?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((content) => content?.type === 'output_text')
    .map((content) => content.text)
    .join('\n');
}

function extraerToolCalls(response) {
  return (response?.output || []).filter(
    (item) => item?.type === 'function_call' && item?.name === 'buscar_facturas'
  );
}

async function conversarConAgente(sessionId, message, context = {}) {
  const userMessage = String(message || '').trim();
  if (!userMessage) throw new Error('Escribe una pregunta o solicitud para el asistente.');

  rememberChat(sessionId, 'user', userMessage);

  const input = [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: userMessage },
        {
          type: 'input_text',
          text: `Memoria reciente de la sesión: ${JSON.stringify(context)}`,
        },
      ],
    },
  ];

  const firstResponse = await llamarOpenAI(input);
  const toolCalls = extraerToolCalls(firstResponse);
  let referencias = [];

  if (toolCalls.length) {
    const toolOutputs = [];
    for (const call of toolCalls) {
      let args;
      try {
        args = JSON.parse(call.arguments || '{}');
      } catch {
        args = {};
      }
      const facturas = await buscarFacturas(args);
      referencias = [...referencias, ...facturas];
      toolOutputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(facturas),
      });
    }

    const formato = normalizarFormato(userMessage);
    const vista = crearRespuestaVisual(referencias, formato);

    // El frontend recibe datos estructurados y decide cómo presentarlos.
    // Así evitamos Markdown crudo y mantenemos una respuesta consistente.
    rememberChat(sessionId, 'assistant', vista.message, {
      referencias: referencias.map((f) => f.id),
      responseType: vista.type,
    });

    return {
      answer: vista.message,
      type: vista.type,
      title: vista.title,
      message: vista.message,
      data: vista.data,
      referencias,
      formato,
    };
  }

  const answer = extraerTexto(firstResponse) || 'No pude generar una respuesta.';
  rememberChat(sessionId, 'assistant', answer);
  return {
    answer,
    type: 'text',
    title: 'Asistente',
    message: answer,
    data: [],
    referencias: [],
    formato: normalizarFormato(userMessage),
  };
}

module.exports = { conversarConAgente, buscarFacturas, facturaPublica };
