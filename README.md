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
- **Stage 2G:** persistent Baileys `getMessage`/retry store implementado y PN/LID-aware; recovery real resend/missing-message pendiente de sesión WhatsApp QA.
- **Stage 3:** memoria/búsqueda local FTS5 implementada sobre mensajes, notas, recordatorios y gastos; búsqueda Observer permanece físicamente separada y exact-JID only.
- **Stage 4A:** ingestión local opt-in de PDFs con capa de texto implementada; binario efímero, texto extraído indexado como memoria local y OCR diferido a un stage posterior. QA PDF/WhatsApp real pendiente.

Ningún check manual se considera aprobado por los tests automatizados. La fuente de verdad sigue siendo [`docs/QA-PENDING.md`](docs/QA-PENDING.md).

## Principios de seguridad

- self-chat y Observer tienen rutas distintas y mutuamente excluyentes;
- `sendText()` solo acepta destinos incluidos en `WHATSAPP_SELF_JIDS`;
- IA/transcripción no ejecutan comandos;
- aprobar una acción no la ejecuta;
- Calendar requiere `CALENDAR_ENABLED=true`, acción aprobada y luego `ejecuta acción #N`;
- Observer solo persiste texto de JIDs explícitamente allowlisted;
- Observer no recibe `AssistantCore`, `MessageTransport`, capabilities de acciones ni providers externos;
- Observer no puede responder a terceros/grupos ni crear acciones;
- media Observer no se descarga;
- lectura/búsqueda Observer exige un comando explícito desde el self-chat y JID exacto conocido;
- `self_memory_fts` y `observation_fts` son índices separados;
- ninguna búsqueda local llama IA ni envía la query/resultados a providers externos;
- documentos se descargan solo después de pasar el self-chat guard;
- un documento es terminal antes de los parsers de comandos: su caption o texto nunca ejecuta `anota`, `agenda`, etc.;
- PDFs se validan por tamaño, MIME y magic header antes de extracción;
- el PDF binario no se persiste; solo texto extraído + metadata mínima entran a SQLite;
- el retry store de Baileys solo guarda contenido protobuf de self-chat autorizado/outbound, nunca Observer/ignored;
- el retry store conserva alias PN/LID para resolver el mismo `message_id` por cualquiera de las dos identidades;
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

documentos
documento #1
busca documentos contrato
```

## Memoria/búsqueda local — Stage 3

La búsqueda es local y explícita. No usa embeddings ni IA.

```text
busca filtro de agua
busca notas presupuesto
busca mensajes proyecto orion
busca recordatorios visa
busca gastos taxi
busca gastos hoy taxi
busca recordatorios semana banco
busca notas mes presupuesto
busca desde 2026-08-01 hasta 2026-08-20 proyecto
busca gastos desde 2026-08-01 hasta 2026-08-20 taxi
```

Fuentes de la memoria personal:

- mensajes que ya pasaron el self-chat guard;
- notas;
- recordatorios;
- gastos;
- documentos PDF previamente indexados en Stage 4A.

Reglas:

- SQLite FTS5 local con matching Unicode/prefijos;
- query máxima 200 caracteres / 8 tokens;
- sintaxis FTS cruda no se ejecuta;
- máximo 5 resultados por comando actual;
- el propio mensaje `busca ...` se excluye por `message_id`;
- `hoy`, `semana` y `mes` respetan `APP_TIMEZONE`;
- `desde YYYY-MM-DD hasta YYYY-MM-DD` es inclusivo para el usuario;
- audit guarda solo metadata estructural/counts, nunca query ni resultados.

Observer usa otro índice y otro comando:

```text
busca observaciones 519XXXXXXXX@s.whatsapp.net contrato
busca observaciones 120363XXXXXXXX@g.us presupuesto
```

No existe búsqueda Observer global: siempre exige un JID exacto ya conocido en `observed_chats`.

Ver [`docs/STAGE-3-LOCAL-SEARCH.md`](docs/STAGE-3-LOCAL-SEARCH.md).

## PDFs locales — Stage 4A

Stage 4A procesa únicamente documentos PDF del self-chat autorizado y está apagado por defecto.

```env
DOCUMENTS_ENABLED=false
DOCUMENTS_MAX_BYTES=10485760
DOCUMENTS_MAX_PAGES=50
DOCUMENTS_MAX_TEXT_CHARS=100000
DOCUMENTS_TIMEOUT_MS=20000
```

Flujo de seguridad:

1. si está deshabilitado, el documento no se descarga;
2. tamaño declarado y MIME se validan antes del download;
3. tamaño real, MIME y `%PDF-` se revalidan después del download;
4. `pdfinfo` valida número de páginas;
5. `pdftotext` extrae localmente con timeout y output acotado;
6. el binario se elimina tras la extracción y no se guarda en SQLite;
7. solo texto extraído + metadata mínima se persisten e indexan como `document`;
8. un PDF sin capa de texto no se guarda y queda como candidato futuro a OCR;
9. no se llama IA, no se generan acciones y contenido Observer nunca obtiene loader documental.

Comandos:

```text
documentos
documento #1
busca documentos contrato
busca documentos mes presupuesto
busca documentos desde 2026-08-01 hasta 2026-08-21 factura
```

El runtime Docker incluye `poppler-utils`. Ver [`docs/STAGE-4-DOCUMENTS.md`](docs/STAGE-4-DOCUMENTS.md).

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

Opt-in. Purga normalized self-chat messages, el store `whatsapp_message_store`, outbound IDs, audit y briefing-delivery rows. El retry store usa la misma ventana `MESSAGE_RETENTION_DAYS`. Cuando un mensaje u observación base se purga, sus triggers eliminan también la entrada FTS correspondiente.

Los documentos Stage 4A son estado de dominio y no se purgan con esta retención operacional; una política documental específica deberá definirse antes de uso diario con material sensible.

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
busca observaciones 519XXXXXXXX@s.whatsapp.net contrato
deja de observar 519XXXXXXXX@s.whatsapp.net
```

