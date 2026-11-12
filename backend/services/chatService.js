require('dotenv').config();
const { Op } = require('sequelize');
const { Factura, FacturaItem } = require('../models');
const { getSession, rememberChat, getContext } = require('../memory/agentMemory');

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const MODEL = process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_VISION_MODEL || 'gpt-4o';

function normalizarFormato(texto='') {
  const v = String(texto).toLowerCase();
  if (/\bpdf\b/.test(v)) return 'pdf';
  if (/excel|xlsx|xls/.test(v)) return 'excel';
  if (/\bcsv\b/.test(v)) return 'csv';
  if (/\bjson\b/.test(v)) return 'json';
  if (/\bxml\b/.test(v)) return 'xml';
  if (/html/.test(v)) return 'html';
  if (/txt|texto/.test(v)) return 'txt';
  if (/tabla|tabular|listado/.test(v)) return 'tabla';
  if (/detalle|detallada|completa/.test(v)) return 'detalle';
  return 'resumen';
}

function esDescarga(texto='') {
  const v=String(texto).toLowerCase();
  return /(descarg|export|genera|generar|crea|crear|archivo|documento|pásame|pasame|dame)/i.test(v)
    && /(pdf|excel|xlsx|xls|csv|json|xml|html|txt)/i.test(v);
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDate(d) { return d.toISOString().slice(0,10); }

function rangoPeriodo(periodo='') {
  const p=String(periodo).toLowerCase();
  const hoy=new Date();
  const fin=new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  if (/hoy/.test(p)) return { desde: isoDate(fin), hasta: isoDate(fin) };
  if (/semana/.test(p)) {
    const desde=new Date(fin); desde.setDate(fin.getDate()-6);
    return { desde: isoDate(desde), hasta: isoDate(fin) };
  }
  if (/último\s*mes|ultimo\s*mes/.test(p)) {
    const desde=new Date(fin); desde.setDate(fin.getDate()-29);
    return { desde: isoDate(desde), hasta: isoDate(fin) };
  }
  if (/mes\s*pasado|mes\s*anterior/.test(p)) {
    const desde=new Date(fin.getFullYear(), fin.getMonth()-1, 1);
    const hasta=new Date(fin.getFullYear(), fin.getMonth(), 0);
    return { desde: isoDate(desde), hasta: isoDate(hasta) };
  }
  if (/este\s*mes/.test(p)) {
    const desde=new Date(fin.getFullYear(), fin.getMonth(), 1);
    return { desde: isoDate(desde), hasta: isoDate(fin) };
  }
  return null;
}

function facturaPublica(factura) {
  const f=factura.toJSON ? factura.toJSON() : factura;
  return {
    id:f.id, numero_factura:f.numero_factura, fecha_emision:f.fecha_emision, moneda:f.moneda,
    emisor:{nombre:f.emisor_nombre,nif_rfc:f.emisor_nif_rfc,direccion:f.emisor_direccion},
    receptor:{nombre:f.receptor_nombre,nif_rfc:f.receptor_nif_rfc}, subtotal:Number(f.subtotal||0),
    impuestos:Number(f.impuestos||0), total:Number(f.total||0), createdAt:f.createdAt,
    items:(f.items||[]).map(i=>({descripcion:i.descripcion,cantidad:Number(i.cantidad||0),precio_unitario:Number(i.precio_unitario||0),importe:Number(i.importe||0)}))
  };
}

async function buscarFacturas(args={}) {
  const where={};
  if(args.numero_factura) where.numero_factura={ [Op.like]: `%${String(args.numero_factura).trim()}%` };
  if(args.emisor) where.emisor_nombre={ [Op.like]: `%${String(args.emisor).trim()}%` };
  if(args.receptor) where.receptor_nombre={ [Op.like]: `%${String(args.receptor).trim()}%` };
  if(args.fecha_desde || args.fecha_hasta){
    where.fecha_emision={};
    if(args.fecha_desde) where.fecha_emision[Op.gte]=String(args.fecha_desde);
    if(args.fecha_hasta) where.fecha_emision[Op.lte]=String(args.fecha_hasta);
  }
  const facturas=await Factura.findAll({where,include:[{model:FacturaItem,as:'items'}],order:[['createdAt','DESC']],limit:Math.min(Math.max(Number(args.limite)||5,1),20)});
  return facturas.map(facturaPublica);
}

async function resumenFacturacion(args={}) {
  const where={};
  const rango=rangoPeriodo(args.periodo||'');
  const desde=args.fecha_desde||rango?.desde;
  const hasta=args.fecha_hasta||rango?.hasta;
  if(args.emisor) where.emisor_nombre={ [Op.like]: `%${String(args.emisor).trim()}%` };
  if(desde||hasta){
    where.fecha_emision={};
    if(desde) where.fecha_emision[Op.gte]=String(desde);
    if(hasta) where.fecha_emision[Op.lte]=String(hasta);
  }
  const facturas=await Factura.findAll({where,attributes:['id','numero_factura','fecha_emision','moneda','subtotal','impuestos','total','emisor_nombre','receptor_nombre'],order:[['fecha_emision','DESC']]});
  const totals={};
  for(const f of facturas){
    const moneda=f.moneda||'CRC';
    if(!totals[moneda]) totals[moneda]={cantidad:0,subtotal:0,impuestos:0,total:0};
    totals[moneda].cantidad++;
    totals[moneda].subtotal+=Number(f.subtotal||0);
    totals[moneda].impuestos+=Number(f.impuestos||0);
    totals[moneda].total+=Number(f.total||0);
  }
  return {periodo:{desde:desde||null,hasta:hasta||null},cantidad:facturas.length,totales:totals,facturas:facturas.map(f=>facturaPublica(f))};
}

function tools(){
  return [
    {type:'function',name:'buscar_facturas',description:'Busca facturas guardadas. Sirve para una factura concreta, varias facturas, por emisor, receptor o fechas. Interpreta números parciales.',parameters:{type:'object',properties:{numero_factura:{type:['string','null']},emisor:{type:['string','null']},receptor:{type:['string','null']},fecha_desde:{type:['string','null'],description:'YYYY-MM-DD'},fecha_hasta:{type:['string','null'],description:'YYYY-MM-DD'},limite:{type:['integer','null']}},required:['numero_factura','emisor','receptor','fecha_desde','fecha_hasta','limite'],additionalProperties:false}},
    {type:'function',name:'resumen_facturacion',description:'Calcula cantidad, subtotal, impuestos y total de facturas. Úsala para preguntas como cuánto hemos gastado, cuánto facturamos, cuánto pagamos de impuestos, totales del último mes, este mes o una fecha.',parameters:{type:'object',properties:{periodo:{type:['string','null'],description:'hoy, esta semana, este mes, ultimo mes, mes pasado o rango'},fecha_desde:{type:['string','null'],description:'YYYY-MM-DD'},fecha_hasta:{type:['string','null'],description:'YYYY-MM-DD'},emisor:{type:['string','null']}},required:['periodo','fecha_desde','fecha_hasta','emisor'],additionalProperties:false}},
  ];
}

async function llamarOpenAI(input){
  const key=process.env.OPENAI_API_KEY;
  if(!key) throw new Error('Falta configurar OPENAI_API_KEY en backend/.env');
  const r=await fetch(OPENAI_API_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({model:MODEL,instructions:`Eres un agente experto en facturación. Entiende español natural, preguntas incompletas, referencias como "esa", "la anterior", "la última", números parciales y solicitudes de exportación. Decide qué herramienta usar según la intención. Para preguntas de totales, gastos, impuestos o cantidad usa resumen_facturacion. Para buscar facturas usa buscar_facturas. Nunca inventes datos. No describas herramientas internas. Si el usuario pide descargar/exportar, identifica el formato y la factura, pero la aplicación generará el archivo real.`,input,tools:tools(),tool_choice:'auto'})});
  if(!r.ok) throw new Error(`Error de OpenAI (${r.status}): ${await r.text()}`);
  return r.json();
}

