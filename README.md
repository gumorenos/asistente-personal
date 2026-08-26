# Asistente Personal

Asistente personal autónomo con WhatsApp como interfaz inicial. El núcleo funciona sin OpenClaw, Claude Code, Codex ni otros agentes externos; cualquier integración de ese tipo seguirá siendo opcional y desacoplada.

## Estado

- **Stage 1:** self-chat/local core implementado; QA real WhatsApp/RPi pendiente.
- **Stage 2A:** IA opcional y explícita implementada; QA de proveedor real pendiente.
- **Stage 2B:** transcripción opcional implementada; QA con audio/proveedor real pendiente.
- **Stage 2C:** propuestas Calendar + aprobación/rechazo local implementadas.
- **Stage 2D:** ejecución Google Calendar detrás de enable + aprobación + ejecución explícita; QA Google real pendiente.
- **Stage 2E:** briefing personal y retención operacional opt-in implementados.
- **Stage 2F:** Observer text-only/read-only + lectura/búsqueda local exact-JID implementados; QA WhatsApp real pendiente.
- **Stage 2G:** Baileys `getMessage`/retry store persistente y PN/LID-aware implementado; recovery real pendiente de QA live.
- **Stage 3:** memoria/búsqueda local FTS5 sobre mensajes, notas, recordatorios, gastos y compromisos; Observer físicamente separado.
- **Stage 4A:** ingestión local opt-in de PDFs con capa de texto.
- **Stage 4B:** OCR local opcional con Tesseract para PDFs escaneados.
- **Stage 4C:** lifecycle documental, borrado mediante action pipeline y retención documental opt-in.
- **Stage 4D:** chunks semánticos locales + embeddings opcionales con opt-in separado.
- **Stage 4E:** Q&A documental explícito con retrieval acotado y fuentes tratadas como datos no confiables.
- **Stage 5A:** Google Calendar read-only: agenda + free/busy, independiente de writes.
- **Stage 5B:** sugerencias deterministas de horarios sobre free/busy; sin IA, acciones ni writes.
- **Stage 5C:** comprobación exacta de disponibilidad futura; consulta solo el intervalo pedido y no crea acciones/eventos.
- **Stage 6A:** compromisos personales explícitos, locales y buscables; no hay detección automática de promesas.
- **Stage 6B:** notificación opt-in al self-chat de compromisos vencidos; retry local y `notified_at`, sin afirmar exactly-once distribuido.
- **Stage 6C:** vistas `hoy/semana/sin fecha` y reprogramación local idempotente; un no-op conserva `notified_at` y las respuestas están acotadas.
- **Stage 6D:** dashboard ejecutivo local con conteos mutuamente excluyentes y prioridades temporales; sin IA, acciones ni nuevos providers.
- **Stage 7A:** Gmail metadata-only, explícito y opt-in: Inbox/Unread + fecha/From/Subject; sin body, adjuntos, búsqueda libre, persistencia ni mutaciones.

Ningún check manual/live se considera aprobado por los tests automatizados. [`docs/QA-PENDING.md`](docs/QA-PENDING.md) conserva el acumulado histórico; para stages posteriores, el checklist específico `docs/QA-STAGE-*-PENDING.md` correspondiente es la referencia más actual de ese bloque hasta una futura consolidación.

## Principios de seguridad

