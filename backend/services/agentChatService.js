require('dotenv').config();
const { Factura, FacturaItem } = require('../models');
const { getSession, addChatMessage } = require('../memory/agentMemory');

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const MODEL = process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_VISION_MODEL || 'gpt-4o';

function money(value, currency = '') {
  if (value === null || value === undefined || value === '') return 'N/A';
  const n = Number(value);
  if (!Number.isFinite(n)) return `${currency} ${value}`.trim();
  return `${currency} ${n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

function buildSearchTool() {
  return {
    type: 'function',
    name: 'buscar_facturas',
    description: 'Busca facturas guardadas en MySQL. Úsala cuando el usuario pida una factura, varias facturas, la última factura, un resumen, tabla o JSON.',
    parameters: {
      type: 'object',
      properties: {
        numero_factura: { type: ['string', 'null'], description: 'Número exacto o parcial de factura.' },
        emisor: { type: ['string', 'null'], description: 'Nombre del emisor, si se conoce.' },
        limite: { type: ['number', 'null'], description: 'Cantidad máxima de resultados. Máximo 10.' },
        formato: { type: 'string', enum: ['summary', 'table', 'json', 'detail'], description: 'Formato solicitado por el usuario.' },
      },
      required: ['numero_factura', 'emisor', 'limite', 'formato'],
      additionalProperties: false,
    },
  };
}

async function callOpenAI(input, tools, toolChoice = 'auto') {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Falta configurar OPENAI_API_KEY en el archivo .env');

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      instructions:
        'Eres el asistente de facturas de SistemaVision. Interpreta la solicitud del usuario. ' +
        'Si necesita datos de facturas usa buscar_facturas. Elige el formato solicitado. ' +
        'No inventes facturas ni datos. Sé breve y natural. No uses Markdown para la respuesta final porque el frontend la presenta visualmente.',
      input,
      tools,
      tool_choice: toolChoice,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Error de OpenAI (${response.status}): ${body}`);
  }
  return response.json();
}

function getToolCall(response) {
  return (response?.output || []).find((item) => item?.type === 'function_call' && item?.name === 'buscar_facturas');
}

function getText(response) {
  if (response?.output_text) return response.output_text.trim();
  return (response?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((content) => content?.type === 'output_text')
    .map((content) => content.text)
    .join('\n')
    .trim();
}

async function buscarFacturas(args = {}) {
  const where = {};
  if (args.numero_factura) where.numero_factura = { [require('sequelize').Op.like]: `%${args.numero_factura}%` };
  if (args.emisor) where.emisor_nombre = { [require('sequelize').Op.like]: `%${args.emisor}%` };

  const facturas = await Factura.findAll({
    where,
    include: [{ model: FacturaItem, as: 'items' }],
    order: [['createdAt', 'DESC']],
    limit: Math.min(Math.max(Number(args.limite) || 5, 1), 10),
  });

  return facturas.map((factura) => factura.toJSON());
}

function prepararFactura(f) {
  return {
    id: f.id,
    numero_factura: f.numero_factura,
    fecha_emision: f.fecha_emision,
    moneda: f.moneda,
    emisor: { nombre: f.emisor_nombre, nif_rfc: f.emisor_nif_rfc, direccion: f.emisor_direccion },
    receptor: { nombre: f.receptor_nombre, nif_rfc: f.receptor_nif_rfc },
    subtotal: Number(f.subtotal),
    impuestos: Number(f.impuestos),
    total: Number(f.total),
    items: (f.items || []).map((item) => ({
      descripcion: item.descripcion,
      cantidad: Number(item.cantidad),
      precio_unitario: Number(item.precio_unitario),
      importe: Number(item.importe),
    })),
    createdAt: f.createdAt,
  };
}

function crearVista(facturas, formato, solicitud) {
  const data = facturas.map(prepararFactura);
  const primera = data[0];

  if (!data.length) {
    return {
      type: 'empty',
      title: 'No encontré esa factura',
      message: 'No hay facturas guardadas que coincidan con tu solicitud.',
      data: [],
    };
  }

  if (formato === 'json') {
    return { type: 'json', title: data.length === 1 ? `Factura ${data[0].numero_factura || ''}`.trim() : 'Facturas encontradas', message: `Encontré ${data.length} factura${data.length === 1 ? '' : 's'}.`, data };
  }

  if (formato === 'table') {
    return {
      type: 'table',
      title: data.length === 1 ? `Factura ${data[0].numero_factura || ''}`.trim() : 'Facturas encontradas',
      message: `Encontré ${data.length} factura${data.length === 1 ? '' : 's'} para tu búsqueda.`,
      data,
    };
  }

  if (formato === 'detail') {
    return { type: 'invoice', title: `Factura ${primera.numero_factura || 'sin número'}`, message: 'Aquí tienes el detalle completo de la factura.', data: [primera] };
  }

  return {
    type: 'summary',
    title: `Factura ${primera.numero_factura || 'sin número'}`,
    message: `Encontré ${data.length} factura${data.length === 1 ? '' : 's'}. Te muestro un resumen de la más reciente.`,
    data: [primera],
  };
}

async function responderChat(sessionId, message) {
  const session = getSession(sessionId);
  const history = session.chatMessages.slice(-8);
  addChatMessage(sessionId, { role: 'user', content: message });

  const input = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  const response = await callOpenAI(input, [buildSearchTool()], 'auto');
  const toolCall = getToolCall(response);

  if (!toolCall) {
    const text = getText(response) || 'Puedo ayudarte a buscar y consultar las facturas guardadas.';
    addChatMessage(sessionId, { role: 'assistant', content: text });
    return { type: 'text', title: 'Asistente', message: text, data: [], memory: getSession(sessionId).chatMessages.slice(-8) };
  }

  let args;
  try { args = JSON.parse(toolCall.arguments || '{}'); } catch { throw new Error('El agente devolvió una búsqueda inválida.'); }
  const facturas = await buscarFacturas(args);
  const vista = crearVista(facturas, args.formato || 'summary', message);

  // La respuesta visual se construye con datos reales; no dependemos de Markdown generado por el modelo.
  addChatMessage(sessionId, { role: 'assistant', content: vista.message, metadata: { type: vista.type, data: vista.data } });

  return { ...vista, memory: getSession(sessionId).chatMessages.slice(-8) };
}

module.exports = { responderChat };
