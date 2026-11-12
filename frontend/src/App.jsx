import { useEffect, useState } from 'react';
import FacturaUploader from './components/FacturaUploader';
import CreateInvoice from './components/CreateInvoice';
import './App.css';

function getPath() {
  return window.location.pathname === '/crear-factura' ? '/crear-factura' : '/';
}

function navigate(path) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function GlobalNav({ path }) {
  return (
    <nav className="global-nav">
      <div className="nav-brand"><span>SV</span><strong>SistemaVision</strong></div>
      <div className="nav-links">
        <button className={path === '/' ? 'active' : ''} onClick={() => navigate('/')}>Consultar facturas</button>
        <button className={path === '/crear-factura' ? 'active' : ''} onClick={() => navigate('/crear-factura')}>+ Crear factura</button>
      </div>
    </nav>
  );
}

function App() {
  const [path, setPath] = useState(getPath());
  useEffect(() => {
    const onPop = () => setPath(getPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return (
    <main className="app-main">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <GlobalNav path={path} />
      {path === '/crear-factura' ? <CreateInvoice onNavigate={navigate} /> : <FacturaUploader />}
    </main>
  );
}

export default App;