function toolCalls(response){return (response?.output||[]).filter(x=>x?.type==='function_call');}
function texto(response){if(response?.output_text)return response.output_text.trim();return (response?.output||[]).flatMap(x=>x?.content||[]).filter(c=>c?.type==='output_text').map(c=>c.text).join('\n').trim();}

function extraerNumero(texto){
  const m=String(texto).match(/FAC\s*[- ]?\s*(\d{4})\s*[- ]?\s*(\d{3,})/i);
  if(m) return `FAC-${m[1]}-${m[2]}`;
  const n=String(texto).match(/(?:factura|fact|n(?:ú|u)mero|#)\s*(\d{3,})/i);
  return n ? n[1] : null;
}

function formatoSolicitado(texto){return normalizarFormato(texto);}

function vistaBusqueda(facturas, formato, solicitud){
  if(!facturas.length)return {type:'empty',title:'No encontré facturas',message:'No encontré facturas que coincidan con lo que pediste.',data:[]};
  const primera=facturas[0];
  if(esDescarga(solicitud) && ['pdf','excel','csv','json','xml','html','txt'].includes(formato)){
    if(facturas.length!==1)return {type:'table',title:'Necesito una factura concreta',message:`Encontré ${facturas.length} facturas. Indícame cuál quieres descargar.`,data:facturas};
    const label={pdf:'PDF',excel:'Excel',csv:'CSV',json:'JSON',xml:'XML',html:'HTML',txt:'TXT'}[formato];
    return {type:'download',title:`Factura ${primera.numero_factura}`,message:`Preparé ${primera.numero_factura} en ${label}. El archivo contiene los datos guardados de la factura.`,data:[primera],download:{id:primera.id,format:formato,label:`Descargar ${label}`,url:`/api/facturas/${primera.id}/export/${formato}`,filename:`factura-${primera.numero_factura}.${formato==='excel'?'xlsx':formato}`}};
  }
  if(formato==='json')return {type:'json',title:'Datos de la factura',message:`Encontré ${facturas.length} factura${facturas.length===1?'':'s'}.`,data:facturas};
  if(formato==='tabla')return {type:'table',title:'Facturas encontradas',message:`Encontré ${facturas.length} factura${facturas.length===1?'':'s'}.`,data:facturas};
  if(formato==='detalle')return {type:'invoice',title:`Factura ${primera.numero_factura}`,message:'Aquí tienes todos los datos y líneas de la factura.',data:[primera]};
  return {type:'summary',title:`Factura ${primera.numero_factura}`,message:`Encontré ${facturas.length} factura${facturas.length===1?'':'s'}. Te muestro la más reciente.`,data:[primera]};
}

function vistaResumen(resumen, solicitud){
  if(!resumen.cantidad)return {type:'summary_stats',title:'Sin facturas',message:'No encontré facturas dentro del periodo solicitado.',data:resumen};
  const partes=Object.entries(resumen.totales).map(([moneda,t])=>`${t.cantidad} factura${t.cantidad===1?'':'s'} · total ${moneda} ${t.total.toLocaleString('es-CR',{minimumFractionDigits:2,maximumFractionDigits:2})} · impuestos ${moneda} ${t.impuestos.toLocaleString('es-CR',{minimumFractionDigits:2,maximumFractionDigits:2})}`);
  return {type:'summary_stats',title:'Resumen de facturación',message:`${partes.join(' | ')}.`,data:resumen};
}

async function conversarConAgente(sessionId,message,context={}){
  const user=String(message||'').trim(); if(!user)throw new Error('Escribe una pregunta o solicitud.');
  const session=getSession(sessionId); rememberChat(sessionId,'user',user);
  const history=session.messages.slice(-10).map(m=>({role:m.role,content:m.content}));
  const input=[...history,{role:'user',content:user},{role:'user',content:`Contexto de sesión reciente: ${JSON.stringify(context)}`}];
  const response=await llamarOpenAI(input);
  const calls=toolCalls(response);
  let vista=null;
  for(const call of calls){
    let args={}; try{args=JSON.parse(call.arguments||'{}')}catch{}
    if(call.name==='buscar_facturas'){
      let numero=args.numero_factura;
      if(!numero) numero=extraerNumero(user);
      if(numero && /^\d+$/.test(String(numero))) numero=numero;
      const facturas=await buscarFacturas({...args,numero_factura:numero});
      vista=vistaBusqueda(facturas,formatoSolicitado(user),user);
    } else if(call.name==='resumen_facturacion'){
      vista=vistaResumen(await resumenFacturacion(args),user);
    }
  }
  // Fallback determinista para frases comunes si el modelo no llamó una herramienta.
  const u=user.toLowerCase();
  if(!vista && /(cu[aá]nto|total|gast|factur|impuesto|iva|sum(a|ar)|cu[aá]ntas)/.test(u)){
    if(/cu[aá]ntas|cantidad/.test(u) || /gast|factur|impuesto|iva|total/.test(u)) vista=vistaResumen(await resumenFacturacion({periodo:/último|ultimo|pasado|anterior/.test(u)?'ultimo mes':/este mes/.test(u)?'este mes':''}),user);
  }
  if(!vista && esDescarga(user)){
    const numero=extraerNumero(user);
    const found=await buscarFacturas({numero_factura:numero,limite:5});
    vista=vistaBusqueda(found,formatoSolicitado(user),user);
  }
  if(!vista){
    const answer=texto(response)||'Puedo ayudarte a buscar facturas, consultar totales, revisar detalles y preparar archivos. ¿Qué necesitas?';
    rememberChat(sessionId,'assistant',answer); return {answer,type:'text',title:'Asistente',message:answer,data:[],referencias:[],memory:getContext(sessionId)};
  }
  rememberChat(sessionId,'assistant',vista.message,{metadata:{type:vista.type}});
  return {...vista,answer:vista.message,referencias:vista.data||[],memory:getContext(sessionId)};
}

module.exports={conversarConAgente,buscarFacturas,facturaPublica,resumenFacturacion};
