# SistemaVision — Agente IA para lectura de facturas

## Qué se completó
- Backend Express + Multer.
- Agente de visión con OpenAI Responses API.
- Function Calling con herramienta `guardar_factura`.
- Reintento automático: inicia en `low` y sube a `high` si faltan campos críticos.
- Memoria de sesión para conservar facturas recientes.
- Persistencia MySQL con Sequelize (`facturas` y `factura_items`).
- Frontend React/Vite para subir y visualizar facturas.
- Visualización del recorrido operativo del agente.
- Endpoint para consultar memoria e historial persistido.

## 1. Backend

```bash
cd backend
npm install
```

Crea `.env` basado en `.env.example`:

```env
PORT=3001
OPENAI_API_KEY=TU_CLAVE
OPENAI_VISION_MODEL=gpt-4o

DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=sistemavision
DB_USER=root
DB_PASSWORD=
```

Crea la base de datos MySQL `sistemavision` y luego:

```bash
npm run dev
```

El backend queda en `http://localhost:3001`.

## 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite mostrará la URL del frontend, normalmente `http://localhost:5173`.

Opcionalmente puedes crear `frontend/.env`:

```env
VITE_API_URL=http://localhost:3001
```

## 3. Flujo de la práctica

1. El usuario sube una factura.
2. Multer recibe la imagen en memoria.
3. El agente la envía a visión con detalle `low`.
4. El modelo extrae los datos y puede decidir llamar `guardar_factura`.
5. Si faltan campos críticos, el backend reintenta con detalle `high`.
6. Si el agente decide guardar, la herramienta persiste la factura y sus items en MySQL.
7. El resultado vuelve al frontend.
8. El backend conserva memoria de la sesión para la siguiente factura.

> La API key nunca debe colocarse en el frontend.
