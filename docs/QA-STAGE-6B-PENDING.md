# QA pendiente — Stage 6B notificaciones de compromisos

Updated: 2026-08-24 (America/Lima)

Stage 6B agrega notificación opt-in al self-chat cuando un compromiso explícito ya venció. **No agrega detección automática de promesas**, no usa Observer, IA ni Calendar, y no envía a terceros.

## Gate automatizado — PASS

Evidencia funcional previa al cierre documental: CI #511, Node 22.18, **268/268 tests PASS**, runtime audit 0 vulnerabilidades, Docker AMD64 + ARM64 build/smoke PASS.

- [x] TypeScript strict PASS en Node 22.18.
- [x] Suite completa PASS.
- [x] Runtime dependency audit sin vulnerabilidades high+.
- [x] Docker `linux/amd64` build + smoke PDF/OCR PASS.
- [x] Docker `linux/arm64` build + smoke PDF/OCR PASS.
- [x] Migración v17 agrega `notified_at` e índice de cola y es idempotente.
- [x] Feature deshabilitada por defecto.
- [x] Habilitar exige `WHATSAPP_ENABLED=true`.
- [x] Destino es obligatorio al habilitar y debe pertenecer exactamente a `WHATSAPP_SELF_JIDS`.
- [x] JIDs de grupo/malformados se rechazan.
- [x] Cola incluye solo compromisos `open`, con vencimiento `<= now` y `notified_at IS NULL`.
- [x] Futuros, sin fecha, completados, cancelados y ya notificados quedan fuera.
- [x] En estado normal un vencimiento exitoso se envía una vez y luego queda marcado `notified_at`.
- [x] Fallo de `sendText()` no marca entrega y permite retry posterior.
- [x] El audit de éxito guarda solo id/evento, no body ni fecha exacta.
- [x] Logs de error no guardan body ni mensaje privado del error.
- [x] Batch máximo 20 y orden determinista por vencimiento/id.
- [x] `runOnce()` solapado se suprime dentro de la misma instancia.
- [x] Antes de cada envío se revalida status/due/notified para reducir filas stale del batch.
- [x] Crear/listar/notificar compromisos no crea `action_request`.
- [x] Backup verifica schema v17 y conserva `notified_at`.
- [x] `doctor` exige schema v17 y valida config Stage 6B sin hacer tráfico WhatsApp.

Los checks automatizados no sustituyen los siguientes checks live/operativos.

## WhatsApp live — PENDIENTE

Requiere línea/sesión WhatsApp QA autorizada.

- [ ] Con `COMMITMENT_NOTIFICATIONS_ENABLED=false`, un compromiso que vence no genera mensaje automático.
- [ ] Con feature habilitada y destino self allowlisted, un compromiso vencido genera exactamente un mensaje en operación normal.
- [ ] La notificación llega únicamente al self-chat configurado.
- [ ] El texto incluye id + body del compromiso correcto.
- [ ] Reinicio después de una entrega exitosa no vuelve a notificar el mismo compromiso.
- [ ] Caída/red offline antes del envío deja el compromiso elegible y retry posterior entrega una vez.
- [ ] Completar/cancelar antes del vencimiento impide notificación.
- [ ] Completar/cancelar un compromiso vencido antes del próximo ciclo impide notificación.
- [ ] Observer/chats de terceros/grupos no pueden configurar destinos ni disparar notificaciones.
- [ ] No aparece tráfico AI/Calendar/transcripción por Stage 6B.
- [ ] Restart/reboot conserva `notified_at` y no reenvía entregados.

## Operación / persistencia — PENDIENTE

- [ ] Migrar copia de DB v16 real a v17 y verificar datos/FTS sin pérdida.
- [ ] Reabrir/reiniciar varias veces y confirmar una sola fila `schema_migrations=17`.
- [ ] `npm run doctor` en host objetivo reporta schema v17 y feature disabled/enabled correctamente.
- [ ] Backup + restore conserva `notified_at`; tras restore no reenvía notificados.
- [ ] Probar backlog >20: se drena por batches sin saltarse compromisos ni crecer memoria anormalmente.
- [ ] Medir CPU/RAM/DB durante operación normal.
- [ ] Verificar SIGTERM: scheduler se detiene limpiamente.

## Semántica de entrega / riesgo conocido

WhatsApp/Baileys no ofrece aquí un idempotency key de aplicación que garantice exactly-once. El flujo es:

1. leer compromiso elegible;
2. enviar por WhatsApp;
3. persistir `notified_at`.

Existe un **crash-window** si el proceso muere después de que WhatsApp aceptó el envío pero antes de persistir `notified_at`: tras reinicio podría reenviar. Stage 6B promete una sola entrega en estado normal + retry ante fallo, **no exactly-once ante crash distribuido**.

QA pendiente específico:

- [ ] Intentar reproducir de forma controlada el crash-window y documentar comportamiento real.
- [ ] Decidir después del QA si el riesgo es aceptable para uso personal o si se necesita un ledger/estrategia adicional antes de activar Stage 6B permanentemente.

## Fuera de alcance de Stage 6B

- Detección automática de compromisos/promesas desde mensajes.
- Lectura de Observer para crear compromisos.
- Mensajes a terceros.
- Escalamiento/repeticiones periódicas del mismo compromiso.
- Snooze/reprogramación automática.
- Exactly-once distribuido frente a caída entre ACK remoto y commit local.

## Condición de cierre

No activar Stage 6B para uso diario hasta tener QA con línea WhatsApp dedicada + persistencia/restart + retry offline y revisar explícitamente el crash-window documentado.
