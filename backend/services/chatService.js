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
  if (value.includes('resumen')) return 'resumen';
  return 'texto';
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
    const instruccionesFormato = {
      json: 'Entrega JSON válido y únicamente JSON, sin bloques markdown ni explicación adicional.',
      csv: 'Entrega CSV válido con encabezados y filas. No agregues explicación fuera del CSV.',
      tabla: 'Entrega una tabla Markdown clara y legible.',
      resumen: 'Entrega un resumen breve con los datos más importantes.',
      texto: 'Entrega una respuesta clara en texto, manteniendo los datos exactos.',
    };

    const secondInput = [
      ...input,
      ...(firstResponse.output || []),
      ...toolOutputs,
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'Ahora responde al usuario usando exclusivamente los datos obtenidos de las herramientas cuando se trate de facturas. ' + instruccionesFormato[formato],
          },
        ],
      },
    ];

    const finalResponse = await llamarOpenAI(secondInput, []);
    const answer = extraerTexto(finalResponse) || 'Encontré la información, pero no pude generar la respuesta.';
    rememberChat(sessionId, 'assistant', answer, { referencias: referencias.map((f) => f.id) });

    return {
      answer,
      referencias,
      formato,
    };
  }

  const answer = extraerTexto(firstResponse) || 'No pude generar una respuesta.';
  rememberChat(sessionId, 'assistant', answer);
  return { answer, referencias: [], formato: normalizarFormato(userMessage) };
}

module.exports = { conversarConAgente, buscarFacturas, facturaPublica };
