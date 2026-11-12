const sessions = new Map();

function getSession(sessionId) {
  const id = sessionId || 'default';
  if (!sessions.has(id)) {
    sessions.set(id, {
      createdAt: new Date().toISOString(),
      invoices: [],
      messages: [],
      lastResult: null,
    });
  }
  return sessions.get(id);
}

function rememberInvoice(sessionId, factura) {
  const session = getSession(sessionId);
  session.lastResult = factura;
  session.invoices.unshift({
    numero_factura: factura.numero_factura ?? null,
    total: factura.total ?? null,
    moneda: factura.moneda ?? null,
    emisor: factura.emisor?.nombre ?? null,
    fecha_emision: factura.fecha_emision ?? null,
  });
  session.invoices = session.invoices.slice(0, 10);
  return session;
}

function rememberChat(sessionId, role, content, meta = {}) {
  const session = getSession(sessionId);
  session.messages.push({
    role,
    content,
    ...meta,
    createdAt: new Date().toISOString(),
  });
  session.messages = session.messages.slice(-30);
  return session;
}

function getContext(sessionId) {
  const session = getSession(sessionId);
  return {
    invoices: session.invoices,
    messages: session.messages,
    lastResult: session.lastResult,
  };
}

module.exports = { getSession, rememberInvoice, rememberChat, getContext };
