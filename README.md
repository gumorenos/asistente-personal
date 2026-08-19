# Asistente Personal

Asistente personal autónomo con WhatsApp como interfaz inicial. El núcleo funciona sin OpenClaw, Claude Code, Codex ni otros agentes externos; cualquier integración de ese tipo será opcional y desacoplada.

## Estado

- **Stage 1:** desarrollo cerrado; QA real de WhatsApp/RPi pendiente.
- **Stage 2A:** IA opcional explícita implementada; QA del proveedor real pendiente.
- **Stage 2B:** transcripción de audio opcional implementada; QA con audio/proveedor real pendiente.
- **Stage 2C:** propuestas de Calendar + aprobación/rechazo local implementadas; **sin writes a Google todavía**.

El desarrollo posterior puede continuar sin marcar como aprobados los checks manuales de [`docs/QA-PENDING.md`](docs/QA-PENDING.md).

## Stage 1 — capacidades locales

- self-chat seguro con allowlist PN/LID;
- SQLite y auth state de Baileys;
- notas, gastos y recordatorios;
- scheduler con retry;
- audit local;
- health/readiness;
- CI reproducible y Docker amd64/arm64.

## Stage 2A — IA explícita

- `Capability` y `AiProvider` desacoplados;
- OpenAI-compatible `/chat/completions` con `fetch` nativo;
- `AI_ENABLED=false` por defecto;
- solo `ia <pregunta>` / `ai <pregunta>` sale al proveedor;
- no se envían historial, notas, gastos ni recordatorios;
- no hay tool/function calling ni ejecución de acciones;
- HTTPS remoto, límites, timeout y audit sin prompt/respuesta.

## Stage 2B — transcripción de audio

- `TranscriptionProvider` desacoplado;
- OpenAI-compatible `/audio/transcriptions` multipart;
- `TRANSCRIPTION_ENABLED=false` por defecto;
- media loader solo después del self-chat guard;
- descarga lazy;
- `fileLength` declarado se valida antes de descargar y los bytes reales se validan otra vez antes de subir;
- buffer efímero en memoria, sin archivo persistente creado por la app;
- audit sin audio/file name/transcript;
- el transcript se devuelve como texto y **no se ejecuta como comando**.

## Stage 2C — Calendar sin writes

Stage 2C añade el boundary que debe existir antes de conectar Google Calendar:

```text
agenda mañana a las 10 reunión con Ana por 30 minutos
```

crea solamente una `action_request` local `pending`.

Comandos:

```text
acciones
aprueba acción #1
rechaza acción #1
```

Reglas:

- `agenda ...` reutiliza el parser horario determinista de recordatorios;
- duración por defecto: 60 minutos;
- se aceptan `por/durante N minutos/horas` entre 5 minutos y 8 horas;
- una propuesta expira al llegar su hora de inicio y ya no puede aprobarse;
- aprobar/rechazar es una transición local atómica;
- **aprobar NO ejecuta Google Calendar**;
- Stage 2C deliberadamente no contiene Calendar provider/executor ni OAuth.

## Configuración

```bash
cp .env.example .env
npm ci
npm run check
npm audit --omit=dev --audit-level=high
npm run dev
```

IA:

```env
AI_ENABLED=false
AI_PROVIDER=openai-compatible
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
```

Transcripción:

```env
TRANSCRIPTION_ENABLED=false
TRANSCRIPTION_PROVIDER=openai-compatible
TRANSCRIPTION_BASE_URL=
TRANSCRIPTION_API_KEY=
TRANSCRIPTION_MODEL=
TRANSCRIPTION_MAX_BYTES=15728640
```

Endpoints remotos de IA/transcripción deben usar HTTPS; loopback puede usar HTTP y omitir API key.

## QA

El QA real pendiente está centralizado en [`docs/QA-PENDING.md`](docs/QA-PENDING.md): pairing/reconnect/RPi, proveedor IA, audio real/transcripción, flujo real de propuestas/aprobación y operaciones.

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

1. diseñar Calendar provider/executor con idempotencia y revalidación de acciones `approved`;
2. definir OAuth/token storage y refresh strategy antes de habilitar Calendar writes;
3. briefing personal;
4. Observer read-only con allowlist explícita;
5. memoria/búsqueda y documentos;
6. integraciones opcionales con OpenClaw, Claude Code, Codex u otros agentes.

## Aviso

Baileys interactúa con WhatsApp Web y no es la API oficial de WhatsApp Business. El proyecto es para uso personal y conservador; no debe usarse para spam, mensajes masivos, outreach automatizado, vigilancia ni automatización abusiva.
