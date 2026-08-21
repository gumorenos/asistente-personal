# Asistente Personal

Asistente personal autónomo con WhatsApp como interfaz inicial. El núcleo funciona sin OpenClaw, Claude Code, Codex ni otros agentes externos; cualquier integración de ese tipo seguirá siendo opcional y desacoplada.

## Estado

- **Stage 1:** self-chat/local core cerrado a nivel de desarrollo; QA real WhatsApp/RPi pendiente.
- **Stage 2A:** IA opcional explícita implementada; QA del proveedor real pendiente.
- **Stage 2B:** transcripción opcional implementada; QA con audio/proveedor real pendiente.
- **Stage 2C:** propuestas Calendar + aprobación/rechazo local implementadas.
- **Stage 2D:** ejecución Google Calendar implementada detrás de enable + aprobación + ejecución explícita; QA Google real pendiente.
- **Stage 2E:** briefing personal y retención operacional implementados, ambos opt-in donde corresponde.
- **Stage 2F:** Observer text-only/read-only + lectura local explícita implementados detrás de límites estrictos; QA WhatsApp real pendiente.
- **Stage 2G:** persistent Baileys `getMessage`/retry store implementado; recovery real resend/missing-message pendiente de sesión WhatsApp QA.

Ningún check manual se considera aprobado por los tests automatizados. La fuente de verdad sigue siendo [`docs/QA-PENDING.md`](docs/QA-PENDING.md).

## Principios de seguridad

- self-chat y Observer tienen rutas distintas y mutuamente excluyentes;
- `sendText()` solo acepta destinos incluidos en `WHATSAPP_SELF_JIDS`;
- IA/transcripción no ejecutan comandos;
- aprobar una acción no la ejecuta;
- Calendar requiere `CALENDAR_ENABLED=true`, acción aprobada y luego `ejecuta acción #N`;
- Observer solo persiste texto de JIDs explícitamente allowlisted;
- Observer no recibe `AssistantCore`, `MessageTransport`, capabilities ni providers externos;
- Observer no puede responder a terceros/grupos ni crear acciones;
- media Observer no se descarga;
- lectura Observer requiere un comando explícito desde el self-chat, JID exacto y máximo 10 filas;
- el retry store de Baileys solo guarda contenido protobuf de self-chat autorizado/outbound, nunca Observer/ignored;
- full history permanece deshabilitado.

## Capacidades locales

```text
ping
estado
ayuda

anota comprar filtro de agua
notas
completa nota #1
archiva nota #2

gasté S/ 78.50 en taxi #transporte
gastos hoy
gastos semana
gastos mes
resumen gastos mes
categoriza gasto #1 como transporte

recuérdame mañana a las 10 pagar la tarjeta
recordatorios
completa recordatorio #1
cancela recordatorio #2

briefing
```

## IA explícita — Stage 2A

Solo el texto después de `ia`/`ai` sale al proveedor. No se adjunta automáticamente historial, notas, gastos ni recordatorios.

```env
AI_ENABLED=false
AI_PROVIDER=openai-compatible
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
```

## Audio/transcripción — Stage 2B

Solo audio del self-chat autorizado puede recibir un lazy media loader. Se comprueba tamaño declarado y tamaño real antes del upload.

```env
TRANSCRIPTION_ENABLED=false
TRANSCRIPTION_PROVIDER=openai-compatible
TRANSCRIPTION_BASE_URL=
TRANSCRIPTION_API_KEY=
TRANSCRIPTION_MODEL=
TRANSCRIPTION_MAX_BYTES=15728640
```

La transcripción vuelve como texto terminal; una transcripción que diga `anota ...`, `agenda ...` o similar no se ejecuta.

## Calendar — Stages 2C/2D

La intención y el write son pasos distintos:

```text
agenda mañana a las 10 reunión con Ana por 30 minutos
acciones
aprueba acción #1
ejecuta acción #1
```

Reglas principales:

- `agenda ...` crea solo una propuesta `pending`;
- aprobar/rechazar son transiciones locales;
- una propuesta expira al llegar su hora de inicio;
- el executor vuelve a validar schema/fecha/timezone;
- el ledger de ejecución usa idempotency key estable;
- Google recibe un event ID determinista para reducir duplicados ante retries/crashes;
- repetir una ejecución exitosa no crea otro evento.

```env
CALENDAR_ENABLED=false
CALENDAR_PROVIDER=google
GOOGLE_CALENDAR_ID=primary
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
GOOGLE_CALENDAR_REFRESH_TOKEN=
CALENDAR_TIMEOUT_MS=20000
```

`CALENDAR_ENABLED=false` es el default.

## Briefing personal — Stage 2E

`briefing` genera un resumen determinista con estado local. El envío diario automático es opcional y exige un destino que ya pertenezca a `WHATSAPP_SELF_JIDS`.

```env
BRIEFING_ENABLED=false
BRIEFING_TIME=08:00
BRIEFING_DESTINATION_JID=
```

