const sessions = new Map();

function getSession(sessionId) {
  const id = sessionId || 'default';
  if (!sessions.has(id)) {
    sessions.set(id, {
      createdAt: new Date().toISOString(),
      invoices: [],
      lastResult: null,
    });
  }
  return sessions.get(id);
}

function rememberInvoice(sessionId, factura) {
  const session = getSession(sessionId);
  session.lastResult = factura;
  session.invoices.push({
    numero_factura: factura.numero_factura ?? null,
    total: factura.total ?? null,
    emisor: factura.emisor?.nombre ?? null,
    fecha_emision: factura.fecha_emision ?? null,
  });
  if (session.invoices.length > 10) session.invoices.shift();
  return session;
}

function getContext(sessionId) {
  const session = getSession(sessionId);
  return {
    invoices: session.invoices,
    lastResult: session.lastResult,
  };
}

module.exports = { getSession, rememberInvoice, getContext };
