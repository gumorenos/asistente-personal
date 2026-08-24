# QA pendiente — Stage 6A compromisos personales locales

Updated: 2026-08-24 (America/Lima)

Stage 6A agrega tracking explícito de compromisos personales en el self-chat. Es una base segura para un futuro promise detector, pero **NO detecta promesas automáticamente**, no lee Observer para inferir compromisos y no envía recordatorios/notificaciones por sí solo.

## Gate automatizado — PASS en CI #477

Sobre HEAD de código `614519992c348fea7dd4f438c00c7936bd5c70b0`:

- [x] TypeScript strict PASS en Node 22.18.
- [x] Suite completa: **258/258 tests PASS**.
- [x] Runtime dependency audit: **0 vulnerabilidades**.
- [x] Docker `linux/amd64` PASS + smoke PDF/OCR.
- [x] Docker `linux/arm64` PASS + smoke PDF/OCR.
- [x] Migración v16 instala `commitments`, índice y triggers FTS.
- [x] Migración v16 es idempotente en reinicios; reejecutarla no duplica migration row ni FTS.
- [x] Body vacío/>2000 chars y due date inválido se rechazan.
- [x] `compromiso` vacío se maneja explícitamente sin persistencia.
- [x] `compromiso mañana a las 10 ...` reutiliza parser timezone-aware y persiste fecha futura correcta.
- [x] Compromiso sin fecha se persiste sin vencimiento.
- [x] Fecha explícita inválida/pasada no se degrada silenciosamente a compromiso sin fecha.
- [x] `open -> completed/cancelled` es una transición atómica y no reversible por repetición.
- [x] `compromisos vencidos` usa `due_at <= now` y excluye futuros/sin vencimiento.
- [x] Audit de creación guarda `hasDueAt`, no body ni timestamp exacto.
- [x] Audit de lifecycle guarda id/estado, no body.
- [x] FTS genérico y `busca compromisos <texto>` encuentran la fuente `commitment`.
- [x] Commitments y Observer permanecen en índices/rutas separados.
- [x] Completar/cancelar no borra memoria histórica FTS.
- [x] Briefing usa hasta 5 compromisos abiertos y marca vencidos.
- [x] Crear/listar/completar compromisos no crea `action_request`.
- [x] Stage 6A no tiene scheduler propio ni ruta `sendText()`.
- [x] Backup verifica schema v16 y tabla commitments.
- [x] `doctor` exige schema v16, inspecciona commitments y no hace red.

> El PASS automatizado no sustituye los checks live/manuales siguientes.

## WhatsApp live — PENDIENTE

- [ ] Desde self-chat: `compromiso mañana a las 10 enviar informe a Ana` crea un compromiso fechado.
- [ ] Desde self-chat: `compromiso revisar presupuesto` crea uno sin vencimiento.
- [ ] Variantes `me comprometo a ...` y `prometí ...` funcionan como captura explícita.
- [ ] `compromisos` lista solo abiertos.
- [ ] `compromisos vencidos` lista solo vencidos según `America/Lima`.
- [ ] `cumplí compromiso #N` completa exactamente una vez.
- [ ] `cancela compromiso #N` cancela exactamente una vez.
- [ ] `busca compromisos <texto>` encuentra el contenido local.
- [ ] `briefing` muestra compromisos abiertos y marca vencidos.
- [ ] Crear un compromiso con vencimiento NO genera mensaje automático al llegar esa hora.
- [ ] Mensajes de terceros/grupos no pueden crear/modificar compromisos a través del core.
- [ ] Observer allowlisted no crea compromisos aunque el texto parezca una promesa.
- [ ] Reinicio/reboot conserva compromisos y estados.

## Operación / privacidad — PENDIENTE

- [ ] Migrar copia de una DB v15 real y verificar v16 sin pérdida de datos existentes.
- [ ] Reiniciar varias veces y confirmar en host real que migration/triggers no duplican filas FTS.
- [ ] `npm run doctor` en host objetivo reporta `schema v16` y commitments sin mutar DB.
- [ ] Backup + restore conserva body, due/status y búsqueda FTS.
- [ ] Revisar logs: no deben registrar automáticamente body del compromiso fuera de respuestas solicitadas.
- [ ] Revisar audit SQLite: no debe contener body ni due timestamp exacto.
- [ ] Confirmar que no aparece tráfico de IA/Calendar/transcripción al crear/listar/buscar compromisos.
- [ ] Medir crecimiento SQLite/FTS con un volumen personal razonable.

## Fuera de alcance de Stage 6A

- Detección automática de promesas en mensajes enviados/recibidos.
- Detección basada en IA.
- Lectura automática de Observer para generar compromisos.
- Recordatorios automáticos o escalamiento de compromisos vencidos.
- Creación automática de Calendar/reminders/actions.

Cualquiera de esas capacidades exige una etapa posterior con opt-in y revisión de privacidad/trust boundary independiente.

## Condición de cierre Stage 6A

No marcar Stage 6A live completo hasta tener CI verde + migración v15→v16 real + comandos self-chat + persistencia/restart + briefing/búsqueda + confirmación de cero detección automática y cero notificaciones automáticas.
