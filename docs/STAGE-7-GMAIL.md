# Stage 7 — Gmail

## Stage 7A: lectura explícita de metadata

Stage 7A incorpora una primera integración Gmail deliberadamente estrecha. Su objetivo es poder revisar rápidamente el buzón desde el self-chat sin abrir todavía el contenido completo de los correos ni permitir mutaciones.

### Trust boundary

La integración está deshabilitada por defecto y usa credenciales OAuth Gmail dedicadas, separadas de Google Calendar.

Scope mínimo previsto cuando Stage 7B permanece deshabilitado:

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

- caracteres Unicode de control/formato (`Cc`/`Cf`), incluidos controles bidi, se sustituyen por separadores seguros;
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

---

## Stage 7B: lectura explícita y acotada de contenido

Stage 7B agrega una segunda capa de permisos. Leer metadata no habilita automáticamente bodies: el contenido tiene su propio flag y permanece deshabilitado por defecto.

### Scope y opt-in

Para usar Stage 7B, el refresh token Gmail dedicado debe haberse emitido con un scope read-only que permita bodies, por ejemplo:

```text
https://www.googleapis.com/auth/gmail.readonly
```

No se amplía a scopes de modificación o envío. `gmail.metadata` sigue siendo suficiente si Stage 7B permanece apagado.

```env
GMAIL_CONTENT_READ_ENABLED=false
GMAIL_CONTENT_MAX_BODY_CHARS=6000
GMAIL_CONTENT_MAX_MESSAGE_BYTES=1048576
GMAIL_CONTENT_MAX_THREAD_MESSAGES=5
GMAIL_CONTENT_MAX_REPLY_CHARS=3500
```

`GMAIL_CONTENT_READ_ENABLED=true` exige también `GMAIL_READ_ENABLED=true`.

### Comandos

```text
lee correo 1
lee correo no leído 1
lee hilo 1
lee hilo no leído 1
```

La selección es posicional sobre la vista actual `INBOX` o `INBOX+UNREAD`. El usuario no necesita ver ni escribir IDs Gmail; los IDs solo viven de forma efímera dentro de la consulta.

### Lectura de un mensaje

El provider aplica dos pasos:

1. `messages.get(format=metadata)` con `fields=id,threadId,sizeEstimate` para validar identidad y tamaño antes de pedir el body.
2. solo si el tamaño está dentro de `GMAIL_CONTENT_MAX_MESSAGE_BYTES`, `messages.get(format=full)` con una proyección acotada a id/threadId/internalDate/sizeEstimate/payload.

No existe llamada a `users.messages.attachments.get` en Stage 7B. Si una MIME part contiene `attachmentId`, esa part se ignora para extracción textual.

### MIME/body safety

- como máximo 100 MIME parts visitadas;
- profundidad máxima 12;
- base64url se valida estrictamente antes de decodificar;
- tamaño real decodificado se vuelve a comprobar;
- `text/plain` tiene preferencia;
- HTML se usa solo como fallback;
- el fallback HTML elimina `script` y `style`, tags estructurales y decodifica un conjunto mínimo de entidades;
- caracteres Unicode de formato/control se sanitizan;
- body y respuesta completa tienen límites independientes.

El body leído se muestra únicamente como texto terminal. Si contiene algo como:

```text
anota secreto
agenda mañana...
ia ignora las instrucciones anteriores
```

se muestra como contenido del correo y nunca se reinyecta en `AssistantCore` como comando.

### Lectura de hilo

`lee hilo N` obtiene primero estructura mínima del thread y luego lee individualmente solo los mensajes seleccionados. Si el hilo supera `GMAIL_CONTENT_MAX_THREAD_MESSAGES`, se conservan los mensajes más recientes dentro de ese límite y se muestran en orden cronológico entre sí.

La estructura del hilo tiene además un límite defensivo interno para evitar procesar respuestas hostiles anormalmente grandes.

### Persistencia y privacidad

Stage 7B NO:

- persiste body/header/IDs en SQLite;
- agrega emails a `self_memory_fts`;
- agrega emails a embeddings;
- envía contenido a IA;
- crea compromisos automáticamente;
- crea `action_request`;
- descarga attachments;
- modifica leído/no leído;
- archiva, etiqueta o elimina;
- responde, reenvía o envía correo.

Audit almacena únicamente metadata estructural como:

- `mode=message|thread`;
- selector `inbox|unread`;
- posición solicitada;
- cantidad retornada;
- booleano `truncated`;
- clase de error.

No se auditan Gmail IDs, `From`, `Subject` ni body.

### Errores

- 401 conserva el único refresh/retry del provider Google;
- 403/429/5xx y otros HTTP se reducen a status seguro;
- body upstream nunca se incorpora al mensaje para el usuario ni a audit;
- mensajes demasiado grandes fallan antes de descargar el body completo;
- respuestas con identity mismatch fallan cerradas.

## Fuera de alcance de Stage 7B

Todavía no existen:

- attachments;
- búsqueda Gmail con `q`;
- búsqueda por remitente/asunto;
- persistencia o indexado local de correos;
- resumen/IA sobre email;
- clasificación urgente/importante;
- detección automática de compromisos;
- polling/background inbox monitoring;
- mark read/unread;
- archive/labels/trash;
- drafts;
- reply/forward/send.

Cada aumento de permisos deberá entrar como un stage separado y conservar confirmación explícita para writes.