# Asistente Personal

Asistente personal autónomo con WhatsApp como interfaz inicial. El núcleo funciona sin OpenClaw, Claude Code, Codex ni otros agentes externos; cualquier integración de ese tipo será opcional y desacoplada.

## Estado

**Stage 1: desarrollo cerrado; QA real de WhatsApp/RPi pendiente.**  
**Stage 2A: IA opcional explícita — desarrollo automatizado verde; QA externo pendiente.**  
**Stage 2B: transcripción de audio opcional — en desarrollo.**

Stage 1 entrega self-chat seguro, SQLite, notas, gastos, recordatorios, audit, health, CI reproducible y Docker amd64/arm64.

Stage 2A añade:

- interfaz `Capability` genérica y ordenada;
- `LocalCapabilities` con prioridad y comportamiento determinista;
- `AiProvider` desacoplado;
- OpenAI-compatible por `fetch` nativo, sin SDK nuevo;
- `AI_ENABLED=false` por defecto;
- solo `ia <pregunta>` / `ai <pregunta>` sale al proveedor;
- sin historial, notas, gastos, recordatorios, tools ni ejecución de acciones;
- HTTPS remoto, límites y timeout;
- audit operacional sin prompt/respuesta.

Stage 2B añade una boundary separada de transcripción:

- `TranscriptionProvider` desacoplado;
- endpoint OpenAI-compatible `/audio/transcriptions` por multipart;
- `TRANSCRIPTION_ENABLED=false` por defecto;
- solo audio del self-chat que ya pasó la allowlist recibe un loader de media;
- descarga lazy: con transcripción deshabilitada no se descargan bytes;
- pre-check del `fileLength` declarado por WhatsApp antes de descargar;
- segundo límite sobre bytes reales después de descargar;
- buffer efímero en memoria; no se crea un archivo persistente de audio;
- audit sin audio, nombre de archivo ni texto transcrito;
- la transcripción se devuelve como texto y **no se reinyecta como comando**.

Calendar, Observer, documentos y agentes externos siguen deshabilitados.

## Desarrollo local

Requisitos: Node 22.18+.

```bash
cp .env.example .env
npm ci
npm run check
npm audit --omit=dev --audit-level=high
npm run dev
```

## IA Stage 2A

```env
AI_ENABLED=false
AI_PROVIDER=openai-compatible
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
```

Para un proveedor remoto, `AI_BASE_URL` debe usar HTTPS. Loopback puede usar HTTP y omitir API key.

Solo sale al proveedor el texto escrito explícitamente después de `ia`/`ai` más un system prompt fijo. El output del modelo nunca vuelve a ejecutarse como comando.

## Transcripción Stage 2B

```env
TRANSCRIPTION_ENABLED=false
TRANSCRIPTION_PROVIDER=openai-compatible
TRANSCRIPTION_BASE_URL=
TRANSCRIPTION_API_KEY=
TRANSCRIPTION_MODEL=
TRANSCRIPTION_MAX_BYTES=15728640
```

Con transcripción habilitada, una nota de voz autorizada se descarga de WhatsApp solo cuando la capability la necesita y se envía al endpoint `/audio/transcriptions`. Un endpoint remoto exige HTTPS; loopback puede usar HTTP.

La transcripción es solo una respuesta textual. Si dice `anota ...` o `recuérdame ...`, **no se ejecuta**.

## QA

El emparejamiento/RPi de Stage 1, proveedor IA de Stage 2A y audio real de Stage 2B permanecen como QA pendiente en [`docs/QA-PENDING.md`](docs/QA-PENDING.md). El desarrollo puede continuar sin marcar esos checks como aprobados.

## Docker

```bash
cp .env.example .env
docker compose up -d --build
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/readyz
```

## Arquitectura y seguridad

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/QA-PENDING.md`](docs/QA-PENDING.md)

## Próximos bloques

1. cerrar Stage 2B con gates automatizados y dejar audio real como QA manual;
2. diseñar el action-approval boundary antes de cualquier Calendar write;
3. Calendar con propuesta + confirmación;
4. briefing personal;
5. Observer read-only sobre chats expresamente autorizados;
6. memoria/búsqueda y documentos;
7. integraciones opcionales con OpenClaw, Claude Code, Codex u otros agentes.

## Aviso

Baileys interactúa con WhatsApp Web y no es la API oficial de WhatsApp Business. El proyecto es para uso personal y conservador; no debe usarse para spam, mensajes masivos, outreach automatizado, vigilancia ni automatización abusiva.
