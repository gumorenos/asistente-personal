# Stage 7 — Gmail

## Stage 7A: lectura explícita de metadata

Stage 7A incorpora una primera integración Gmail deliberadamente estrecha. Su objetivo es poder revisar rápidamente el buzón desde el self-chat sin abrir todavía el contenido completo de los correos ni permitir mutaciones.

### Trust boundary

La integración está deshabilitada por defecto y usa credenciales OAuth Gmail dedicadas, separadas de Google Calendar.

Scope mínimo previsto:

```text
https://www.googleapis.com/auth/gmail.metadata
```

Ese scope permite consultar metadata/headers y labels, pero no el body del mensaje. Stage 7A no reutiliza silenciosamente el refresh token de Calendar.

### Comandos

```text
correos
correos recientes
correos recientes 3
correos no leídos
correos no leídos 5
```

Solo estas formas explícitas activan la capability. Frases generales como `revisa mi correo` no se interpretan automáticamente.

### Configuración

```env
GMAIL_READ_ENABLED=false
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REFRESH_TOKEN=
GMAIL_TIMEOUT_MS=20000
GMAIL_READ_MAX_MESSAGES=5
GMAIL_READ_MAX_REPLY_CHARS=3500
```

`GMAIL_READ_MAX_MESSAGES` acepta 1–10. Cuando la feature está habilitada se requieren las tres credenciales OAuth dedicadas.

### Patrón de API

La consulta se limita a dos operaciones GET:

1. `users.messages.list`
   - `labelIds=INBOX`;
   - opcionalmente segundo `labelIds=UNREAD`;
   - `includeSpamTrash=false`;
   - `maxResults` acotado;
   - `fields=messages(id,threadId)`;
   - nunca se envía `q`.
2. Por cada id devuelto, `users.messages.get`
   - `format=metadata`;
   - `metadataHeaders=From`;
   - `metadataHeaders=Subject`;
   - proyección estructural limitada a id/threadId/labels/internalDate/headers.

El detalle debe corresponder exactamente al id/threadId listado; una respuesta inconsistente se rechaza.

### Datos que pueden mostrarse

- fecha/hora normalizada;
- estado `UNREAD`;
- header `From`;
- header `Subject`.

Los headers son input externo no confiable. Antes de mostrarlos:

- se eliminan caracteres Unicode de control/formato (`Cc`/`Cf`), incluidos controles bidi;
- se compacta whitespace;
- `From` y `Subject` se acotan;
- la respuesta completa se limita por `GMAIL_READ_MAX_REPLY_CHARS`.

### Datos que Stage 7A NO solicita ni persiste

- body HTML/plain text;
- snippet;
- attachments;
- MIME parts;
- `format=full`;
- `format=raw`;
- búsqueda Gmail libre mediante `q`;
- historial completo;
- metadata Gmail en SQLite.

La respuesta existe únicamente en memoria durante la consulta. Audit guarda modo y conteos, no ids, remitentes ni asuntos.

### Mutaciones inexistentes

Stage 7A no implementa:

- marcar leído/no leído;
- labels;
- archive;
- trash/delete;
- spam;
- send;
- reply;
- forward;
- drafts.

Por tanto no crea `action_request`. Cualquier write de Gmail futuro deberá ser una etapa independiente, con scope y aprobación explícitos.

### Errores y OAuth

Se reutiliza el proveedor genérico de refresh token Google ya usado por Calendar, pero con credenciales Gmail separadas. En HTTP 401 se fuerza un único refresh/retry. Los errores HTTP exponen únicamente status; el body upstream no se incluye en excepciones, logs o audit.

`npm run doctor` valida configuración y reporta si la feature está activa, pero no prueba conectividad Gmail ni hace requests de red.

## Stage 7B: lectura explícita de un mensaje

Stage 7B abre un boundary adicional únicamente para leer el cuerpo de **un correo seleccionado explícitamente**. No amplía silenciosamente Stage 7A: tiene otro flag, otro refresh token y requiere un scope read-only capaz de leer el body.

Scope previsto para las credenciales dedicadas de Stage 7B:

```text
https://www.googleapis.com/auth/gmail.readonly
```

El token de `gmail.metadata` de Stage 7A puede seguir siendo mínimo. El token de body no se reutiliza para listar el inbox.

### Flujo explícito