- self-chat y Observer tienen rutas distintas y mutuamente excluyentes;
- `sendText()` solo acepta destinos incluidos en `WHATSAPP_SELF_JIDS`;
- IA/transcripción no ejecutan comandos;
- aprobar una acción no la ejecuta;
- Calendar write requiere `CALENDAR_ENABLED=true`, acción aprobada y `ejecuta acción #N`;
- Calendar read, sugerencias y comprobaciones exactas nunca crean acciones ni eventos;
- Gmail read Stage 7A usa credenciales dedicadas y el scope mínimo `gmail.metadata`; solo pide Inbox/Unread + From/Subject, no body/adjuntos/raw/full ni mutaciones;
- metadata Gmail no se persiste ni entra en memoria/FTS y no se envía a IA;
- Observer solo persiste texto de JIDs explícitamente allowlisted;
- Observer no recibe `AssistantCore`, `MessageTransport`, capabilities de acciones ni providers externos;
- Observer no puede responder a terceros/grupos ni crear acciones;
- media Observer no se descarga;
- búsqueda/lectura Observer exige self-chat + JID exacto conocido;
- `self_memory_fts` y `observation_fts` permanecen separados;
- ninguna búsqueda local llama IA automáticamente;
- compromisos se crean únicamente por comandos explícitos del self-chat; Observer nunca se convierte en detector de promesas;
- notificaciones de compromisos están deshabilitadas por defecto y solo admiten un destino presente en `WHATSAPP_SELF_JIDS`;
- resúmenes de compromisos son locales/deterministas y no exportan contenido a proveedores;
- documentos solo se descargan después del self-chat guard;
- captions/texto documental son terminales y nunca ejecutan comandos;
- PDFs se validan por tamaño, MIME y magic header;
- el PDF binario es efímero; solo texto + metadata mínima se persisten;
- OCR es local y opt-in;
- embeddings y Q&A documental tienen opt-ins independientes;
- texto documental enviado a Q&A se trata como fuente no confiable y no obtiene herramientas;
- el retry store de Baileys solo guarda protobuf de self-chat autorizado/outbound, nunca Observer/ignored;
- full history permanece deshabilitado;
- OpenClaw/Claude Code/Codex nunca son dependencia del core.

## Comandos principales

```text
ping
estado
ayuda
briefing

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

compromiso mañana a las 10 enviar informe a Ana
compromiso revisar presupuesto
me comprometo a renovar el dominio
prometí revisar el contrato
compromisos
compromisos vencidos
compromisos hoy
compromisos semana
compromisos sin fecha
resumen compromisos
reprograma compromiso #1 mañana a las 10
mueve compromiso #1 miércoles a las 9
cumplí compromiso #1
cancela compromiso #2
busca compromisos dominio

correos
correos recientes 3
correos no leídos 5

documentos
documento #1
busca documentos contrato
busca semántica documentos contrato
busca híbrida documentos contrato
pregunta documentos ¿qué dice el contrato sobre vacaciones?

agenda hoy
agenda mañana
agenda semana
disponibilidad hoy
disponibilidad mañana
propón horarios mañana para 30 minutos
libre mañana a las 10 por 30 minutos

agenda mañana a las 10 reunión con Ana por 30 minutos
acciones
aprueba acción #1
rechaza acción #1
ejecuta acción #1
```

## Memoria/búsqueda local — Stage 3

La búsqueda es local y explícita; FTS5 no llama IA.

```text
busca filtro de agua
busca notas presupuesto
busca mensajes proyecto orion
busca recordatorios visa
busca gastos taxi
busca compromisos dominio
busca gastos hoy taxi
busca desde 2026-08-01 hasta 2026-08-20 proyecto
```

Fuentes: mensajes self-chat ya autorizados, notas, recordatorios, gastos, compromisos y documentos indexados. Query y resultados no se guardan en audit; Observer usa su propio índice/comando y siempre un JID exacto. Gmail Stage 7A no entra en esta memoria ni se persiste.

Ver [`docs/STAGE-3-LOCAL-SEARCH.md`](docs/STAGE-3-LOCAL-SEARCH.md).

## Documentos — Stages 4A–4E

### Ingestión y OCR local

```env
DOCUMENTS_ENABLED=false
DOCUMENTS_MAX_BYTES=10485760
DOCUMENTS_MAX_PAGES=50
DOCUMENTS_MAX_TEXT_CHARS=100000
DOCUMENTS_TIMEOUT_MS=20000

DOCUMENTS_OCR_ENABLED=false
DOCUMENTS_OCR_MAX_PAGES=10
DOCUMENTS_OCR_DPI=180
DOCUMENTS_OCR_LANGUAGES=spa+eng
DOCUMENTS_OCR_TIMEOUT_MS=60000
```

`pdftotext`/`pdfinfo` se usan primero. Si no existe capa de texto y OCR está habilitado, Tesseract procesa localmente con límites propios. El binario no queda persistido.

### Lifecycle y retención

Borrado explícito usa el mismo pipeline de acciones: propuesta local -> aprobación -> ejecución. La retención automática documental es independiente y opt-in.

```env
DOCUMENT_RETENTION_ENABLED=false
DOCUMENT_RETENTION_DAYS=90
```

### Memoria semántica

