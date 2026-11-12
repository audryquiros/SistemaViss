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

export default function FacturaUploader() {
  const [archivo, setArchivo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [historial, setHistorial] = useState([]);
  const fileInputRef = useRef(null);

  const manejarArchivo = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Selecciona una imagen JPG, PNG o WEBP.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('La imagen no puede superar los 15 MB.');
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
      const response = await fetch(`${API_URL}/api/facturas/analizar`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Error del servidor (${response.status})`);
      }

      setResultado(data.data);
      setHistorial(data.memory?.invoices || []);
    } catch (err) {
      setError(err.message || 'No se pudo comunicar con el backend.');
    } finally {
      setCargando(false);
    }
  };

  const limpiar = () => {
    setArchivo(null);
    setPreview(null);
    setResultado(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="factura-container">
      <header className="factura-header">
        <div className="brand-mark">SV</div>
        <div>
          <p className="eyebrow">SISTEMAVISION · AGENTE IA</p>
          <h1>Lectura inteligente de facturas</h1>
          <p>Sube una factura y deja que el agente la analice, decida si necesita más detalle y guarde los datos.</p>
        </div>
      </header>

      <section className="workspace">
        <div
          className={`dropzone ${arrastrando ? 'drag-active' : ''} ${preview ? 'has-preview' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastrando(false);
            manejarArchivo(e.dataTransfer.files?.[0]);
          }}
          onClick={() => !cargando && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => manejarArchivo(e.target.files?.[0])}
            hidden
          />

          {preview ? (
            <div className="preview-box">
              <img src={preview} alt="Vista previa de la factura" className="preview-img" />
              <span>Haz clic o arrastra para cambiar la factura</span>
            </div>
          ) : (
            <div className="dropzone-placeholder">
              <div className="upload-icon">↥</div>
              <strong>Arrastra tu factura aquí</strong>
              <span>o haz clic para seleccionar una imagen</span>
              <small>JPG · PNG · WEBP · máximo 15 MB</small>
            </div>
          )}
        </div>

        {archivo && (
          <div className="archivo-info">
            <div>
              <strong>{archivo.name}</strong>
              <span>{(archivo.size / 1024).toFixed(1)} KB</span>
            </div>
            <button type="button" onClick={limpiar} disabled={cargando}>Quitar</button>
          </div>
        )}

        <button
          type="button"
          onClick={enviarFactura}
          disabled={!archivo || cargando}
          className="btn-procesar"
        >
          {cargando ? <><span className="spinner" /> El agente está analizando...</> : 'Analizar factura'}
        </button>

        {cargando && (
          <div className="agent-status">
            <span className="pulse" />
            Visión IA · extracción · validación · persistencia
          </div>
        )}

        {error && <div className="alert-error"><strong>Error:</strong> {error}</div>}
      </section>

      {resultado && (
        <section className="resultado-section">
          <div className="result-heading">
            <div>
              <p className="eyebrow">RESULTADO DEL AGENTE</p>
              <h2>Factura procesada</h2>
            </div>
            <span className={`status ${resultado.persistido ? 'success' : 'warning'}`}>
              {resultado.persistido ? '✓ Guardada en MySQL' : '⚠ No guardada'}
            </span>
          </div>

          <div className="resumen-grid">
            <div className="card-dato"><span>Emisor</span><strong>{resultado.emisor?.nombre || 'No detectado'}</strong><small>{resultado.emisor?.nif_rfc || 'Sin identificación'}</small></div>
            <div className="card-dato"><span>Factura</span><strong>{resultado.numero_factura || 'N/A'}</strong><small>{resultado.fecha_emision || 'Fecha no detectada'}</small></div>
            <div className="card-dato total-card"><span>Total</span><strong>{resultado.moneda || ''} {resultado.total ?? 'N/A'}</strong><small>Impuestos: {resultado.impuestos ?? 'N/A'}</small></div>
            <div className="card-dato"><span>Nivel de visión</span><strong>{resultado.nivel_detalle || 'N/A'}</strong><small>{resultado.agentTrace?.length || 1} paso(s) del agente</small></div>
          </div>

          {Array.isArray(resultado.items) && resultado.items.length > 0 && (
            <div className="tabla-items-container">
              <h3>Detalle de productos</h3>
              <div className="table-wrap">
                <table className="items-table">
                  <thead><tr><th>Descripción</th><th>Cantidad</th><th>Precio unitario</th><th>Importe</th></tr></thead>
                  <tbody>
                    {resultado.items.map((item, index) => (
                      <tr key={index}>
                        <td>{item.descripcion || item.concepto || '-'}</td>
                        <td>{item.cantidad ?? '-'}</td>
                        <td>{item.precio_unitario ?? '-'}</td>
                        <td>{item.importe ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="agent-trace">
            <h3>Razonamiento operativo</h3>
            {resultado.agentTrace?.map((step, index) => (
              <div className="trace-row" key={index}>
                <span>{index + 1}</span>
                <div><strong>{step.action}</strong>{step.reason && <small>{step.reason}</small>}</div>
              </div>
            ))}
          </div>

          <details className="json-details">
            <summary>Ver JSON estructurado</summary>
            <pre>{JSON.stringify(resultado, null, 2)}</pre>
          </details>
        </section>
      )}

      {historial.length > 0 && (
        <section className="memory-section">
          <p className="eyebrow">MEMORIA DE SESIÓN</p>
          <h2>Facturas recientes</h2>
          <div className="memory-list">
            {historial.map((item, index) => (
              <div className="memory-card" key={`${item.numero_factura}-${index}`}>
                <strong>{item.numero_factura || 'Sin número'}</strong>
                <span>{item.emisor || 'Emisor no detectado'}</span>
                <small>{item.total ?? 'Sin total'}</small>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