```text
correos
#1 · 25/08 13:00 · no leído — Ana — Informe
#2 · 25/08 11:45 — Pedro — Presupuesto

correo #1
```

La numeración pertenece solo a la última lista exitosa del proceso. Los ids Gmail/thread ids se conservan **únicamente en memoria**, con TTL, y nunca se escriben en SQLite/audit. Un nuevo intento de listado invalida la selección previa; un restart también la elimina. Si la selección venció, el usuario debe ejecutar `correos` nuevamente.

No existe comando para introducir un Gmail id arbitrario.

### Configuración

```env
GMAIL_BODY_READ_ENABLED=false
GMAIL_BODY_CLIENT_ID=
GMAIL_BODY_CLIENT_SECRET=
GMAIL_BODY_REFRESH_TOKEN=
GMAIL_BODY_TIMEOUT_MS=20000
GMAIL_BODY_MAX_REPLY_CHARS=3500
GMAIL_BODY_MAX_RESPONSE_BYTES=524288
GMAIL_BODY_SELECTION_TTL_MINUTES=15
```

`GMAIL_BODY_READ_ENABLED=true` exige también `GMAIL_READ_ENABLED=true`, porque la única forma soportada de seleccionar un mensaje es mediante una lista de metadata obtenida por Stage 7A.

### Patrón de API y minimización

Para `correo #N`, Stage 7B realiza un único `users.messages.get` sobre el id exacto ya seleccionado:

- `format=full` porque Gmail requiere contenido MIME para leer el body;
- `fields` excluye headers, snippet e historial y solicita solo `id`, `threadId` y los campos MIME mínimos (`mimeType`, `filename`, `body.data/size/attachmentId`, `parts`);
- la identidad id/threadId devuelta debe coincidir con la selección;
- la respuesta HTTP tiene un techo de bytes antes de parsearse;
- se prefiere `text/plain`; solo si no existe se convierte `text/html` localmente a texto;
- el texto se sanitiza y acota antes de mostrarse.

### Adjuntos quedan fuera

Stage 7B **no llama** `users.messages.attachments.get`. Cualquier MIME part con `filename` o `attachmentId` se omite y puede indicarse al usuario como parte adjunta omitida. No se guarda ni descarga el adjunto.

### Datos que NO persisten ni salen a IA

El body:

- existe solo durante la request y composición de la respuesta;
- no se persiste en SQLite por la capa Gmail;
- la respuesta que contiene el body se marca `ephemeral`, por lo que Baileys no la guarda en su `whatsapp_message_store` local de retry/getMessage;
- el message id saliente sí puede conservarse sin contenido para prevenir loops/duplicados;
- no se indexa en FTS/embeddings;
- no se envía a IA;
- no se añade al historial de Gmail local;
- no se guarda en audit.

`ephemeral` controla únicamente persistencia local del transport. No pretende cambiar la retención propia de WhatsApp/Gmail ni la del dispositivo del usuario.

Audit conserva únicamente datos operativos no sensibles como número de selección, formato usado, truncamiento y cantidad de partes omitidas. No conserva Gmail ids/thread ids, remitente, asunto ni body.

### Sigue siendo estrictamente read-only

Stage 7B no implementa:

- mark read/unread;
- labels;
- archive/trash/delete;
- drafts;
- send/reply/forward;
- búsqueda Gmail;
- polling/background monitoring;
- attachments;
- resumen con IA.

Cualquier write futuro sigue necesitando un pipeline independiente `preview/propuesta → aprobación → ejecución`.

### Errores y doctor

401 permite un único refresh/retry. Los errores HTTP exponen únicamente status y nunca el body upstream. `npm run doctor` valida flags, dependencia de Stage 7A, credenciales y límites de Stage 7B sin conectarse a Gmail.

El QA real OAuth/API queda separado en [`QA-STAGE-7B-PENDING.md`](QA-STAGE-7B-PENDING.md). Tests automatizados no convierten esos checks live en PASS.

## Fuera de alcance de Stage 7A/7B

- descarga de adjuntos;
- búsqueda por texto/remitente/asunto mediante Gmail query;
- persistencia/indexado local de emails;
- IA sobre correos;
- resúmenes automáticos;
- polling/background monitoring;
- acciones o envíos.

Estas capacidades, si se implementan, deben abrir su propio boundary de privacidad y QA en stages posteriores.
