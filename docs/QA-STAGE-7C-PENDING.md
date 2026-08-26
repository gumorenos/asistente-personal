# QA pendiente — Stage 7C Gmail search

Los tests/CI automatizados no convierten ninguna prueba OAuth/Gmail/WhatsApp real en PASS.

## OAuth / scope — PENDING

- [ ] Crear/usar cuenta Gmail de QA con mensajes controlados y no sensibles.
- [ ] Mintar refresh token dedicado para Stage 7C con `https://www.googleapis.com/auth/gmail.readonly`.
- [ ] Confirmar que el token Stage 7C es distinto de `GMAIL_REFRESH_TOKEN` (7A) y `GMAIL_BODY_REFRESH_TOKEN` (7B).
- [ ] Confirmar que un token `gmail.metadata` no permite búsqueda con `q` y que el error queda status-only.
- [ ] Confirmar 401 real recuperable con un único refresh/retry.
- [ ] Revocar token y comprobar fallo seguro; restaurar credencial y comprobar recuperación.

## Búsquedas reales — PENDING

- [ ] `busca correos de <email>` devuelve únicamente resultados INBOX del remitente esperado.
- [ ] `busca correos de <nombre>` valida comportamiento real de Gmail para display name.
- [ ] `busca correos asunto <frase>` valida semántica de frase y metadata devuelta.
- [ ] Rango de un día en `America/Lima` incluye mensajes de todo el día local esperado.
- [ ] Rango de varios días respeta inicio inclusivo/final inclusivo del comando.
- [ ] Validar un borde cercano a medianoche local para comprobar epoch y evitar la semántica PST de fechas textuales de Gmail.
- [ ] Confirmar que spam/trash quedan fuera y que búsqueda sigue limitada a `INBOX`.
- [ ] Confirmar límite real de resultados y output bounded.

## Seguridad / minimización — PENDING

- [ ] Probar términos con comillas/backslashes/control/bidi: deben rechazarse sin request Gmail.
- [ ] Probar `busca correos q ...` y otros operadores Gmail crudos: deben rechazarse y no caer a FTS local.
- [ ] Capturar requests de QA y confirmar que `q` solo contiene los operadores generados (`from`, `subject`, `after`, `before`).
- [ ] Confirmar que detail usa `format=metadata`, nunca `full`/`raw`.
- [ ] Confirmar que no existen requests a attachments.
- [ ] Confirmar que no existen mutaciones de labels/UNREAD/archive/trash/send/draft/reply/forward.
- [ ] Revisar SQLite: resultados Gmail/ids/thread ids/From/Subject no se guardan por Stage 7C.
- [ ] Revisar `whatsapp_message_store`: respuesta de resultados no conserva el payload metadata.
- [ ] Revisar audit: no término, fechas exactas, ids, From ni Subject.
- [ ] Confirmar que no se invoca AI/transcription/embeddings/document Q&A.
- [ ] Confirmar Observer isolation: chats observados no pueden disparar Gmail search.

## WhatsApp live — PENDING

- [ ] Ejecutar los tres comandos soportados desde self-chat real.
- [ ] Confirmar que terceros/grupos no obtienen respuesta ni acceso Gmail.
- [ ] Confirmar output legible y acotado con subjects/remitentes adversariales.
- [ ] Restart del proceso: ninguna metadata de resultados se recupera como estado Gmail.

## Criterio de cierre live

Stage 7C puede cerrarse live solo con evidencia reproducible de los checks aplicables. Hasta entonces: **código/CI automatizado sujeto a gate + QA OAuth/Gmail/WhatsApp real pendiente**.
