# Testing / QA pending

Updated: 2026-08-18 (America/Lima)

Este archivo es la fuente de verdad del QA que requiere una sesión real de WhatsApp/Raspberry Pi o condiciones operativas que no deben darse por aprobadas únicamente por tests automatizados.

## Stage 1 — automated development gates completed

- [x] Instalación reproducible con `package-lock.json` y `npm ci`.
- [x] TypeScript strict / `tsc --noEmit` pasa en Node 22.18.
- [x] Suite automatizada incluye core, SQLite, capabilities, scheduler, configuración, PN/LID guard y health/readiness.
- [x] Notas: crear, listar y completar/archivar mediante transición de estado.
- [x] Gastos: PEN, decimal punto/coma, categoría al crear, recategorización, rango local y resumen por categoría.
- [x] Recordatorios: sin fecha, `hoy`, `mañana`, duración relativa, weekday y fecha explícita.
- [x] Fecha/hora inválida o pasada no se degrada silenciosamente a reminder sin fecha.
- [x] Scheduler entrega una vez y conserva `pending` ante falla para reintento.
- [x] Mutaciones y entrega de reminder quedan en `audit_log`.
- [x] Configuración rechaza timezone, booleanos, teléfonos y JIDs inválidos.
- [x] Group JIDs no pueden entrar en `WHATSAPP_SELF_JIDS`.
- [x] Self-chat guard rechaza allowlist vacía, terceros, incoming no-fromMe y grupos.
- [x] PN/LID alternativo se canonicaliza al JID que efectivamente pasó la allowlist.
- [x] Outbound guard rechaza terceros antes incluso de comprobar el estado de conexión.
- [x] `/healthz` y `/readyz` tienen tests HTTP automatizados.
- [x] `npm audit --omit=dev --audit-level=high` pasa.
- [x] Docker `linux/amd64` build pasa.
- [x] Docker `linux/arm64` build pasa (target Raspberry Pi 5).

Resultado automatizado de cierre de Stage 1: **26 tests + typecheck + runtime audit + multi-arch Docker gates**.

## WhatsApp pairing and session persistence — manual / release-blocking

- [ ] Desplegar primero en un entorno no crítico o con un número de prueba.
- [ ] Configurar `WHATSAPP_ENABLED=true` y `WHATSAPP_PHONE_NUMBER` en formato E.164 solo dígitos.
- [ ] Dejar inicialmente `WHATSAPP_SELF_JIDS` vacío y confirmar que ningún mensaje es procesado ni respondido.
- [ ] Confirmar que el pairing code permite vincular el dispositivo.
- [ ] Confirmar que credenciales y Signal keys quedan en SQLite y no aparece una carpeta de auth JSON de Baileys.
- [ ] Reiniciar el proceso y verificar reconexión sin pairing code nuevo.
- [ ] Reiniciar físicamente el Raspberry Pi y verificar reconexión sin pairing code nuevo.
- [ ] Desvincular el dispositivo desde WhatsApp y confirmar estado `logged_out` sin reconnect loop.
- [ ] Simular pérdida/restauración de red y confirmar reconexión sin respuestas duplicadas.

## Self-chat authorization — manual / release-blocking

- [ ] Con allowlist vacía, comprobar que logs pueden mostrar identidad proveniente de configuración/sesión, pero no “descubren” JIDs observando mensajes.
- [ ] Enviar un mensaje desde la cuenta a un tercero mientras la allowlist está vacía y confirmar que no se registra como self-JID candidato ni produce respuesta.
- [ ] Configurar manualmente el PN confiable (`@s.whatsapp.net`).
- [ ] Si WhatsApp expone LID para la cuenta, validarlo antes de añadirlo a la allowlist.
- [ ] Confirmar `ping` → exactamente un `pong` en self-chat.
- [ ] Confirmar `estado` y `ayuda`.
- [ ] Confirmar que el echo del propio `pong` no genera loop.
- [ ] Enviar un mensaje normal a otra persona y confirmar que el asistente no responde a esa persona.
- [ ] Recibir un mensaje de otra persona y confirmar que no se procesa/persiste en Stage 1.
- [ ] Enviar un mensaje en un grupo y confirmar que no se procesa/persiste.
- [ ] Validar un caso real donde WhatsApp entregue PN/LID alternativos y confirmar reply por el JID autorizado.

## Stage 1 commands — manual on real self-chat

- [ ] `anota comprar filtro de agua` y `notas`.
- [ ] `completa nota #<id>` y `archiva nota #<id>`.
- [ ] `gasté S/ 78.50 en taxi #transporte` y `gastos`.
- [ ] `categoriza gasto #<id> como transporte`.
- [ ] `gastos hoy`, `gastos semana`, `gastos mes` y `resumen gastos mes` con montos reales.
- [ ] `recuérdame en 2 minutos prueba` se entrega una sola vez.
- [ ] `recuérdame mañana a las 10 ...` resuelve a America/Lima correctamente.
- [ ] `recuérdame viernes a las 16 ...` resuelve el próximo viernes correcto.
- [ ] Fecha/hora imposible (por ejemplo 25:00) se rechaza y no crea reminder.
- [ ] `cancela recordatorio #<id>` evita una entrega posterior.
- [ ] Reiniciar entre creación y vencimiento; el reminder persiste y se entrega.
- [ ] Cortar red al vencer; permanece pending y se entrega tras recuperar conectividad.
- [ ] Reminder sin fecha permanece pendiente y no se envía espontáneamente.
- [ ] Validar boundary de medianoche de `hoy`/`mañana` en America/Lima.
- [ ] Confirmar tildes/capitalización en descripciones y notas reales.

## Health / operations — manual

- [ ] `/healthz` devuelve 200 en el deployment real.
- [ ] `/readyz` refleja DB/transport correctamente durante startup, conexión y degradación.
- [ ] Puerto health accesible localmente pero no públicamente desde router/Cloudflare.
- [ ] SIGTERM/SIGINT detiene scheduler, transport, health server y SQLite limpiamente.
- [ ] Confirmar recuperación WAL/SHM después de kill no limpio.
- [ ] Confirmar permisos efectivos del directorio/base en filesystem real del RPi.
- [ ] Crear backup local y restaurarlo en copia descartable; verificar migraciones y conteos.
- [ ] Confirmar uso de memoria/CPU razonable durante operación sostenida en RPi5.

## Baileys reliability — required before Observer mode

- [ ] Implementar store persistente de mensaje raw para `getMessage()`; Stage 1 devuelve `undefined` porque no necesita recuperación de mensajes para su alcance.
- [ ] Validar resend/missing-message antes de depender de recuperación de mensajes.
- [ ] Validar la release pinneada contra WhatsApp Web antes de cualquier upgrade.
- [ ] Revisar upgrades de Baileys por separado; nunca auto-upgrade de versiones sensibles al protocolo.

## Privacy/security prerequisites for later stages

- [ ] Diseñar allowlist de chats antes de Observer.
- [ ] Añadir política/jobs de retención antes de almacenar conversaciones no-self.
- [ ] Decidir cifrado de DB/backups para despliegue sostenido.
- [ ] Implementar modelo de approvals antes de Calendar u otra escritura externa.
- [ ] Añadir tests que prueben que mensajería a terceros exige aprobación antes de implementar esa capability.

## Stage 1 closure status

**Desarrollo Stage 1: CERRADO.**

Lo pendiente arriba es QA de integración/despliegue real y prerequisites de etapas futuras. No habilitar Observer, respuestas a terceros, Calendar ni agentes externos hasta implementar y validar sus respectivos boundaries de seguridad.
