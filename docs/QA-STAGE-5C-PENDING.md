# QA pendiente — Stage 5C disponibilidad exacta read-only

Updated: 2026-08-24 (America/Lima)

Stage 5C comprueba si un intervalo futuro explícito está libre u ocupado usando `freeBusy`. No usa IA, no crea acciones, no persiste disponibilidad y no escribe Calendar.

## Gate automatizado — CI final verde

- [x] TypeScript strict PASS en Node 22.18.
- [x] Suite completa PASS — 250/250 tests.
- [x] Runtime dependency audit sin vulnerabilidades high+ — 0 vulnerabilidades.
- [x] Docker `linux/amd64` PASS, incluido smoke PDF/OCR.
- [x] Docker `linux/arm64` PASS, incluido smoke PDF/OCR.
- [x] `CALENDAR_EXACT_AVAILABILITY_ENABLED=false` por defecto.
- [x] Habilitar 5C exige `CALENDAR_READ_ENABLED=true`.
- [x] Habilitar 5C NO exige `CALENDAR_ENABLED=true`.
- [x] Consulta solo el intervalo exacto solicitado mediante `freeBusy`.
- [x] No usa `events.list` ni lee título/descripcion/attendees/location.
- [x] Duración limitada a 5–480 minutos.
- [x] Inicio debe ser futuro.
- [x] Horizonte máximo limitado a 366 días.
- [x] Inputs inválidos se rechazan antes de provider work.
- [x] Busy intervals se recortan al intervalo consultado y se fusionan.
- [x] Semántica de intervalo `[inicio, fin)`: eventos adyacentes en los bordes no cuentan como conflicto.
- [x] Una consulta explícita fuera de la ventana laboral configurada se respeta y consulta exactamente ese intervalo.
- [x] Resultado expone únicamente libre/ocupado; no detalles de eventos en conflicto.
- [x] Capability explícita no intercepta sintaxis de creación Calendar.
- [x] Feature disabled responde localmente y hace cero provider work.
- [x] Test comprueba que 5C deja `action_requests` pendientes en cero.
- [x] Audit guarda duración, booleano y cantidad de conflictos; no hora/timestamp consultado.
- [x] Error de provider no filtra detalle privado al reply/audit.
- [x] `npm run doctor` valida y reporta 5C sin red.

CI que cierra el gate automatizado: run #451 (`32695060671`) sobre código HEAD `f9e81fbdb5d3d33718e42a3de62f02265a9320ae`.

## Google Calendar real — PENDIENTE

- [ ] Usar Calendar QA/read-only de Stage 5A con scope `calendar.freebusy`.
- [ ] Con `CALENDAR_ENABLED=false`, `libre mañana a las 10 por 30 minutos` devuelve libre si no hay evento.
- [ ] Crear evento que solape parcialmente el intervalo y comprobar respuesta ocupado.
- [ ] Crear evento que empiece exactamente al final del intervalo y comprobar que NO cuenta como conflicto.
- [ ] Crear evento que termine exactamente al inicio y comprobar que NO cuenta como conflicto.
- [ ] Probar intervalos fuera de la ventana laboral de Stage 5A; 5C debe responder porque la consulta es explícita.
- [ ] Probar 5, 30, 60, 240 y 480 minutos.
- [ ] Probar fecha pasada y >366 días; confirmar cero tráfico Google.
- [ ] Confirmar que durante todos los casos no se crea/modifica/borra ningún evento.
- [ ] Confirmar que no se persisten resultados freeBusy en SQLite.

## WhatsApp live — PENDIENTE

- [ ] Desde self-chat: `libre mañana a las 10 por 30 minutos` funciona.
- [ ] Desde self-chat: `¿estoy libre mañana a las 10 por 30 minutos?` funciona.
- [ ] Desde self-chat: `tengo libre mañana a las 10 por 30 minutos` funciona.
- [ ] Probar weekday y fecha explícita compatibles con el parser temporal existente.
- [ ] Respuesta libre contiene solo intervalo solicitado y aviso de cero acción/evento.
- [ ] Respuesta ocupada no revela evento, título ni intervalo busy subyacente.
- [ ] Mensajes de terceros/grupos no pueden invocar 5C.
- [ ] Observer no puede invocar 5C.
- [ ] Después de consultar, `acciones` no muestra una acción nueva.
- [ ] `CALENDAR_ENABLED=false` continúa bloqueando cualquier write.

## Operación / privacidad — PENDIENTE

- [ ] Ejecutar `npm run doctor` en host real con 5C enabled y confirmar cero tráfico Google durante doctor.
- [ ] Revisar logs: no deben contener access token, refresh token ni busy intervals.
- [ ] Revisar audit SQLite: no debe contener timestamp/hora exacta consultada.
- [ ] Medir latencia de una consulta exacta desde host objetivo.
- [ ] Revocar token y confirmar error seguro.
- [ ] Reiniciar/reboot y confirmar que la feature mantiene configuración sin OAuth interactivo.

## Condición de cierre Stage 5C

El gate automatizado está cerrado. No marcar Stage 5C live completo hasta tener Stage 5A live read-only funcional + intervalos reales libre/ocupado verificados + confirmación explícita de cero actions, cero persistencia de freeBusy y cero Calendar writes.
