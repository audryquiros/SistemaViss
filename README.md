# SistemaVision — Agente IA para lectura y consulta de facturas

SistemaVision es una aplicación React + Express + MySQL que utiliza un agente de IA para leer facturas, validar sus cálculos, detectar duplicados exactos, guardar la información y permitir consultas en lenguaje natural.

## Funcionalidades

- Lectura de facturas mediante OpenAI Vision.
- Function Calling para guardar facturas en MySQL.
- Reintento automático de visión `low` → `high` cuando faltan datos críticos.
- Validación de cantidades, precios, importes, subtotal, impuestos y total.
- Detección de duplicados mediante fingerprint SHA-256.
- El mismo número de factura puede registrarse nuevamente si cambia cualquier dato relevante de la factura.
- Chat con IA para consultar facturas guardadas.
- El chat puede devolver una factura como JSON, CSV, tabla, resumen o texto.
- Memoria de sesión para facturas y conversaciones recientes.
- Interfaz responsive con animaciones, estados, toasts y confirmaciones personalizadas.

## Regla de duplicados

La duplicidad no se determina solamente por `numero_factura`. El fingerprint utiliza los datos principales de la factura y sus líneas. Por eso:

- misma factura + mismos datos → `409 FacturaDuplicadaError`;
- mismo número + cambio real en total, fecha, emisor, moneda o líneas → nuevo fingerprint y se permite guardar.

## Backend

```bash
cd backend
npm install
```

Crea `.env` desde `.env.example`:

```env
PORT=3001
OPENAI_API_KEY=TU_CLAVE
OPENAI_VISION_MODEL=gpt-4o
OPENAI_CHAT_MODEL=gpt-4o
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=sistemavision
DB_USER=root
DB_PASSWORD=
```

Luego:

```bash
npm run db:setup
npm run dev
```

Backend: `http://localhost:3001`

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend: normalmente `http://localhost:5173`

Opcional:

```env
VITE_API_URL=http://localhost:3001
```

## Chat

Endpoint:

`POST /api/chat`

Body:

```json
{
  "session_id": "sesion-del-usuario",
  "message": "Dame la factura FAC-2026-00125 en JSON"
}
```

El agente puede usar la herramienta `buscar_facturas` para consultar MySQL y luego entregar el resultado en el formato solicitado.

## Nuevas páginas

- `/` — lectura de facturas, validación, memoria y chat IA.
- `/crear-factura` — creación manual de facturas, cálculo automático y exportación.

La creación manual usa `POST /api/facturas/manual`, guarda la factura en MySQL y permite descargarla en PDF, Excel, CSV, JSON, HTML o TXT. La validación de duplicados se mantiene por fingerprint completo: una factura con el mismo número pero con cambios reales puede guardarse.
