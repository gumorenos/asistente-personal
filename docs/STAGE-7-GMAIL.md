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

## Fuera de alcance de Stage 7A

- lectura del body;
- descarga de adjuntos;
- búsqueda por texto/remitente/asunto mediante Gmail query;
- persistencia/indexado local de emails;
- IA sobre correos;
- resúmenes automáticos;
- polling/background monitoring;
- acciones o envíos.

Estas capacidades, si se implementan, deben abrir su propio boundary de privacidad y QA en stages posteriores.