import { useState } from 'react';
import './InvoiceAssistant.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const SESSION_KEY = 'sistemavision_session_id';

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(SESSION_KEY, id); }
  return id;
}

function money(value, currency = '') {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'N/A';
  return `${currency} ${n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

function InvoiceCard({ invoice, detail = false }) {
  return (
    <div className="ai-invoice-card">
      <div className="ai-invoice-top">
        <div><span className="ai-kicker">FACTURA</span><h4>{invoice.numero_factura || 'Sin número'}</h4><p>{invoice.fecha_emision || 'Fecha no disponible'}</p></div>
        <div className="ai-total"><span>Total</span><strong>{money(invoice.total, invoice.moneda)}</strong></div>
      </div>
      <div className="ai-meta-grid">
        <div><span>Emisor</span><strong>{invoice.emisor?.nombre || '—'}</strong></div>
        <div><span>Receptor</span><strong>{invoice.receptor?.nombre || '—'}</strong></div>
        <div><span>Subtotal</span><strong>{money(invoice.subtotal, invoice.moneda)}</strong></div>
        <div><span>Impuestos</span><strong>{money(invoice.impuestos, invoice.moneda)}</strong></div>
      </div>
      {detail && invoice.items?.length > 0 && (
        <div className="ai-items">
          <div className="ai-items-title">Productos y servicios</div>
          {invoice.items.map((item, index) => (
            <div className="ai-item" key={index}>
              <span>{item.descripcion || 'Sin descripción'}</span>
              <small>{item.cantidad} × {money(item.precio_unitario, invoice.moneda)}</small>
              <strong>{money(item.importe, invoice.moneda)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TableResult({ data }) {
  return <div className="ai-table-wrap"><table className="ai-table"><thead><tr><th>Factura</th><th>Fecha</th><th>Emisor</th><th>Subtotal</th><th>Total</th></tr></thead><tbody>{data.map((f) => <tr key={f.id}><td>{f.numero_factura || '—'}</td><td>{f.fecha_emision || '—'}</td><td>{f.emisor?.nombre || '—'}</td><td>{money(f.subtotal, f.moneda)}</td><td><strong>{money(f.total, f.moneda)}</strong></td></tr>)}</tbody></table></div>;
}

export default function InvoiceAssistant() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function sendMessage(text = input) {
    const message = String(text).trim();
    if (!message || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/agent/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, session_id: getSessionId() }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'No se pudo consultar al agente.');
      setMessages((prev) => [...prev, { role: 'assistant', ...json.data }]);
    } catch (error) {
      setMessages((prev) => [...prev, { role: 'assistant', type: 'error', title: 'No pude completar la consulta', message: error.message }]);
    } finally { setLoading(false); }
  }

  function renderMessage(message) {
    if (message.type === 'invoice') return <InvoiceCard invoice={message.data?.[0]} detail />;
    if (message.type === 'summary') return <InvoiceCard invoice={message.data?.[0]} />;
    if (message.type === 'table') return <TableResult data={message.data || []} />;
    if (message.type === 'json') return <pre className="ai-json">{JSON.stringify(message.data, null, 2)}</pre>;
    if (message.type === 'empty') return <div className="ai-empty">🔎 {message.message}</div>;
    if (message.type === 'error') return <div className="ai-error">⚠ {message.message}</div>;
    return <p className="ai-text">{message.message}</p>;
  }

  return (
    <section className="assistant-section">
      <div className="assistant-header">
        <div><p className="eyebrow">AI ASSISTANT</p><h2>Pregúntale a tus facturas</h2><p>Busca una factura y pide exactamente cómo quieres verla.</p></div>
        <span className="ai-online"><i /> IA activa</span>
      </div>
      <div className="assistant-shell">
        <div className="chat-history">
          {messages.length === 0 && <div className="chat-welcome"><div className="ai-orb">✦</div><strong>¿Qué quieres consultar?</strong><span>La IA busca en MySQL y prepara la respuesta en un formato visual.</span><div className="quick-actions"><button onClick={() => sendMessage('Dame la última factura en resumen')}>Última factura</button><button onClick={() => sendMessage('Muéstrame la factura FAC-2026-00125 en tabla')}>Ver en tabla</button><button onClick={() => sendMessage('Dame la factura FAC-2026-00125 en JSON')}>Ver JSON</button></div></div>}
          {messages.map((message, index) => <div key={index} className={`chat-message ${message.role}`}>{message.role === 'assistant' && <div className="assistant-avatar">✦</div>}<div className="bubble"><div className="bubble-title">{message.role === 'user' ? 'Tú' : message.title || 'SistemaVision'}</div>{message.role === 'assistant' ? renderMessage(message) : <p className="ai-text">{message.content}</p>}</div></div>)}
          {loading && <div className="chat-message assistant"><div className="assistant-avatar pulse-avatar">✦</div><div className="bubble typing"><span /><span /><span /><em>Buscando y preparando tu respuesta...</em></div></div>}
        </div>
        <form className="chat-input-row" onSubmit={(e) => { e.preventDefault(); sendMessage(); }}><input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Pídele algo al agente..." disabled={loading} /><button disabled={!input.trim() || loading}>{loading ? '...' : 'Enviar ↗'}</button></form>
      </div>
    </section>
  );
}
