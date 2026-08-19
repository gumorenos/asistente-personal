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

## Health / operations — manual

- [ ] `/healthz` 200 y `/readyz` refleja DB/transport en deployment real.
- [ ] Puerto health no expuesto públicamente.
- [ ] SIGTERM/SIGINT cierra scheduler, transport, health y SQLite.
- [ ] Recuperación WAL/SHM después de kill no limpio.
- [ ] Permisos reales de directorio/DB en RPi.
- [ ] Backup/restore y row counts/migrations.
- [ ] Consumo CPU/RAM estable durante al menos 24h.

## Baileys reliability gaps before Observer mode

- [ ] Persisted raw WhatsApp message store para `getMessage()`.
- [ ] Validar resend/missing-message recovery.
- [ ] Validar versión Baileys fijada contra comportamiento real actual.
- [ ] Revisar upgrades separadamente; no auto-upgrade.

## Privacy/security before non-self chats or external writes

- [ ] Chat-level allowlist y workflow administrativo.
- [ ] Retention/purge jobs.
- [ ] Decidir cifrado de SQLite/backups.
- [ ] Action-approval model antes de Calendar.
- [ ] Tests que prueben que third-party outbound no ocurre sin aprobación.

## Stop point for risky features

Stage 1 está cerrado a nivel de desarrollo pero mantiene QA real pendiente. Stage 2A puede probarse externamente en paralelo. Stage 2B no amplía la allowlist: solo procesa media después del guard existente y no ejecuta el transcript. **Observer, respuestas a terceros y Calendar writes siguen bloqueados hasta implementar sus boundaries de autorización.**
