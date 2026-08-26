# QA pendiente — Stage 7B Gmail message read

Stage 7B tiene cobertura automatizada, pero **ningún punto live/OAuth de este documento debe marcarse PASS por tests unitarios o CI**.

## Boundary a validar

- Stage 7A continúa usando su token dedicado con `gmail.metadata`.
- Stage 7B usa credenciales/token dedicados con `gmail.readonly` y `GMAIL_BODY_READ_ENABLED=false` por defecto.
- Stage 7B solo abre un correo previamente seleccionado por número desde la última lista efímera.
- No hay persistencia local intencional de Gmail ids/thread ids/body; las respuestas con body omiten el retry store local de Baileys.
- No hay IA, attachments ni mutaciones.

## OAuth / Gmail API real — PENDING

- [ ] Crear/usar cuenta Gmail QA con corpus no sensible y mensajes controlados.
- [ ] Verificar token Stage 7A con scope mínimo `https://www.googleapis.com/auth/gmail.metadata`.
- [ ] Verificar token Stage 7B separado con scope `https://www.googleapis.com/auth/gmail.readonly`.
- [ ] Confirmar que Stage 7A funciona con Stage 7B deshabilitado.
- [ ] Confirmar que `GMAIL_BODY_READ_ENABLED=true` con token metadata-only falla de forma segura y no filtra body de error upstream.
- [ ] Revocar/invalidar token Stage 7B y comprobar error seguro + recovery después de restaurar credencial válida.
- [ ] Provocar un 401 recuperable y comprobar un único refresh/retry real.

## Contenido MIME real — PENDING

- [ ] `text/plain` simple: `correos` → `correo #N` devuelve el cuerpo esperado.
- [ ] `text/html` sin plain: conversión local legible, sin HTML/script/style visible.
- [ ] `multipart/alternative`: se prefiere `text/plain`.
- [ ] MIME anidado/multipart real: cuerpo textual correcto y acotado.
- [ ] Correo con PDF/imagen adjunta: el cuerpo se lee pero el adjunto no se descarga.
- [ ] Confirmar en trazas/proxy controlado que no existe request a `users.messages.attachments.get`.
- [ ] Mensaje suficientemente grande para comprobar límites de respuesta/output sin OOM ni contenido ilimitado.

## Selección efímera — PENDING

- [ ] `correos` muestra índices `#1..#N` y `correo #N` abre exactamente el elemento seleccionado.
- [ ] `correo #N` sin listado previo exige volver a listar y no llama Gmail body API.
- [ ] Índice fuera de rango no hace request de body.
- [ ] Esperar el TTL y confirmar que la selección expira.
- [ ] Reiniciar el proceso y confirmar que la selección desaparece; no hay recuperación desde SQLite.
- [ ] Un nuevo intento de `correos` invalida el mapa anterior, incluso si el nuevo listado falla.

## No mutación / privacidad — PENDING

- [ ] Comparar labels/UNREAD antes y después de `correo #N`: ninguna modificación.
- [ ] Confirmar que no se crean `action_requests`.
- [ ] Confirmar que no hay requests de send/reply/draft/modify/archive/trash/delete.
- [ ] Revisar SQLite después de lectura: body y Gmail id/thread id no aparecen por efecto de Stage 7B.
- [ ] Revisar `whatsapp_message_store`: la respuesta saliente que contiene el body no queda almacenada; solo permanece el marker/id outbound sin contenido necesario para loop protection.
- [ ] Revisar audit real: solo selection/format/truncated/omittedParts/errorType; sin body/remitente/asunto/Gmail ids.
- [ ] Confirmar que no se invoca proveedor AI/transcription/embeddings/document Q&A.
- [ ] Confirmar que Observer no puede disparar `correo #N` porque su ruta sigue separada del AssistantCore.

## WhatsApp live — PENDING

Cuando exista la línea QA dedicada y el core esté corriendo con sesión autorizada:

- [ ] Ejecutar `correos` desde self-chat real y luego `correo #N`.
- [ ] Verificar respuesta acotada en WhatsApp con plain, HTML y adjuntos.
- [ ] Verificar que terceros/grupos no obtienen respuesta ni acceso Gmail.
- [ ] Restart de Baileys/app: auth WhatsApp persiste, selección Gmail no persiste.
- [ ] Forzar/reproducir un retry de una respuesta ephemeral y documentar el comportamiento aceptado: Stage 7B prioriza no persistir el body localmente sobre disponer de payload para reenvío vía `getMessage`.

## Criterio de cierre live

Stage 7B puede considerarse validado live solo cuando los checks relevantes anteriores tengan evidencia reproducible. Hasta entonces, el estado correcto es **código/CI automatizado sujeto a gate + QA OAuth/Gmail/WhatsApp real pendiente**.
