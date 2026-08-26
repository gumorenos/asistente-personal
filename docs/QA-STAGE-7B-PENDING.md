# QA pendiente — Stage 7B Gmail content read

Estado: desarrollo/CI automatizado en curso. Este archivo contiene solo los checks que deben conservarse como fuente de verdad hasta realizar QA independiente con credenciales Gmail QA reales.

## Reglas

- No usar una cuenta Gmail crítica si no existe autorización explícita.
- Preferir una cuenta/buzón QA con mensajes sintéticos.
- No habilitar scopes de modificación o envío.
- Scope mínimo esperado para Stage 7B: `https://www.googleapis.com/auth/gmail.readonly`.
- No modificar correo, labels, leído/no leído, archive, trash ni drafts durante este QA.
- No introducir bodies/headers/IDs reales en commits, logs o artifacts permanentes.

## Gate automatizado

- [ ] `npm ci --no-audit --no-fund`
- [ ] `npm run check`
- [ ] TypeScript strict PASS
- [ ] suite completa PASS
- [ ] `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades
- [ ] Docker linux/amd64 PASS + PDF/OCR smoke
- [ ] Docker linux/arm64 PASS + PDF/OCR smoke

## Config / scopes

- [ ] `GMAIL_CONTENT_READ_ENABLED=false` por defecto.
- [ ] no puede habilitarse si `GMAIL_READ_ENABLED=false`.
- [ ] Stage 7A con token `gmail.metadata` sigue funcionando cuando content read está apagado.
- [ ] con content read encendido y token únicamente `gmail.metadata`, la lectura de body falla de forma segura y sin filtrar body upstream.
- [ ] con token dedicado `gmail.readonly`, metadata + body read funcionan.
- [ ] confirmar en Google que el token QA no incluye scopes de modify/send innecesarios.
- [ ] `npm run doctor` valida config local y no hace requests Gmail.

## Message read real

Usar mensajes sintéticos que cubran:

- [ ] plain text simple.
- [ ] HTML-only simple.
- [ ] multipart/alternative: se prefiere `text/plain`.
- [ ] header From/Subject con caracteres Unicode bidi/control: salida segura.
- [ ] body largo: truncado según `GMAIL_CONTENT_MAX_BODY_CHARS` y reply total.
- [ ] correo cuyo `sizeEstimate` supera `GMAIL_CONTENT_MAX_MESSAGE_BYTES`: rechazo antes del `format=full`.
- [ ] confirmar mediante proxy/fake endpoint o trazas sanitizadas que el preflight ocurre antes del full fetch.
- [ ] mensaje cuyo body contiene texto tipo `anota`, `agenda`, `ia`: se devuelve como texto y no crea nota/action/AI call.

## Thread read real

- [ ] hilo corto de 2–3 mensajes.
- [ ] hilo mayor que `GMAIL_CONTENT_MAX_THREAD_MESSAGES`: solo los más recientes dentro del límite.
- [ ] los mensajes seleccionados se muestran en orden cronológico entre sí.
- [ ] thread con mensaje demasiado grande dentro de los seleccionados: fail closed.
- [ ] identity mismatch simulado/inyectado: fail closed.

## Attachments / MIME boundary

- [ ] email con PDF adjunto y body text: body se lee, attachment no se descarga.
- [ ] email cuyo contenido relevante existe únicamente como attachment: Stage 7B no descarga attachment.
- [ ] confirmar cero requests a `users.messages.attachments.get`.
- [ ] MIME profundamente anidado dentro del límite funciona.
- [ ] estructura MIME que exceda depth/part limit falla de forma segura.
- [ ] base64url inválido falla sin decode permisivo ni persistencia parcial.

## Network / OAuth failures

- [ ] 401: un refresh forzado + un retry máximo.
- [ ] 403: error seguro.
- [ ] 429: error seguro.
- [ ] 500/503: error seguro.
- [ ] timeout: error seguro.
- [ ] cuerpo JSON/texto de error upstream nunca aparece en respuesta, logs o audit.

## Privacidad / persistencia

Con tokens sintéticos únicos en From, Subject, body, message ID y thread ID:

- [ ] `audit_log` no contiene ninguno de esos tokens.
- [ ] logs no contienen body/From/Subject/Gmail IDs.
- [ ] SQLite DB/WAL/SHM no contiene body/header/IDs por efecto de Stage 7B.
- [ ] `self_memory_fts` no contiene contenido Gmail.
- [ ] `observation_fts` no contiene contenido Gmail.
- [ ] embeddings/document chunks no contienen contenido Gmail.
- [ ] backup de assistant.db no introduce contenido Gmail leído efímeramente.

## No-mutación

Antes y después de los reads reales, verificar en Gmail:

- [ ] estado leído/no leído idéntico.
- [ ] labels idénticas.
- [ ] Inbox/archive idéntico.
- [ ] cero mensajes enviados.
- [ ] cero drafts creados.
- [ ] cero deletes/trash.

## WhatsApp live — solo con sesión QA autorizada

Si existe una sesión WhatsApp QA autorizada:

- [ ] `correos` lista metadata.
- [ ] `lee correo 1` devuelve body acotado.
- [ ] `lee correo no leído 1` usa la vista UNREAD correcta.
- [ ] `lee hilo 1` devuelve hilo acotado.
- [ ] body que contiene comandos sigue siendo terminal.
- [ ] no aparece echo loop ni reply a terceros.

Si no existe sesión QA autorizada: marcar este bloque `BLOCKED`, no hacer pairing nuevo por iniciativa propia.

## Recursos

Con un mensaje pequeño y un hilo sintético de 5–10 mensajes:

- [ ] latencia aproximada.
- [ ] RSS/RAM aproximada si es sencillo medirla.
- [ ] confirmar que DB no crece materialmente por los reads.

## Criterio de cierre

Stage 7B puede considerarse QA live cerrado cuando los checks aplicables anteriores estén PASS y cualquier BLOCKED quede justificado. Un PASS de CI no sustituye OAuth/Gmail real ni WhatsApp live.