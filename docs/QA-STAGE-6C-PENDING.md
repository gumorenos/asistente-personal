# QA pendiente — Stage 6C lifecycle de compromisos

Updated: 2026-08-24 (America/Lima)

Stage 6C agrega vistas temporales locales y reprogramación explícita de compromisos. No agrega migración, flag, scheduler, IA, Observer, Calendar, transcripción ni acciones externas.

## Gate automatizado

- [x] TypeScript strict PASS en Node 22.18.
- [x] Suite completa tras hardening: 279/279 PASS.
- [x] Runtime dependency audit: 0 vulnerabilidades.
- [x] Rango temporal del repositorio usa inicio inclusivo / fin exclusivo.
- [x] Vistas temporales excluyen compromisos completados/cancelados.
- [x] `compromisos hoy` usa límites locales `America/Lima`.
- [x] `compromisos semana` / `esta semana` usa semana local lunes→lunes.
- [x] `compromisos sin fecha` devuelve solo abiertos sin `due_at` y en orden determinista.
- [x] Vistas compactan bodies largos y respuesta total queda <=3500 caracteres.
- [x] Reprogramación exige fecha/hora futura interpretable.
- [x] Reprogramación solo modifica un compromiso `open`.
- [x] Completados/cancelados no se reabren implícitamente.
- [x] Reprogramar a un vencimiento distinto limpia `notified_at` cuando corresponde.
- [x] Reprogramar al mismo vencimiento es no-op, conserva `notified_at` y no genera audit de reprogramación.
- [x] Audit de reprogramación efectiva no contiene body ni nueva fecha exacta.
- [x] Wiring real: `CommitmentCapability` delega comandos Stage 6C antes del handling legacy.
- [x] Stage 6C no crea `action_request`.
- [ ] Docker `linux/amd64` PASS en HEAD documental final.
- [ ] Docker `linux/arm64` PASS en HEAD documental final.

## QA funcional live — PENDIENTE

Puede hacerse desde el self-chat autorizado; no requiere proveedores externos salvo para validar interacción con notificaciones 6B.

- [ ] Crear varios compromisos: vencido hoy, futuro hoy, mañana, fin de semana, próxima semana y sin fecha.
- [ ] `compromisos hoy` muestra solamente los abiertos cuyo vencimiento cae en el día local actual.
- [ ] `compromisos semana` incluye abiertos de la semana local actual y excluye el límite exacto del lunes siguiente.
- [ ] `compromisos sin fecha` muestra solo abiertos sin fecha.
- [ ] Completar/cancelar un compromiso lo elimina de las vistas abiertas correspondientes.
- [ ] `reprograma compromiso #N mañana a las 10` conserva el body y cambia solo el vencimiento/metadata operacional.
- [ ] `mueve compromiso #N <fecha>` funciona como alias explícito.
- [ ] Fecha pasada/inválida no modifica el compromiso.
- [ ] ID inexistente devuelve error local y no crea estado nuevo.
- [ ] Intentar reprogramar `completed`/`cancelled` no lo reabre.
- [ ] Reprogramar al mismo vencimiento conserva el estado de notificación y responde que ya estaba programado.
- [ ] Reinicio/reboot conserva el nuevo vencimiento.
- [ ] Las vistas siguen correctas alrededor de medianoche America/Lima.
- [ ] Verificar cambio domingo→lunes para límites semanales.
- [ ] Con bodies largos, las respuestas siguen legibles y no exceden el límite esperado.

## Interacción Stage 6B — PENDIENTE

Solo si se habilitan notificaciones en la línea WhatsApp QA.

- [ ] Un compromiso ya notificado y luego reprogramado a un vencimiento distinto queda con `notified_at=NULL`.
- [ ] Reprogramarlo a futuro NO dispara aviso inmediatamente.
- [ ] Al alcanzar el nuevo vencimiento recibe una notificación normal de 6B.
- [ ] Después de esa entrega vuelve a quedar marcado y no se repite en steady state.
- [ ] Reprogramar un compromiso ya notificado al mismo vencimiento NO lo rearma ni causa duplicado.
- [ ] Reprogramar mientras el scheduler procesa otros compromisos no genera una entrega con el vencimiento viejo después de que la actualización sea visible.
- [ ] Revisar nuevamente el crash-window documentado de 6B; Stage 6C no lo elimina.

## Seguridad / privacidad — PENDIENTE

- [ ] Confirmar logs sin body ni fecha exacta de reprogramación.
- [ ] Confirmar audit `commitment.rescheduled` con id + flags estructurales solamente.
- [ ] Confirmar que Observer no puede invocar estos comandos ni crear/reprogramar compromisos.
- [ ] Confirmar cero tráfico AI/Calendar/transcripción por vistas/reprogramación.
- [ ] Confirmar cero `action_request` después de ejecutar todos los comandos 6C.

## Fuera de alcance

- Detección automática de promesas.
- Reapertura automática de compromisos completados/cancelados.
- Snooze automático.
- Repetición periódica/escalamiento.
- Extracción de compromisos desde Observer.
- Mensajes a terceros.

## Condición de cierre

Stage 6C puede considerarse cerrado a nivel de código cuando el HEAD final tenga suite/typecheck/audit + Docker AMD64/ARM64 verdes. El QA live de timezone/restart y la interacción real con las notificaciones 6B debe permanecer PENDIENTE hasta ejecutarse con evidencia real.