Crear chunks locales no requiere exportación. Los embeddings son un segundo opt-in explícito.

```env
SEMANTIC_ENABLED=false
SEMANTIC_CHUNK_MAX_CHARS=1200
SEMANTIC_CHUNK_OVERLAP_CHARS=200
SEMANTIC_MAX_CHUNKS=100

EMBEDDINGS_ENABLED=false
EMBEDDINGS_PROVIDER=openai-compatible
EMBEDDINGS_BASE_URL=
EMBEDDINGS_API_KEY=
EMBEDDINGS_MODEL=
EMBEDDINGS_DIMENSIONS=1024
```

### Q&A documental

```env
DOCUMENT_QA_ENABLED=false
DOCUMENT_QA_MAX_QUESTION_CHARS=2000
DOCUMENT_QA_MAX_CONTEXT_CHARS=7000
DOCUMENT_QA_MAX_SOURCES=5
DOCUMENT_QA_MAX_REPLY_CHARS=3500
```

Requiere AI + semantic + embeddings. Solo una pregunta explícita y un conjunto acotado de excerpts recuperados llegan al LLM. No se adjuntan automáticamente notas, gastos, recordatorios, Observer ni historial general. Si no hay hits, no se llama al LLM.

## Calendar — writes y reads separados

### Write — Stages 2C/2D

```env
CALENDAR_ENABLED=false
CALENDAR_PROVIDER=google
GOOGLE_CALENDAR_ID=primary
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
GOOGLE_CALENDAR_REFRESH_TOKEN=
CALENDAR_TIMEOUT_MS=20000
```

`agenda <fecha/hora> <título>` crea solo una propuesta. Aprobar no ejecuta. El write ocurre únicamente con `ejecuta acción #N`, usa ledger/idempotency key estable y event ID determinista.

### Read-only — Stage 5A

```env
CALENDAR_READ_ENABLED=false
CALENDAR_READ_DAY_START=08:00
CALENDAR_READ_DAY_END=20:00
CALENDAR_READ_MIN_FREE_MINUTES=30
CALENDAR_READ_MAX_EVENTS=20
CALENDAR_READ_MAX_REPLY_CHARS=3500
```

Puede habilitarse con `CALENDAR_ENABLED=false`. Usa `events.list` con proyección mínima y `freeBusy`. Para un token exclusivamente read-only se documentan los scopes mínimos `calendar.events.readonly` + `calendar.freebusy`. La agenda/freeBusy no se persiste en SQLite.

### Sugerencias deterministas — Stage 5B

```env
CALENDAR_SLOT_SUGGESTIONS_ENABLED=false
CALENDAR_SLOT_MAX_SUGGESTIONS=3
CALENDAR_SLOT_ALIGNMENT_MINUTES=15
CALENDAR_SLOT_MAX_REPLY_CHARS=2000
```

Requiere Calendar read. Calcula opciones tempranas dentro de la ventana laboral, descarta pasado para `hoy`, alinea horarios y no crea `action_request`, evento ni estado oculto.

### Disponibilidad exacta — Stage 5C

```env
CALENDAR_EXACT_AVAILABILITY_ENABLED=false
```

Requiere Calendar read. `libre mañana a las 10 por 30 minutos` consulta únicamente ese intervalo mediante `freeBusy`. Duración 5–480 min, futuro y horizonte máximo 366 días. Como la consulta es explícita, puede comprobar horas fuera de la ventana laboral configurada. Solo devuelve libre/ocupado; no revela detalles del evento en conflicto y no persiste el resultado.

## Compromisos — Stages 6A–6D

Stage 6A almacena únicamente compromisos que el usuario capture explícitamente desde el self-chat. Puede tener vencimiento o quedar sin fecha; completar/cancelar es un lifecycle local atómico. Los compromisos entran en FTS y briefing, pero no se infieren de Observer ni de conversaciones de terceros.

Stage 6B permite, opcionalmente, enviar una notificación al self-chat cuando un compromiso abierto ya venció:

```env
COMMITMENT_NOTIFICATIONS_ENABLED=false
COMMITMENT_NOTIFICATION_DESTINATION_JID=
```

Al habilitar, `WHATSAPP_ENABLED=true` es obligatorio y el destino debe aparecer exactamente en `WHATSAPP_SELF_JIDS`. El scheduler procesa batches acotados, revalida cada fila antes del envío, persiste `notified_at` tras éxito y reintenta si `sendText()` falla.

