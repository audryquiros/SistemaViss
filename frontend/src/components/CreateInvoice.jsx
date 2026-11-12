import { useMemo, useState } from 'react';
import './CreateInvoice.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const FORMATOS = [
  { value: 'pdf', label: 'PDF', icon: '▣' },
  { value: 'excel', label: 'Excel', icon: '▦' },
  { value: 'csv', label: 'CSV', icon: '≡' },
  { value: 'json', label: 'JSON', icon: '{}' },
  { value: 'html', label: 'HTML', icon: '</>' },
  { value: 'txt', label: 'TXT', icon: 'T' },
  { value: 'xml', label: 'XML', icon: '<>' },
];

function money(value, currency = 'CRC') {
  const n = Number(value || 0);
  return `${currency} ${n.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptyItem() {
  return { descripcion: '', cantidad: 1, precio_unitario: '' };
}

async function descargarArchivo(download) {
  if (!download?.url) throw new Error('No hay un archivo disponible.');
  const response = await fetch(`${API_URL}${download.url}`);
  if (!response.ok) {
    let detail = 'No se pudo generar el archivo.';
    try { const body = await response.json(); detail = body.error || detail; } catch {}
    throw new Error(detail);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = download.filename || `factura.${download.format || 'pdf'}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CreateInvoice({ onNavigate }) {
  const [form, setForm] = useState({
    fecha_emision: today(), moneda: 'CRC', taxRate: 13,
    emisor: { nombre: '', nif_rfc: '', direccion: '' },
    receptor: { nombre: '', nif_rfc: '' },
    items: [emptyItem()],
  });
  const [formato, setFormato] = useState('pdf');
  const [loading, setLoading] = useState(false);
  const [download, setDownload] = useState(null);
  const [created, setCreated] = useState(null);
  const [error, setError] = useState('');

  const subtotal = useMemo(() => form.items.reduce((sum, item) => sum + (Number(item.cantidad) || 0) * (Number(item.precio_unitario) || 0), 0), [form.items]);
  const impuestos = subtotal * ((Number(form.taxRate) || 0) / 100);
  const total = subtotal + impuestos;

  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const updateParty = (party, field, value) => setForm((prev) => ({ ...prev, [party]: { ...prev[party], [field]: value } }));
  const updateItem = (index, field, value) => setForm((prev) => ({ ...prev, items: prev.items.map((item, i) => i === index ? { ...item, [field]: value } : item) }));
  const addItem = () => setForm((prev) => ({ ...prev, items: [...prev.items, emptyItem()] }));
  const removeItem = (index) => setForm((prev) => ({ ...prev, items: prev.items.length === 1 ? prev.items : prev.items.filter((_, i) => i !== index) }));

  async function crearFactura(e) {
    e.preventDefault();
    setError(''); setDownload(null); setCreated(null);
    if (!form.emisor.nombre.trim() || !form.receptor.nombre.trim()) {
      setError('Completa el emisor y el receptor. El número de factura se asigna automáticamente.');
      return;
    }
    if (!form.items.some((item) => item.descripcion.trim() && Number(item.cantidad) > 0 && Number(item.precio_unitario) >= 0)) {
      setError('Agrega al menos un producto o servicio válido.');
      return;
    }

    const payload = {
      fecha_emision: form.fecha_emision,
      moneda: form.moneda,
      emisor: form.emisor,
      receptor: form.receptor,
      subtotal,
      impuestos,
      total,
      items: form.items.filter((item) => item.descripcion.trim()).map((item) => ({
        descripcion: item.descripcion.trim(),
        cantidad: Number(item.cantidad),
        precio_unitario: Number(item.precio_unitario),
        importe: Number(item.cantidad) * Number(item.precio_unitario),
      })),
    };

    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/facturas/manual`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factura: payload, formato }),
      });
      const data = await response.json();
      if (response.status === 409 || data.duplicate) {
        throw new Error(`${data.error || 'Esta factura ya existe.'} Puedes cambiar un dato real para crear una nueva versión.`);
      }
      if (!response.ok || !data.success) throw new Error(data.error || 'No se pudo crear la factura.');
      setCreated(data.data);
      setDownload({ ...data.download, filename: `factura-${String(data.data?.numero_factura || data.data?.id).replace(/[^a-zA-Z0-9_-]+/g, '_')}.${formato === 'excel' ? 'xlsx' : formato}` });
    } catch (err) {
      setError(err.message || 'No se pudo crear la factura.');
    } finally { setLoading(false); }
  }

  async function downloadCurrent() {
    if (!download) return;
    try { await descargarArchivo(download); } catch (err) { setError(err.message); }
  }

  function chooseFormat(value) {
    setFormato(value);
    if (created) setDownload((prev) => prev ? { ...prev, format: value, label: `Descargar ${value === 'excel' ? 'Excel' : value.toUpperCase()}`, url: `/api/facturas/${created.id}/export/${value}`, filename: `factura-${String(created.numero_factura || created.id).replace(/[^a-zA-Z0-9_-]+/g, '_')}.${value === 'excel' ? 'xlsx' : value}` } : prev);
  }

  return (
    <div className="create-page">
      <header className="create-header">
        <div className="create-brand">
          <div className="create-brand-mark"><span>SV</span></div>
          <div><p className="eyebrow">SISTEMAVISION · FACTURACIÓN</p><h1>Crea tu factura <span>a tu manera.</span></h1><p>Ingresa los datos, elige el formato y deja que el sistema prepare el documento.</p></div>
        </div>
        <div className="create-actions"><button type="button" onClick={() => onNavigate('/')}>← Consultar facturas</button></div>
      </header>

      <div className="create-stepbar"><div className="active"><span>01</span><strong>Datos</strong><small>Información de la factura</small></div><div><span>02</span><strong>Formato</strong><small>Elige cómo entregarla</small></div><div><span>03</span><strong>Generar</strong><small>Guardar y descargar</small></div></div>

      <form className="create-layout" onSubmit={crearFactura}>
        <section className="create-form-card">
          <div className="create-section-head"><div><p className="eyebrow">INFORMACIÓN GENERAL</p><h2>Datos de la factura</h2></div><span className="create-chip">MySQL + IA</span></div>
          <div className="form-grid three"><label>Número de factura<input value="Se asignará automáticamente" readOnly disabled /></label><label>Fecha de emisión<input type="date" value={form.fecha_emision} onChange={(e) => update('fecha_emision', e.target.value)} /></label><label>Moneda<select value={form.moneda} onChange={(e) => update('moneda', e.target.value)}><option value="CRC">CRC · Colones</option><option value="USD">USD · Dólares</option></select></label></div>

          <div className="party-grid">
            <div className="party-card"><div className="party-title"><span>EMISOR</span><strong>Quién emite la factura</strong></div><label>Nombre<input value={form.emisor.nombre} onChange={(e) => updateParty('emisor', 'nombre', e.target.value)} placeholder="Tecnología Tica S.A." /></label><div className="form-grid two"><label>Identificación<input value={form.emisor.nif_rfc} onChange={(e) => updateParty('emisor', 'nif_rfc', e.target.value)} placeholder="3-101-456789" /></label><label>Dirección<input value={form.emisor.direccion} onChange={(e) => updateParty('emisor', 'direccion', e.target.value)} placeholder="San José, Costa Rica" /></label></div></div>
            <div className="party-card"><div className="party-title"><span>RECEPTOR</span><strong>A quién se factura</strong></div><label>Nombre<input value={form.receptor.nombre} onChange={(e) => updateParty('receptor', 'nombre', e.target.value)} placeholder="Café Central C.R." /></label><label>Identificación<input value={form.receptor.nif_rfc} onChange={(e) => updateParty('receptor', 'nif_rfc', e.target.value)} placeholder="3-102-987654" /></label></div>
          </div>

          <div className="items-head"><div><p className="eyebrow">DETALLE</p><h3>Productos y servicios</h3></div><button type="button" onClick={addItem}>+ Agregar línea</button></div>
          <div className="manual-items">{form.items.map((item, index) => <div className="manual-item" key={index}><div className="item-index">{String(index + 1).padStart(2, '0')}</div><label>Descripción<input value={item.descripcion} onChange={(e) => updateItem(index, 'descripcion', e.target.value)} placeholder="Diseño y desarrollo de sistema web" /></label><label>Cantidad<input type="number" min="0" step="0.001" value={item.cantidad} onChange={(e) => updateItem(index, 'cantidad', e.target.value)} /></label><label>Precio unitario<input type="number" min="0" step="0.01" value={item.precio_unitario} onChange={(e) => updateItem(index, 'precio_unitario', e.target.value)} placeholder="0.00" /></label><div className="item-amount"><span>Importe</span><strong>{money((Number(item.cantidad) || 0) * (Number(item.precio_unitario) || 0), form.moneda)}</strong></div><button type="button" className="remove-item" onClick={() => removeItem(index)} disabled={form.items.length === 1}>×</button></div>)}</div>

          <div className="tax-row"><label>Impuesto (%)<input type="number" min="0" max="100" step="0.01" value={form.taxRate} onChange={(e) => update('taxRate', e.target.value)} /></label><div className="totals"><div><span>Subtotal</span><strong>{money(subtotal, form.moneda)}</strong></div><div><span>Impuestos</span><strong>{money(impuestos, form.moneda)}</strong></div><div className="grand"><span>Total</span><strong>{money(total, form.moneda)}</strong></div></div></div>
        </section>

        <aside className="create-side">
          <section className="format-card"><p className="eyebrow">FORMATO DE SALIDA</p><h2>¿Cómo quieres tu factura?</h2><p>Elige el documento que quieres generar. La factura se guarda primero y luego queda disponible para descargar.</p><div className="format-options">{FORMATOS.map((f) => <button type="button" key={f.value} className={formato === f.value ? 'selected' : ''} onClick={() => chooseFormat(f.value)}><span>{f.icon}</span><div><strong>{f.label}</strong><small>{f.value === 'pdf' ? 'Documento listo para imprimir' : f.value === 'excel' ? 'Hoja de cálculo' : `Archivo ${f.label}`}</small></div>{formato === f.value && <b>✓</b>}</button>)}</div><button className="generate-btn" type="submit" disabled={loading}>{loading ? <><span className="mini-spinner" /> Generando factura...</> : <>Crear factura <span>→</span></>}</button>{error && <div className="create-error"><b>!</b><span>{error}</span></div>}</section>

          {created && <section className="created-card"><div className="created-check">✓</div><p className="eyebrow">FACTURA CREADA</p><h3>{created.numero_factura}</h3><p>La factura fue creada correctamente.</p><div className="created-total">{money(created.total, created.moneda)}</div><button type="button" className="download-created" onClick={downloadCurrent}>↓ Descargar {formato === 'excel' ? 'Excel' : formato.toUpperCase()}</button><div className="other-formats"><span>También puedes descargarla en:</span><div>{FORMATOS.filter((f) => f.value !== formato).map((f) => <button key={f.value} type="button" onClick={() => chooseFormat(f.value)}>{f.label}</button>)}</div></div></section>}
        </aside>
      </form>
    </div>
  );
}