Observer initial:

- solo eventos live `messages.upsert`/`notify`;
- solo texto, máximo 4.000 caracteres;
- tabla SQLite dedicada `observations`;
- idempotencia `(chat_jid,message_id)`;
- retención por chat de 1–90 días, default 7;
- no media download;
- no IA/transcripción/document extraction automática;
- no Calendar/actions;
- no replies a terceros/grupos;
- búsqueda FTS separada, exact-JID only, sin búsqueda global.

Ver contrato completo en [`docs/OBSERVER-FOUNDATION.md`](docs/OBSERVER-FOUNDATION.md).

## Baileys retry/recovery — Stage 2G

Baileys dispone de un `getMessage(key)` respaldado por SQLite:

- migración v10 crea `whatsapp_message_store`;
- migración v11 añade `remote_jid_alt` e índice PN/LID;
- lookup por primary/alt + el mismo `message_id`;
- persiste únicamente `IMessage` serializado con `BufferJSON`;
- outbound solo tras `sendMessage` exitoso;
- inbound solo después de resolver self-chat autorizado;
- Observer/ignored traffic no entra al store;
- retención usa `MESSAGE_RETENTION_DAYS`.

Esto cierra el gap de implementación, pero resend/missing-message recovery y PN/LID reales siguen pendientes de QA live.

## Desarrollo local

Requisitos: Node 22.18+. Para habilitar Stage 4A fuera de Docker también se requieren `pdfinfo` y `pdftotext` de Poppler.

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

CI valida tests/typecheck/audit, builds `linux/amd64` + `linux/arm64` y disponibilidad de `pdfinfo`/`pdftotext` en ambas imágenes.

## Documentación

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/OBSERVER-FOUNDATION.md`](docs/OBSERVER-FOUNDATION.md)
- [`docs/STAGE-3-LOCAL-SEARCH.md`](docs/STAGE-3-LOCAL-SEARCH.md)
- [`docs/STAGE-4-DOCUMENTS.md`](docs/STAGE-4-DOCUMENTS.md)
- [`docs/QA-PENDING.md`](docs/QA-PENDING.md)

## Próximos bloques

1. mantener acumulado el QA real de WhatsApp/RPi/Google/proveedores sin marcarlo aprobado artificialmente;
2. validar Stage 4A con Poppler real + PDF con texto y, cuando exista sesión WhatsApp QA, descarga documental live;
3. definir política específica de retención/borrado para documentos antes de uso sensible cotidiano;
4. Stage 4B: evaluar OCR local para PDFs escaneados/imágenes sin ampliar Observer ni permitir ejecución automática;
5. evaluar búsqueda semántica/embeddings solo si FTS5 demuestra una limitación real;
6. integraciones opcionales con OpenClaw, Claude Code, Codex u otros agentes si aportan valor.

## Aviso

Baileys interactúa con WhatsApp Web y no es la API oficial de WhatsApp Business. El proyecto es para uso personal y conservador. Observer puede almacenar contenido de terceros cuando está activado y el chat fue autorizado; antes de usarlo con conversaciones reales deben revisarse necesidad, consentimiento aplicable, minimización y retención. Los documentos personales pueden contener información especialmente sensible y deben tratarse como estado persistente protegido. No debe usarse para spam, outreach automatizado, vigilancia abusiva ni mensajería masiva.