Stage 6C agrega vistas temporales locales (`hoy`, `semana`, `sin fecha`) y reprogramación explícita. Los rangos usan `America/Lima` con inicio inclusivo/fin exclusivo. Reprogramar a un vencimiento realmente distinto limpia `notified_at`; pedir exactamente el mismo vencimiento es un no-op que conserva ese estado para no rearmar una notificación ya entregada. Las vistas compactan cada body y se limitan a 3500 caracteres.

Stage 6D agrega `resumen compromisos`: total abierto y buckets mutuamente excluyentes de vencidos, resto de hoy, resto de la semana, posteriores y sin fecha, más hasta tres vencidos y tres próximos vencimientos. Los conteos salen directamente de SQLite, la respuesta es acotada y no usa IA ni crea acciones.

No se afirma exactly-once distribuido: existe un crash-window si WhatsApp acepta el mensaje pero el proceso muere antes de persistir `notified_at`. Este riesgo está documentado y debe validarse con la línea QA antes de activar Stage 6B permanentemente.

Ver [`docs/STAGE-6-COMMITMENTS.md`](docs/STAGE-6-COMMITMENTS.md).

## Gmail metadata-only — Stage 7A

Stage 7A usa credenciales OAuth Gmail dedicadas y está deshabilitado por defecto. El scope mínimo previsto es `https://www.googleapis.com/auth/gmail.metadata`.

```env
GMAIL_READ_ENABLED=false
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_TIMEOUT_MS=20000
GMAIL_READ_MAX_MESSAGES=5
GMAIL_READ_MAX_REPLY_CHARS=3500
```

`correos` y `correos recientes [N]` consultan `INBOX`; `correos no leídos [N]` agrega `UNREAD`. La lista no usa `q`; cada mensaje se consulta con `format=metadata` y únicamente headers `From`/`Subject` más metadata estructural. Los headers se tratan como input externo no confiable y se eliminan caracteres de control/formato antes de mostrarlos.

Stage 7A no solicita body, snippet, attachments, MIME parts, `format=full/raw`, búsqueda Gmail libre ni historial. No persiste emails, no los indexa, no los manda a IA y no cambia leído/labels/archive/trash. Tampoco implementa send/reply/forward/drafts.

Ver [`docs/STAGE-7-GMAIL.md`](docs/STAGE-7-GMAIL.md).

## IA explícita — Stage 2A

Solo el texto tras `ia`/`ai` sale al proveedor. No se adjunta contexto personal automáticamente.

```env
AI_ENABLED=false
AI_PROVIDER=openai-compatible
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
```

## Audio/transcripción — Stage 2B

Solo audio del self-chat autorizado obtiene lazy media loader. Se comprueba tamaño antes y después del download. La transcripción vuelve como texto terminal y nunca se ejecuta.

## Briefing y retención operacional — Stage 2E

```env
BRIEFING_ENABLED=false
BRIEFING_TIME=08:00
BRIEFING_DESTINATION_JID=

RETENTION_ENABLED=false
MESSAGE_RETENTION_DAYS=30
OUTBOUND_RETENTION_DAYS=30
AUDIT_RETENTION_DAYS=90
BRIEFING_RETENTION_DAYS=90
```

El briefing usa estado local determinista, incluidos compromisos abiertos. La retención operacional no borra notas/gastos/reminders/commitments/actions ni documentos; Observer y documentos tienen políticas propias.

## Observer read-only — Stage 2F

Observer exige simultáneamente WhatsApp activo, self-JID administrativo, `OBSERVER_ENABLED=true` y el chat concreto allowlisted.

```text
observa chat 519XXXXXXXX@s.whatsapp.net como Trabajo
chats observados
observaciones 519XXXXXXXX@s.whatsapp.net 10
busca observaciones 519XXXXXXXX@s.whatsapp.net contrato
deja de observar 519XXXXXXXX@s.whatsapp.net
```

Solo persiste texto live allowlisted, con retención por chat; no descarga media, no usa IA, no crea acciones y no puede responder a terceros/grupos. Ver [`docs/OBSERVER-FOUNDATION.md`](docs/OBSERVER-FOUNDATION.md).

