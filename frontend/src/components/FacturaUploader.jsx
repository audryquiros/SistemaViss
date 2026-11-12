import { useState, useRef } from 'react';
import './FacturaUploader.css';

export default function FacturaUploader() {
  const [archivo, setArchivo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const fileInputRef = useRef(null);

  const manejarArchivo = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Por favor selecciona un archivo de imagen válido (JPG, PNG, WebP).');
      return;
    }
    setError(null);
    setResultado(null);
    setArchivo(file);

    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const onFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      manejarArchivo(e.target.files[0]);
    }
  };

  const onDragOver = (e) => {
    e.preventDefault();
    setArrastrando(true);
  };

  const onDragLeave = () => {
    setArrastrando(false);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setArrastrando(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      manejarArchivo(e.dataTransfer.files[0]);
    }
  };

  const enviarFactura = async () => {
    if (!archivo) {
      setError('Por favor selecciona una imagen de factura antes de procesar.');
      return;
    }

    setCargando(true);
    setError(null);

    const formData = new FormData();
    formData.append('factura', archivo);

    try {
      const response = await fetch('http://localhost:3001/api/facturas/analizar', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Error del servidor (${response.status})`);
      }

      setResultado(data.data);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Error al comunicarse con el servidor.');
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
        <h2>🧾 Procesamiento Inteligente de Facturas</h2>
        <p>Carga la foto o escaneo de tu factura para extraer sus datos con Visión IA</p>
      </header>

      {/* Zona de Drop & Carga */}
      <div
        className={`dropzone ${arrastrando ? 'drag-active' : ''} ${preview ? 'has-preview' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !cargando && fileInputRef.current?.click()}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={onFileChange}
          accept="image/*"
          style={{ display: 'none' }}
        />

        {preview ? (
          <div className="preview-box">
            <img src={preview} alt="Vista previa de factura" className="preview-img" />
            <p className="preview-caption">Haz clic o arrastra para cambiar la imagen</p>
          </div>
        ) : (
          <div className="dropzone-placeholder">
            <div className="upload-icon">📁</div>
            <p><strong>Arrastra tu factura aquí</strong> o haz clic para buscar</p>
            <span>Soporta JPG, PNG, WEBP (hasta 15MB)</span>
          </div>
        )}
      </div>

      {archivo && (
        <div className="archivo-info">
          <span>📄 <strong>{archivo.name}</strong> ({(archivo.size / 1024).toFixed(1)} KB)</span>
          <button type="button" onClick={limpiar} disabled={cargando} className="btn-cancel">
            Quitar
          </button>
        </div>
      )}

      {/* Acciones */}
      <div className="acciones-bar">
        <button
          type="button"
          onClick={enviarFactura}
          disabled={!archivo || cargando}
          className="btn-procesar"
        >
          {cargando ? (
            <>
              <span className="spinner"></span> Analizando con Visión IA...
            </>
          ) : (
            '🚀 Procesar Factura'
          )}
        </button>
      </div>

      {/* Mensajes de error */}
      {error && (
        <div className="alert alert-error">
          <strong>Error: </strong> {error}
        </div>
      )}

      {/* Visualización del texto/datos extraídos */}
      {resultado && (
        <div className="resultado-section">
          <h3>📋 Datos Extraídos de la Factura</h3>

          {/* Tarjetas resumen con campos principales */}
          <div className="resumen-grid">
            <div className="card-dato">
              <span className="label">Emisor</span>
              <span className="valor">{resultado.emisor?.nombre || resultado.emisor || 'No detectado'}</span>
              {resultado.emisor?.nif_rfc && <small className="sub">RFC/NIF: {resultado.emisor.nif_rfc}</small>}
            </div>

            <div className="card-dato">
              <span className="label">Receptor / Cliente</span>
              <span className="valor">{resultado.receptor?.nombre || resultado.receptor || 'No detectado'}</span>
              {resultado.receptor?.nif_rfc && <small className="sub">RFC/NIF: {resultado.receptor.nif_rfc}</small>}
            </div>

            <div className="card-dato">
              <span className="label">N° Factura / Folio</span>
              <span className="valor">{resultado.numero_factura || 'N/A'}</span>
            </div>

            <div className="card-dato">
              <span className="label">Fecha</span>
              <span className="valor">{resultado.fecha_emision || 'N/A'}</span>
            </div>

            <div className="card-dato total-card">
              <span className="label">Total a Pagar</span>
              <span className="valor total-valor">
                {resultado.moneda || '$'} {resultado.total != null ? resultado.total : 'N/A'}
              </span>
              {resultado.impuestos != null && <small className="sub">Impuestos: {resultado.impuestos}</small>}
            </div>
          </div>

          {/* Tabla de ítems si existen */}
          {Array.isArray(resultado.items) && resultado.items.length > 0 && (
            <div className="tabla-items-container">
              <h4>Detalle de Conceptos / Productos</h4>
              <table className="items-table">
                <thead>
                  <tr>
                    <th>Descripción</th>
                    <th>Cant.</th>
                    <th>P. Unitario</th>
                    <th>Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.items.map((item, idx) => (
                    <tr key={idx}>
                      <td>{item.descripcion || item.concepto || '-'}</td>
                      <td>{item.cantidad ?? '-'}</td>
                      <td>{item.precio_unitario ?? '-'}</td>
                      <td>{item.importe ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Texto bruto estructurado en JSON */}
          <div className="raw-json-container">
            <h4>Texto Completo Estructurado (JSON)</h4>
            <pre className="raw-json">{JSON.stringify(resultado, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

