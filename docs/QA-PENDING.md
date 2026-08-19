# Testing / QA pending

Updated: 2026-08-18 (America/Lima)

Este archivo es la fuente de verdad del QA que requiere una sesión real, infraestructura externa o condiciones operativas que no deben darse por aprobadas únicamente por tests automatizados. **El desarrollo puede continuar mientras estos checks permanecen pendientes.**

## Stage 1 — automated development gates completed

- [x] `package-lock.json` + `npm ci`.
- [x] TypeScript strict en Node 22.18.
- [x] Core, SQLite, capabilities, scheduler, configuración, PN/LID y health/readiness cubiertos.
- [x] Notas, gastos y recordatorios con lifecycle/audit.
- [x] Runtime dependency audit.
- [x] Docker `linux/amd64` y `linux/arm64`.

Resultado de cierre Stage 1: **26 tests + typecheck + audit + multi-arch Docker**.

## Stage 1 — WhatsApp/RPi — manual / release-blocking

- [ ] Desplegar primero con entorno/número no crítico.
- [ ] Pairing real con `WHATSAPP_ENABLED=true`.
- [ ] Allowlist vacía => cero procesamiento/respuestas.
- [ ] Credenciales/Signal keys quedan en SQLite, sin auth JSON folder.
- [ ] Restart de proceso y reboot físico de RPi reconectan sin pairing nuevo.
- [ ] Logout => `logged_out` sin reconnect loop.
- [ ] Pérdida/restauración de red sin duplicados.
- [ ] Validar PN y, si aplica, LID real.
- [ ] `ping` => exactamente un `pong`; `estado` y `ayuda` funcionan.
- [ ] Echo del propio reply no genera loop.
- [ ] Terceros/grupos no se procesan ni reciben replies.
- [ ] Caso PN/LID alternativo real responde por el JID autorizado.
- [ ] Crear/listar/completar/archivar notas reales.
- [ ] Capturar/categorizar/listar/resumir gastos reales.
- [ ] Recordatorios: entrega única, cancelación, persistencia tras reboot y retry offline.
- [ ] Boundary de medianoche y tildes/capitalización reales.

## Stage 2A — AI provider — manual / external QA

- [ ] `AI_ENABLED=false`: `ia hola` no genera tráfico externo.
- [ ] Configurar endpoint OpenAI-compatible de prueba con credenciales no críticas.
- [ ] `ia hola` => exactamente una llamada a `/chat/completions`.
- [ ] Mensaje normal y comandos Stage 1 no generan tráfico al proveedor.
- [ ] Request contiene solo system prompt fijo + prompt explícito actual.
- [ ] `audit_log` contiene metadata, nunca prompt/respuesta.
- [ ] Logs no contienen API key, prompt o respuesta por defecto.
- [ ] HTTP 401/429/500 y timeout producen error seguro sin body upstream.
- [ ] Límites de input/output/tokens se respetan.
- [ ] Output que parezca comando no se ejecuta.
- [ ] Medir latencia/costo y revisar política de retención/privacidad del proveedor elegido.

## Stage 2B — audio transcription — manual / external QA

- [ ] `TRANSCRIPTION_ENABLED=false`: enviar nota de voz autorizada no descarga media para transcripción ni genera tráfico al proveedor.
- [ ] Audio de terceros/grupos no obtiene loader útil ni genera tráfico de transcripción.
- [ ] Configurar endpoint OpenAI-compatible de prueba `/audio/transcriptions` con credenciales/modelo no críticos.
- [ ] Nota de voz real OGG/Opus de WhatsApp se descarga una sola vez y se transcribe correctamente.
- [ ] Verificar otros MIME que entregue la cuenta/dispositivo real antes de ampliar soporte declarado.
- [ ] `fileLength` declarado mayor a `TRANSCRIPTION_MAX_BYTES` se rechaza **antes de descargar**.
- [ ] Si el tamaño declarado es ausente/incorrecto, bytes reales por encima del límite se rechazan antes de subir.
- [ ] Request al proveedor contiene audio + modelo, sin historial, notas, gastos, reminders ni mensajes adicionales.
- [ ] `audit_log` no contiene bytes de audio, file name ni transcript.
- [ ] Logs no contienen API key, audio ni transcript por defecto.
- [ ] HTTP 401/429/500 y timeout generan respuesta segura sin body upstream.
- [ ] Transcript que diga `anota ...`, `recuérdame ...` u otro comando se muestra como texto y **no se ejecuta**.
- [ ] Probar `TRANSCRIPTION_MAX_BYTES`, `TRANSCRIPTION_MAX_CHARS` y timeout en deployment real.
- [ ] Medir pico de RAM en RPi5 cerca del límite máximo de audio.
- [ ] Medir latencia/costo y revisar retención/privacidad del proveedor elegido antes de audio sensible.