## Baileys retry/recovery — Stage 2G

`getMessage(key)` usa SQLite y conserva alias PN/LID. Inbound entra al retry store solo después del self-chat guard; outbound solo tras send exitoso. Observer/ignored quedan fuera. Recovery real sigue pendiente de QA con una sesión WhatsApp autorizada.

## Operación local

Requisitos: Node 22.18+. Para documentos fuera de Docker: Poppler; para OCR: Tesseract y traineddata configurados.

```bash
cp .env.example .env
npm ci
npm run check
npm audit --omit=dev --audit-level=high
npm run doctor
npm run dev
```

```bash
docker compose up -d --build
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/readyz
```

`doctor` inspecciona configuración/DB/herramientas localmente y no prueba conectividad de proveedores. CI valida TypeScript/tests/audit, Docker `linux/amd64` + `linux/arm64` y smoke PDF/OCR.

## Documentación y QA

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/OBSERVER-FOUNDATION.md`](docs/OBSERVER-FOUNDATION.md)
- [`docs/OPS-TOOLS.md`](docs/OPS-TOOLS.md)
- [`docs/STAGE-3-LOCAL-SEARCH.md`](docs/STAGE-3-LOCAL-SEARCH.md)
- [`docs/STAGE-4-DOCUMENTS.md`](docs/STAGE-4-DOCUMENTS.md)
- [`docs/STAGE-6-COMMITMENTS.md`](docs/STAGE-6-COMMITMENTS.md)
- [`docs/STAGE-7-GMAIL.md`](docs/STAGE-7-GMAIL.md)
- [`docs/QA-PENDING.md`](docs/QA-PENDING.md)
- [`docs/QA-STAGE-4E-PENDING.md`](docs/QA-STAGE-4E-PENDING.md)
- [`docs/QA-STAGE-5A-PENDING.md`](docs/QA-STAGE-5A-PENDING.md)
- [`docs/QA-STAGE-5B-PENDING.md`](docs/QA-STAGE-5B-PENDING.md)
- [`docs/QA-STAGE-5C-PENDING.md`](docs/QA-STAGE-5C-PENDING.md)
- [`docs/QA-STAGE-6A-PENDING.md`](docs/QA-STAGE-6A-PENDING.md)
- [`docs/QA-STAGE-6B-PENDING.md`](docs/QA-STAGE-6B-PENDING.md)
- [`docs/QA-STAGE-6C-PENDING.md`](docs/QA-STAGE-6C-PENDING.md)
- [`docs/QA-STAGE-6D-PENDING.md`](docs/QA-STAGE-6D-PENDING.md)
- [`docs/QA-STAGE-7A-PENDING.md`](docs/QA-STAGE-7A-PENDING.md)

## Próximos bloques

1. mantener acumulado el QA real de WhatsApp/RPi/Google/proveedores sin convertir tests automatizados en falsos PASS live;
2. cerrar QA real de Stage 6A–6D con la línea WhatsApp QA, incluyendo restart/retry, límites temporales, dashboard y el crash-window de notificaciones;
3. cerrar QA real de Gmail 7A con una cuenta/corpus QA y token `gmail.metadata` antes de considerar body, search o writes;
4. cerrar QA real de documentos/OCR/lifecycle/semantic/Q&A con corpus QA no sensible antes de habilitar documentos personales sensibles;
5. cerrar QA read-only real de Calendar 5A–5C con un Calendar QA y token de scopes mínimos;
6. evaluar cualquier ampliación Gmail (body/search/write/send) como boundary separado, no como extensión implícita de 7A;
7. mantener OpenClaw, Claude Code, Codex y otros agentes como adaptadores opcionales, nunca como dependencia del producto.

## Aviso

Baileys interactúa con WhatsApp Web y no es la API oficial de WhatsApp Business. El proyecto es para uso personal y conservador. Observer puede almacenar contenido de terceros cuando está activado y el chat fue autorizado; antes de usarlo con conversaciones reales deben revisarse necesidad, consentimiento aplicable, minimización y retención. Documentos, Calendar y Gmail pueden contener información sensible y deben usar permisos mínimos, credenciales separadas cuando corresponda, backups controlados y políticas de retención explícitas. No debe usarse para spam, outreach automatizado, vigilancia abusiva ni mensajería masiva.