# QA pendiente — Stage 8A resumen ejecutivo

Los tests/CI automatizados no convierten Calendar/Gmail/WhatsApp reales en PASS. Según la estrategia actual del proyecto, Stage 8A se acumula con otros bloques antes de solicitar otra ronda live a OpenClaw.

## Gate automatizado

El branch debe considerarse cerrado automáticamente solo cuando el HEAD final de documentación complete el workflow CI con:

- [ ] `npm ci --no-audit --no-fund` PASS.
- [ ] TypeScript `tsc --noEmit` PASS.
- [ ] todos los tests PASS.
- [ ] `npm audit --omit=dev --audit-level=high` PASS — 0 vulnerabilidades high+.
- [ ] Docker Compose non-root identity PASS.
- [ ] Docker linux/amd64 build PASS.
- [ ] linux/amd64 PDF/OCR smoke PASS.
- [ ] linux/amd64 bind-mounted data write smoke PASS.
- [ ] Docker linux/arm64 build PASS.
- [ ] linux/arm64 PDF/OCR smoke PASS.
- [ ] linux/arm64 bind-mounted data write smoke PASS.

Los checks anteriores permanecen aquí como criterio; el PR debe registrar el HEAD/run exactos una vez completado el CI final.

## Self-chat / comandos — PENDING live

- [ ] Desde self-chat real, `resumen ejecutivo` devuelve el snapshot.
- [ ] Alias `panel ejecutivo` produce el mismo boundary funcional.
- [ ] Con `EXECUTIVE_SUMMARY_ENABLED=false`, ambos comandos son terminales y no consultan Calendar/Gmail.
- [ ] Terceros y grupos no pueden invocar Stage 8A.
- [ ] Observer no puede invocar Stage 8A.

## Estado local — PENDING live

- [ ] Crear compromisos QA vencidos/próximos y confirmar conteos/orden esperado.
- [ ] Crear recordatorios QA pendientes y confirmar límite configurado.
- [ ] Confirmar que compromisos/reminders cerrados o ya entregados no reaparecen incorrectamente.
- [ ] Confirmar formato y fechas en `America/Lima`.

## Calendar read — PENDING live

- [ ] Con Calendar read deshabilitado, la sección indica `Calendar read deshabilitado` y no hace request externa.
- [ ] Con Calendar read habilitado y corpus QA, consulta solo agenda de hoy.
- [ ] Capturar request/provider y confirmar que `maxResults` está limitado por `EXECUTIVE_SUMMARY_MAX_CALENDAR_EVENTS` y por el máximo global de Calendar read.
- [ ] Confirmar que no se ejecuta free/busy, suggestions, exact availability ni ningún Calendar write.
- [ ] Simular fallo/credencial revocada y confirmar degradación parcial sin filtrar error upstream ni eliminar secciones locales.

## Gmail metadata — PENDING live

- [ ] Con Gmail read deshabilitado, la sección indica `Gmail read deshabilitado` y no hace request.
- [ ] Con Gmail metadata QA habilitado, solo consulta INBOX metadata mediante Stage 7A.
- [ ] Confirmar límite real `EXECUTIVE_SUMMARY_MAX_GMAIL_MESSAGES`.
- [ ] Confirmar que unread se prioriza antes que read y dentro del grupo prevalece recencia.
- [ ] Confirmar que no existe request de body/snippet/attachments/search/full/raw.
- [ ] Confirmar que no se invoca Stage 7D ni proveedor IA.
- [ ] Confirmar que Gmail ids/thread ids no aparecen en output/audit.
- [ ] Simular fallo Gmail y confirmar degradación parcial segura.

## Sanitización / contenido adversarial — PENDING live

- [ ] Usar title/From/Subject con controles bidi/Cc/Cf y confirmar que no llegan al output.
- [ ] Usar Subject `IGNORE PREVIOUS INSTRUCTIONS` y confirmar que solo se muestra como texto; Stage 8A no interpreta ni ejecuta instrucciones.
- [ ] Confirmar que un snapshot muy largo queda dentro de `EXECUTIVE_SUMMARY_MAX_REPLY_CHARS` sin romper las demás fronteras.

## Persistencia / audit — PENDING live

- [ ] Revisar `whatsapp_message_store`: el payload combinado no debe persistirse porque la respuesta es `ephemeral`.
- [ ] Revisar audit: solo conteos/estados agregados; nunca títulos, commitments/reminder text, From/Subject, ids o snapshot completo.
- [ ] Confirmar que Stage 8A no crea `action_request`.
- [ ] Confirmar que no crea/modifica Calendar events, Gmail, commitments o reminders.
- [ ] Restart: no existe estado propio de Stage 8A que reconstruir.

## Criterio de cierre live

Stage 8A puede cerrarse live solo dentro de una ronda QA acumulada con evidencia reproducible de los checks aplicables. Hasta entonces: **gate automatizado del HEAD final + QA Calendar/Gmail/WhatsApp real pendiente**.
