# Asistente Personal

Asistente personal autónomo con WhatsApp como interfaz inicial. El núcleo funciona sin OpenClaw, Claude Code, Codex ni otros agentes externos; cualquier integración de ese tipo será opcional y desacoplada.

## Estado

**Stage 1: desarrollo cerrado; QA real de WhatsApp/RPi pendiente.**  
**Stage 2A: foundation de IA opcional en desarrollo.**

Stage 1 entrega self-chat seguro, SQLite, notas, gastos, recordatorios, audit, health, CI reproducible y Docker amd64/arm64.

Stage 2A añade una boundary de capabilities y una consulta IA explícita sin convertirla en dependencia del producto:

- interfaz `Capability` genérica y ordenada;
- `LocalCapabilities` conserva prioridad y comportamiento determinista;
- interfaz `AiProvider` desacoplada;
- implementación inicial OpenAI-compatible por `fetch` nativo, sin SDK nuevo;
- IA deshabilitada por defecto;
- solo `ia <pregunta>` / `ai <pregunta>` envía texto al proveedor;
- no se envía historial, notas, gastos, recordatorios ni documentos;
- el modelo no tiene tools/function calling ni puede ejecutar acciones;
- endpoint remoto exige HTTPS; loopback puede usar HTTP;
- límites de input/output y timeout;
- audit de metadata operacional sin prompt/respuesta.

Calendar, audio, Observer, documentos y agentes externos siguen fuera de Stage 2A.

## Desarrollo local

Requisitos: Node 22.18+.

```bash
cp .env.example .env
npm ci
npm run check
npm audit --omit=dev --audit-level=high
npm run dev
```

## Configuración IA Stage 2A

La IA está apagada por defecto:

```env
AI_ENABLED=false
AI_PROVIDER=openai-compatible
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
```

Para un proveedor remoto compatible con `/chat/completions`:

```env
AI_ENABLED=true
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://proveedor.example/v1
AI_API_KEY=tu_clave
AI_MODEL=modelo-elegido
```

`AI_BASE_URL` remoto debe usar HTTPS. Para gateways locales se permite `http://127.0.0.1:...` o `http://localhost:...` y la API key puede omitirse.

### Qué sale al proveedor

Solo el texto escrito explícitamente después de `ia`/`ai` más un system prompt fijo. Ejemplo:

```text
ia dame tres formas de resumir esta idea
```

Un mensaje como `anota comprar café`, `gasté 20 soles`, `recuérdame ...` o cualquier texto sin prefijo IA **no se envía** al proveedor.

## Comandos

Los comandos Stage 1 siguen disponibles. Stage 2A añade:

```text
ia <pregunta>
ai <pregunta>
```

El output de IA es solo texto. Aunque el modelo responda `anota ...` o `recuérdame ...`, esa salida no vuelve al router y no se ejecuta.

## WhatsApp / QA

El emparejamiento y QA real de Stage 1 permanecen pendientes y están documentados en [`docs/QA-PENDING.md`](docs/QA-PENDING.md). El desarrollo posterior puede continuar sin marcar esos checks como aprobados.

## Docker

```bash
cp .env.example .env
docker compose up -d --build
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/readyz
```

El compose publica health únicamente en loopback del host.

## Arquitectura y seguridad

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/QA-PENDING.md`](docs/QA-PENDING.md)

## Roadmap después de Stage 2A

1. audio/transcripción;
2. Calendar con propuesta + confirmación antes de escribir;
3. briefing personal;
4. Observer read-only sobre chats expresamente autorizados;
5. memoria/búsqueda y documentos;
6. integraciones opcionales con OpenClaw, Claude Code, Codex u otros agentes, solo si aportan valor.

## Aviso

Baileys interactúa con WhatsApp Web y no es la API oficial de WhatsApp Business. El proyecto es para uso personal y conservador; no debe usarse para spam, mensajes masivos, outreach automatizado, vigilancia ni automatización abusiva.
