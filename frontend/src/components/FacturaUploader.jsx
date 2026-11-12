import { useRef, useState } from 'react';
import './FacturaUploader.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const SESSION_KEY = 'sistemavision_session_id';

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function money(value, currency = '') {
  if (value === null || value === undefined || value === '') return 'N/A';
  const number = Number(value);
  if (!Number.isFinite(number)) return `${currency} ${value}`.trim();
  return `${currency} ${number.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

function prettyStep(action) {
  const labels = {
    vision_low: 'Lectura visual · detalle bajo',
    vision_high: 'Lectura visual · detalle alto',
    validacion_factura: 'Validación matemática',
    tool_guardar_factura: 'Herramienta · guardar en MySQL',
    fallback_guardar_factura: 'Guardado de respaldo',
  };
  return labels[action] || action.replaceAll('_', ' ');
}

export default function FacturaUploader() {
  const [archivo, setArchivo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [historial, setHistorial] = useState([]);
  const [mensajes, setMensajes] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatCargando, setChatCargando] = useState(false);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  const mostrarToast = (type, title, message) => {
    setToast({ type, title, message });
    window.setTimeout(() => setToast(null), 4200);
  };

  const manejarArchivo = (file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Selecciona una factura JPG, PNG o WEBP.');
      mostrarToast('error', 'Formato no válido', 'Solo aceptamos JPG, PNG y WEBP.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('La imagen no puede superar los 15 MB.');
      mostrarToast('error', 'Archivo demasiado grande', 'La factura debe pesar menos de 15 MB.');
      return;
    }
    setError(null);
    setResultado(null);
    setArchivo(file);
    const reader = new FileReader();
    reader.onloadend = () => setPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const enviarFactura = async () => {
    if (!archivo) {
      setError('Selecciona una factura antes de procesar.');
      return;
    }
    setCargando(true);
    setError(null);
    const formData = new FormData();
    formData.append('factura', archivo);
    formData.append('session_id', getSessionId());
    formData.append('detail', 'low');

    try {
      const response = await fetch(`${API_URL}/api/facturas/analizar`, { method: 'POST', body: formData });
      const data = await response.json();
      if (response.status === 409 || data.duplicate) {
        const existente = data.facturaExistente;
        const when = existente?.createdAt ? ` Procesada el ${new Date(existente.createdAt).toLocaleString('es-CR')}.` : '';
        setError(`${data.error || 'Esta factura ya fue procesada.'}${when}`);
        mostrarToast('duplicate', 'Factura ya registrada', 'El sistema detectó una copia idéntica. Si cambias un dato real, podrás registrarla.');
        return;
      }
      if (!response.ok || !data.success) throw new Error(data.error || `Error del servidor (${response.status})`);
      setResultado(data.data);
      setHistorial(data.memory?.invoices || []);
      mostrarToast('success', 'Factura guardada', `${data.data.numero_factura || 'La factura'} fue validada y almacenada en MySQL.`);
    } catch (err) {
      setError(err.message || 'No se pudo comunicar con el backend.');
      mostrarToast('error', 'No se pudo completar', err.message || 'Ocurrió un problema al procesar la factura.');
    } finally {
      setCargando(false);
    }
  };

  const limpiar = () => {
    setArchivo(null); setPreview(null); setResultado(null); setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const enviarChat = async (event) => {
    event?.preventDefault();
    const message = chatInput.trim();
    if (!message || chatCargando) return;
    setChatCargando(true);
    setMensajes((prev) => [...prev, { role: 'user', content: message }]);
    setChatInput('');
    try {
      const response = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: getSessionId(), message }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'No se pudo consultar al agente.');
      setMensajes((prev) => [...prev, { role: 'assistant', content: data.data.answer, referencias: data.data.referencias || [] }]);
      setHistorial(data.memory?.invoices || historial);
    } catch (err) {
      setMensajes((prev) => [...prev, { role: 'assistant', content: `No pude completar la consulta: ${err.message}` }]);
      mostrarToast('error', 'Consulta no completada', err.message);
    } finally {
      setChatCargando(false);
    }
  };

  const validacionOk = resultado?.validacion?.valido !== false;
  const trace = resultado?.agentTrace || [];

  return (
    <div className="factura-container">
      {toast && <div className={`toast toast-${toast.type}`}><span className="toast-icon">{toast.type === 'success' ? '✓' : toast.type === 'duplicate' ? '!' : '×'}</span><div><strong>{toast.title}</strong><p>{toast.message}</p></div></div>}

      <header className="factura-header">
        <div className="brand-lockup">
          <div className="brand-mark"><span>SV</span><i /></div>
          <div>
            <p className="eyebrow">SISTEMAVISION · AI INVOICE AGENT</p>
            <h1>Tu facturación, <span>con inteligencia.</span></h1>
            <p className="hero-copy">Lee facturas, valida números, guarda datos en MySQL y conversa con tu agente para recuperar la información cuando la necesites.</p>
          </div>
        </div>
        <div className="agent-pill"><span className="live-dot" /> Agente en línea</div>
      </header>

      <div className="feature-row">
        <div><span>01</span><strong>Visión</strong><small>Extracción inteligente</small></div>
        <div><span>02</span><strong>Validación</strong><small>Consistencia matemática</small></div>
        <div><span>03</span><strong>Memoria</strong><small>Contexto de sesión</small></div>
        <div><span>04</span><strong>Chat</strong><small>Consulta tus facturas</small></div>
      </div>

      <section className="workspace glass-card">
        <div className="section-top"><div><p className="eyebrow">NUEVA FACTURA</p><h2>Sube una imagen para comenzar</h2></div><span className="secure-chip">● MySQL + IA</span></div>
        <div className={`dropzone ${arrastrando ? 'drag-active' : ''} ${preview ? 'has-preview' : ''}`} onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }} onDragLeave={() => setArrastrando(false)} onDrop={(e) => { e.preventDefault(); setArrastrando(false); manejarArchivo(e.dataTransfer.files?.[0]); }} onClick={() => !cargando && fileInputRef.current?.click()}>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => manejarArchivo(e.target.files?.[0])} hidden />
          {preview ? <div className="preview-box"><img src={preview} alt="Vista previa de la factura" className="preview-img" /><span>Haz clic o arrastra para reemplazar</span></div> : <div className="dropzone-placeholder"><div className="upload-icon"><span>↥</span></div><strong>Arrastra tu factura aquí</strong><span>o haz clic para seleccionar una imagen</span><small>JPG · PNG · WEBP · máximo 15 MB</small></div>}
        </div>
        {archivo && <div className="archivo-info"><div className="file-meta"><div className="file-icon">▧</div><div><strong>{archivo.name}</strong><span>{(archivo.size / 1024).toFixed(1)} KB · {archivo.type.split('/')[1].toUpperCase()}</span></div></div><button type="button" onClick={limpiar} disabled={cargando}>Quitar</button></div>}
        <button type="button" onClick={enviarFactura} disabled={!archivo || cargando} className="btn-procesar">{cargando ? <><span className="spinner" /> El agente está analizando...</> : <>Analizar factura <span>→</span></>}</button>
        {cargando && <div className="agent-status"><span className="pulse" /><div><strong>Agente trabajando</strong><span>Visión · extracción · validación · persistencia</span></div><div className="loading-bars"><i /><i /><i /></div></div>}
        {error && <div className="alert-error"><div className="alert-symbol">!</div><div><strong>{error.includes('ya fue procesada') ? 'Factura duplicada' : 'Ocurrió un problema'}</strong><span>{error}</span></div></div>}
      </section>

      {resultado && <section className="resultado-section glass-card reveal">
        <div className="result-heading"><div><p className="eyebrow">RESULTADO DEL AGENTE</p><h2>Factura procesada</h2><p className="result-subtitle">Los datos fueron extraídos, validados y enviados al almacenamiento.</p></div><span className={`status ${resultado.persistido ? 'success' : 'warning'}`}>{resultado.persistido ? '✓ Guardada en MySQL' : '⚠ Revisión necesaria'}</span></div>
        <div className="summary-strip"><div><span>Estado</span><strong>{resultado.persistido ? 'Persistida' : 'No persistida'}</strong></div><div><span>Visión</span><strong>{resultado.nivel_detalle || 'N/A'}</strong></div><div><span>Pasos</span><strong>{trace.length}</strong></div><div><span>Factura</span><strong>{resultado.numero_factura || 'Sin número'}</strong></div></div>
        <div className="resumen-grid"><div className="card-dato"><span>Emisor</span><strong>{resultado.emisor?.nombre || 'No detectado'}</strong><small>{resultado.emisor?.nif_rfc || 'Sin identificación'}</small></div><div className="card-dato"><span>Receptor</span><strong>{resultado.receptor?.nombre || 'No detectado'}</strong><small>{resultado.fecha_emision || 'Fecha no detectada'}</small></div><div className="card-dato total-card"><span>Total</span><strong>{money(resultado.total, resultado.moneda)}</strong><small>Impuestos: {money(resultado.impuestos, resultado.moneda)}</small></div><div className="card-dato"><span>Subtotal</span><strong>{money(resultado.subtotal, resultado.moneda)}</strong><small>{resultado.moneda || 'Moneda no detectada'}</small></div></div>
        <div className={`validation-box ${validacionOk ? 'valid' : 'invalid'}`}><div className="validation-icon">{validacionOk ? '✓' : '!'}</div><div><strong>{validacionOk ? 'Validación numérica correcta' : 'La factura requiere revisión'}</strong><p>{validacionOk ? 'Los importes de los productos, subtotal, impuestos y total son consistentes.' : (resultado.observaciones || 'Se detectaron inconsistencias en los cálculos extraídos.')}</p></div></div>
        {Array.isArray(resultado.items) && resultado.items.length > 0 && <div className="tabla-items-container"><div className="section-title"><div><p className="eyebrow">DETALLE</p><h3>Productos y servicios</h3></div><span>{resultado.items.length} líneas</span></div><div className="table-wrap"><table className="items-table"><thead><tr><th>Descripción</th><th>Cantidad</th><th>Precio unitario</th><th>Importe</th></tr></thead><tbody>{resultado.items.map((item, index) => <tr key={index}><td>{item.descripcion || '-'}</td><td>{item.cantidad ?? '-'}</td><td>{money(item.precio_unitario, resultado.moneda)}</td><td>{money(item.importe, resultado.moneda)}</td></tr>)}</tbody></table></div></div>}
        <div className="agent-trace"><div className="section-title"><div><p className="eyebrow">AGENTE</p><h3>Recorrido operativo</h3></div><span>{trace.length} pasos</span></div><div className="trace-list">{trace.map((step, index) => <div className="trace-row" key={index}><span className="trace-number">{index + 1}</span><div><strong>{prettyStep(step.action)}</strong>{step.reason && <small>{step.reason}</small>}{step.result?.message && <small>{step.result.message}</small>}</div></div>)}</div></div>
        <details className="json-details"><summary>Ver JSON estructurado</summary><pre>{JSON.stringify(resultado, null, 2)}</pre></details>
      </section>}

      <section className="lower-grid">
        <section className="memory-section glass-card"><div className="memory-header"><div><p className="eyebrow">MEMORIA</p><h2>Facturas recientes</h2></div><span className="memory-count">{historial.length}</span></div>{historial.length > 0 ? <div className="memory-list">{historial.map((item, index) => <div className="memory-card" key={`${item.numero_factura}-${index}`}><div className="memory-card-top"><strong>{item.numero_factura || 'Sin número'}</strong><span>✓</span></div><span>{item.emisor || 'Emisor no detectado'}</span><small>{money(item.total, item.moneda)}</small></div>)}</div> : <div className="empty-memory"><span>◌</span><p>Las facturas procesadas durante esta sesión aparecerán aquí.</p></div>}</section>

        <section className="chat-section glass-card"><div className="chat-header"><div><p className="eyebrow">AI ASSISTANT</p><h2>Pregúntale a tus facturas</h2><p>Ejemplos: “Dame FAC-2026-00125 en JSON” o “muéstrame la factura 125 en tabla”.</p></div><span className="chat-badge">✦ IA</span></div><div className="chat-messages">{mensajes.length === 0 ? <div className="chat-empty"><div className="sparkle">✦</div><strong>¿Qué quieres consultar?</strong><span>El agente puede buscar una factura y devolvértela en el formato que pidas.</span><div className="suggestions"><button onClick={() => setChatInput('Dame la última factura en resumen')}>Última factura · resumen</button><button onClick={() => setChatInput('Dame la factura FAC-2026-00125 en JSON')}>Factura · JSON</button><button onClick={() => setChatInput('Muéstrame la factura FAC-2026-00125 en tabla')}>Factura · tabla</button></div></div> : mensajes.map((msg, index) => <div className={`chat-message ${msg.role}`} key={index}><div className="avatar">{msg.role === 'user' ? 'Tú' : '✦'}</div><div className="bubble">{msg.content}</div></div>)}{chatCargando && <div className="chat-message assistant"><div className="avatar">✦</div><div className="bubble typing"><i /><i /><i /></div></div>}</div><form className="chat-form" onSubmit={enviarChat}><input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Pídele algo al agente..." disabled={chatCargando} /><button type="submit" disabled={!chatInput.trim() || chatCargando}>Enviar <span>→</span></button></form></section>
      </section>

      <footer className="app-footer">SistemaVision · Agente IA para lectura, validación, memoria y consulta de facturas</footer>
    </div>
  );
}
