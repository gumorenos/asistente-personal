# Stage 7C — búsqueda estructurada de Gmail

Stage 7C añade búsqueda explícita de correo sin ampliar silenciosamente Stage 7A ni convertir Gmail en una fuente global del asistente.

## Boundary de OAuth

La búsqueda está deshabilitada por defecto:

```env
GMAIL_SEARCH_ENABLED=false
```

Usa credenciales dedicadas:

```env
GMAIL_SEARCH_CLIENT_ID=
GMAIL_SEARCH_CLIENT_SECRET=
GMAIL_SEARCH_REFRESH_TOKEN=
```

Scope previsto:

```text
https://www.googleapis.com/auth/gmail.readonly
```

La razón para no reutilizar el token `gmail.metadata` de Stage 7A es funcional y de privacidad: Gmail no permite usar el parámetro `q` con `gmail.metadata`. El refresh token de búsqueda debe ser distinto tanto del token metadata-only de 7A como del token body-read de 7B. El OAuth client puede ser el mismo; el grant/token no.

## Comandos soportados

```text
busca correos de ana@example.com
busca correos asunto presupuesto anual
busca correos desde 2026-08-01 hasta 2026-08-25
```

La primera versión admite una sola condición estructurada por comando:

- remitente (`from`);
- frase de asunto (`subject`);
- rango de fechas inclusivo en `APP_TIMEZONE`.

No se acepta `q` crudo ni sintaxis arbitraria de Gmail. Todo comando que empiece por `busca correos` pertenece a esta capability: si no coincide con la gramática permitida se rechaza y no cae accidentalmente a FTS local.

## Construcción de query

La capability produce un filtro tipado. Solo el provider lo convierte a Gmail `q`:

- remitente → `from:"..."`;
- asunto → `subject:"..."`;
- fechas → `after:<epoch> before:<epoch>`.

Los términos no pueden contener comillas, backslashes, controles Unicode ni bidi formatting y tienen longitud acotada.

Para fechas no se usan cadenas `YYYY/MM/DD` directamente en Gmail porque Gmail interpreta esas fechas a medianoche PST. Stage 7C convierte medianoches locales de `APP_TIMEZONE` a Unix epoch. `desde` es inclusivo y `hasta` incluye todo ese día; internamente `before` usa la medianoche local del día siguiente. El rango está acotado por `GMAIL_SEARCH_MAX_DATE_RANGE_DAYS`.

## Datos consultados

La búsqueda usa:

1. `users.messages.list`
   - `labelIds=INBOX`;
   - `includeSpamTrash=false`;
   - `maxResults` acotado;
   - `fields=messages(id,threadId)`;
   - `q` generado internamente desde el filtro tipado.
2. `users.messages.get` por cada resultado
   - `format=metadata`;
   - `metadataHeaders=From`;
   - `metadataHeaders=Subject`;
   - id/threadId/labels/internalDate/headers solamente.

No solicita body, snippet, attachments, `format=full` ni `format=raw`.

## Persistencia y audit

Los resultados se muestran como metadata y no se guardan en una tabla Gmail ni se indexan. La respuesta saliente se marca `ephemeral`, por lo que From/Subject no entran en el `whatsapp_message_store` local de retry/getMessage.

Audit guarda únicamente:

- tipo de filtro (`from`, `subject`, `date_range`);
- número solicitado;
- número devuelto;
- tipo de error cuando falla.

Audit no guarda término buscado, rango exacto, ids Gmail, thread ids, From ni Subject.

El texto del comando enviado por el propio usuario sigue la política normal del self-chat y puede existir como mensaje local del asistente. Stage 7C no afirma que el input del usuario sea efímero; la minimización aplica a contenido recuperado desde Gmail y a audit.

## No selección de body implícita

Los resultados de búsqueda no se numeran para `correo #N`. Stage 7B conserva su propia selección efímera obtenida mediante `correos`. 7C no abre un canal indirecto para leer bodies ni comparte ids silenciosamente con 7B.

Si posteriormente se desea abrir un resultado buscado, deberá diseñarse una selección compartida explícita y con tests de boundary.

## No mutaciones / no IA

Stage 7C no implementa:

- mark read/unread;
- labels;
- archive/trash/delete;
- drafts/send/reply/forward;
- attachments;
- polling;
- persistencia/indexado de Gmail;
- IA, resumen ni priorización.

`npm run doctor` valida localmente flags, credenciales, límites y separación de refresh tokens sin conectarse a Gmail. El QA real queda en `docs/QA-STAGE-7C-PENDING.md`.