## Retención operacional — Stage 2E

Opt-in. Purga normalized self-chat messages, el store `whatsapp_message_store`, outbound IDs, audit y briefing-delivery rows. El retry store usa la misma ventana `MESSAGE_RETENTION_DAYS`. No borra notas, gastos, recordatorios, actions, allowlists ni credenciales.

```env
RETENTION_ENABLED=false
MESSAGE_RETENTION_DAYS=30
OUTBOUND_RETENTION_DAYS=30
AUDIT_RETENTION_DAYS=90
BRIEFING_RETENTION_DAYS=90
```

## Observer read-only — Stage 2F

Observer está apagado por defecto. Para capturar texto deben cumplirse todos estos gates:

1. `WHATSAPP_ENABLED=true`;
2. `WHATSAPP_SELF_JIDS` contiene el self-chat administrativo;
3. `OBSERVER_ENABLED=true`;
4. el JID concreto está habilitado en `observed_chats`.

Administración y lectura desde el self-chat:

```text
observa chat 519XXXXXXXX@s.whatsapp.net como Trabajo
observa chat 120363XXXXXXXX@g.us como Familia
chats observados
observaciones 519XXXXXXXX@s.whatsapp.net
observaciones 120363XXXXXXXX@g.us 10
deja de observar 519XXXXXXXX@s.whatsapp.net
```

`observaciones <jid> [1-10]`:

- exige JID exacto conocido administrativamente;
- default 5 filas, máximo 10;
- no busca ni resume otros chats;
- compacta/trunca cada fila y limita la respuesta total a 3.500 caracteres;
- funciona únicamente por petición explícita del self-chat;
- no usa IA;
- audit guarda hash del JID + counts, no contenido/JID/label crudos;
- puede consultar filas retenidas de un chat ya deshabilitado hasta que la retención las elimine.

Configuración:

```env
OBSERVER_ENABLED=false
```

Observer initial:

- solo eventos live `messages.upsert`/`notify`;
- solo texto, máximo 4.000 caracteres;
- tabla SQLite dedicada `observations`;
- idempotencia `(chat_jid,message_id)`;
- retención por chat de 1–90 días, default 7;
- no media download;
- no IA/transcripción automática;
- no Calendar/actions;
- no replies a terceros/grupos.

Ver contrato completo en [`docs/OBSERVER-FOUNDATION.md`](docs/OBSERVER-FOUNDATION.md).

## Baileys retry/recovery — Stage 2G

Baileys requiere un `getMessage(key)` respaldado por el store de la aplicación para retries y ciertos updates. La app ahora usa una tabla SQLite dedicada `whatsapp_message_store` (migración v10):

- key `(remote_jid,message_id)`;
- persiste únicamente `IMessage` serializado con `BufferJSON`;
- guarda inmediatamente respuestas retornadas por `sendMessage`;
- guarda inbound solo después de resolver self-chat autorizado;
- Observer, grupos/terceros no autorizados e ignored traffic retornan antes del write;
- `getMessage` recupera por JID + message ID exactos;
- upsert idempotente;
- con retención habilitada sigue `MESSAGE_RETENTION_DAYS`.

Esto cierra el gap de implementación que devolvía siempre `undefined`, pero **no sustituye QA live**: resend/missing-message recovery debe validarse con una sesión WhatsApp real.

## Desarrollo local

Requisitos: Node 22.18+.

```bash
cp .env.example .env
npm ci
npm run check
npm audit --omit=dev --audit-level=high
npm run dev
```

Endpoints remotos de IA/transcripción deben usar HTTPS; HTTP se permite solo en loopback.

## Docker

```bash
cp .env.example .env
docker compose up -d --build
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/readyz
```

CI valida tests/typecheck/audit y builds `linux/amd64` + `linux/arm64`.

## Documentación

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/OBSERVER-FOUNDATION.md`](docs/OBSERVER-FOUNDATION.md)
- [`docs/QA-PENDING.md`](docs/QA-PENDING.md)

## Próximos bloques

1. cerrar QA real de Stage 1/2 sin marcarlo aprobado artificialmente;
2. validar `getMessage`/resend/missing-message recovery live con una sesión WhatsApp QA;
3. evaluar búsqueda local por keyword sobre un único JID con límites estrictos, sin IA automática;
4. memoria/búsqueda y documentos con boundaries de privacidad propios;
5. integraciones opcionales con OpenClaw, Claude Code, Codex u otros agentes si aportan valor.

## Aviso

Baileys interactúa con WhatsApp Web y no es la API oficial de WhatsApp Business. El proyecto es para uso personal y conservador. Observer puede almacenar contenido de terceros cuando está activado y el chat fue autorizado; antes de usarlo con conversaciones reales deben revisarse necesidad, consentimiento aplicable, minimización y retención. No debe usarse para spam, outreach automatizado, vigilancia abusiva ni mensajería masiva.