## Stage 2C — approval boundary / Calendar proposals

### Automated development checks

- [x] `action_requests` persiste propuestas locales con estados `pending`, `approved` y `rejected`.
- [x] Aprobar/rechazar es una transición atómica solo desde `pending`.
- [x] `agenda ...` reutiliza el parser horario determinista y crea `calendar.create_event` pendiente sin llamar a Google.
- [x] Duración default 60 min; `por/durante N minutos/horas` se valida entre 5 min y 8 h.
- [x] Propuesta Calendar expira al llegar su hora de inicio: deja de listarse y ya no puede aprobarse.
- [x] `acciones` muestra summary local, no el payload completo.
- [x] Audit registra tipo/timing/decisión, no payload ni título de la propuesta.
- [x] Aprobar responde explícitamente que **no ejecutó** la acción; no existe executor externo en Stage 2C.

### Manual / real self-chat QA

- [ ] `agenda mañana a las 10 reunión de prueba por 30 minutos` crea una única propuesta pendiente y no un evento real.
- [ ] `acciones` muestra la propuesta y no expone campos internos del payload.
- [ ] `aprueba acción #N` cambia a `approved` una sola vez y no genera tráfico a Google Calendar.
- [ ] `rechaza acción #N` cambia a `rejected` una sola vez y no genera tráfico externo.
- [ ] Reiniciar proceso/RPi con propuesta pendiente y confirmar persistencia del estado.
- [ ] Intentar aprobar una propuesta después de su hora de inicio y confirmar rechazo por caducidad.
- [ ] Confirmar mediante captura/logs de red que `agenda`, `acciones`, aprobación y rechazo no contactan `googleapis.com` ni otro Calendar provider.
- [ ] Revisar `audit_log`: no debe contener título/payload sensible de la propuesta.
- [ ] Validar frases reales con `mañana`, weekday, `DD/MM`, fecha ISO y duración en America/Lima.

## Health / operations — manual

- [ ] `/healthz` 200 y `/readyz` refleja DB/transport en deployment real.
- [ ] Puerto health no expuesto públicamente.
- [ ] SIGTERM/SIGINT cierra scheduler, transport, health y SQLite.
- [ ] Recuperación WAL/SHM después de kill no limpio.
- [ ] Permisos reales de directorio/DB en RPi.
- [ ] Backup/restore y row counts/migrations, incluyendo `action_requests`.
- [ ] Consumo CPU/RAM estable durante al menos 24h.

## Baileys reliability gaps before Observer mode

- [ ] Persisted raw WhatsApp message store para `getMessage()`.
- [ ] Validar resend/missing-message recovery.
- [ ] Validar versión Baileys fijada contra comportamiento real actual.
- [ ] Revisar upgrades separadamente; no auto-upgrade.

## Privacy/security before non-self chats or external writes

- [x] Boundary local de propuesta + aprobación/rechazo existe antes de Calendar write.
- [ ] Calendar executor/provider debe consumir **solo** acciones `approved`, revalidar payload/fecha justo antes de ejecutar y registrar resultado/idempotency key.
- [ ] Calendar OAuth/token storage y refresh strategy deben definirse y threat-modelarse antes de habilitar writes.
- [ ] Chat-level allowlist y workflow administrativo antes de Observer/non-self chats.
- [ ] Retention/purge jobs.
- [ ] Decidir cifrado de SQLite/backups.
- [ ] Tests que prueben que third-party outbound no ocurre sin aprobación.

## Stop point for risky features

Stage 1 está cerrado a nivel de desarrollo pero mantiene QA real pendiente. Stage 2A/2B tienen sus pruebas externas pendientes. Stage 2C ya separa propuesta de aprobación, pero **no existe todavía Calendar executor/provider**. Observer, respuestas a terceros y Calendar writes siguen bloqueados hasta implementar y validar sus boundaries de ejecución/autorización.