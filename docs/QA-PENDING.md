# Testing / QA pending

Updated: 2026-08-21 (America/Lima)

Este archivo es la fuente de verdad del QA que requiere una sesión real, infraestructura externa o condiciones operativas que no deben darse por aprobadas únicamente por tests automatizados. **El desarrollo puede continuar mientras estos checks permanecen pendientes.**

## QA execution 2026-08-21 — OpenClaw on commit `271402b`

Resultado global reportado: **BLOCKED**, no por un fallo funcional nuevo sino por falta de sesión/número WhatsApp QA explícito y credenciales externas de prueba.

Entorno ejecutado:

- host `vnic-gumorenos`;
- Ubuntu Linux 6.17.0-1019-oracle, `aarch64`;
- Node 22.23.2 / npm 10.9.8;
- Docker 29.7.2;
- Baileys 7.0.0-rc13;
- checkout detached y worktree limpio en `271402b71e1e890a3581d76667ddb876484d5e66`.

Evidencia obtenida en ese run:

- PASS: SHA remoto/PR, `npm ci`, typecheck + 128/128 tests, runtime audit 0 high+, Docker ARM64.
- BLOCKED host-only: Docker AMD64 en ese Oracle ARM64 sin binfmt/QEMU; esto no se interpreta como bug del repo.
- PASS local: ping/dedupe, estado/ayuda, notas, gastos, recordatorios/retry/persistencia SQLite.
- PASS local fake / BLOCKED externo: IA explícita, audio/transcripción y Calendar mantienen los boundaries esperados, pero no se probaron proveedores externos reales.
- PASS local: briefing, dedupe diario y purge operacional con preservación del estado de dominio.
- PASS local / PENDING real: Observer allowlist, PN/LID simulado, media sin loader, idempotencia, lectura limitada, disable y retención.
- PASS parcial operaciones: health/readiness local, loopback, SIGTERM, WAL, migraciones 1–9 de ese commit y backup/restore básico.
- PENDING: pairing WhatsApp, restart/reboot/red reales, PN/LID/grupos reales, outbound real a terceros bloqueado, voice note real, Google/AI externos, briefing/Observer live, estabilidad 24 h.
- En `271402b` se confirmó que `getMessage` devolvía siempre `undefined`; este gap de implementación fue abordado después de ese run mediante store persistente v10 y alias PN/LID v11. El recovery real sigue pendiente hasta disponer de sesión WhatsApp QA.

No se marcaron como PASS los checks que requieren WhatsApp/Google/proveedor externo/24 h solo por haber pasado pruebas locales.

## Automated development gates — current Stage 2 head

- [x] `npm ci` reproducible.
- [x] TypeScript strict en Node 22.18.
- [x] 134/134 tests después de incorporar el retry store PN/LID-aware.
- [x] Runtime dependency audit: 0 vulnerabilidades high+.
- [x] Docker `linux/amd64`.
- [x] Docker `linux/arm64`.
- [x] Migraciones centrales 1→11 sobre DB nueva cubiertas automáticamente.

Estos gates no sustituyen el QA manual detallado abajo.

## Stage 1 — WhatsApp/RPi — manual / release-blocking

- [ ] Desplegar primero con entorno/número no crítico.
- [ ] Pairing real con `WHATSAPP_ENABLED=true`.
- [ ] Allowlist self vacía => cero procesamiento/respuestas.
- [ ] Credenciales/Signal keys quedan en SQLite, sin auth JSON folder.
- [ ] Restart de proceso y reboot físico de RPi reconectan sin pairing nuevo.
- [ ] Logout => `logged_out` sin reconnect loop.
- [ ] Pérdida/restauración de red sin duplicados.
- [ ] Validar PN y, si aplica, LID real.
- [ ] `ping` => exactamente un `pong`; `estado` y `ayuda` funcionan.
- [ ] Echo del propio reply no genera loop.
- [ ] Terceros/grupos no reciben replies.
- [ ] Caso PN/LID alternativo real responde por el JID autorizado.
- [ ] Crear/listar/completar/archivar notas reales.
- [ ] Capturar/categorizar/listar/resumir gastos reales.
- [ ] Recordatorios: entrega única, cancelación, persistencia tras reboot y retry offline.
- [ ] Boundary de medianoche y tildes/capitalización reales.

## Stage 2A — AI provider — manual / external QA

- [ ] `AI_ENABLED=false`: `ia hola` no genera tráfico externo real.
- [ ] Configurar endpoint OpenAI-compatible de prueba con credenciales no críticas.
- [ ] `ia hola` => exactamente una llamada a `/chat/completions` real.
- [ ] Mensaje normal y comandos locales no generan tráfico al proveedor.
- [ ] Request contiene solo system prompt fijo + prompt explícito actual.
- [ ] `audit_log` contiene metadata, nunca prompt/respuesta.
- [ ] Logs no contienen API key, prompt o respuesta por defecto.
- [ ] HTTP 401/429/500 y timeout producen error seguro sin body upstream.
- [ ] Límites de input/output/tokens se respetan.
- [ ] Output que parezca comando no se ejecuta.
- [ ] Medir latencia/costo y revisar política de retención/privacidad del proveedor elegido.

Evidencia local OpenClaw 2026-08-21: proveedor fake PASS para disabled/no-call, llamada explícita única, request mínimo, error seguro y audit sin contenido. No sustituye QA externo.

## Stage 2B — audio transcription — manual / external QA

- [ ] `TRANSCRIPTION_ENABLED=false`: enviar nota de voz autorizada real no descarga media para transcripción ni genera tráfico al proveedor.
- [ ] Audio de terceros/grupos reales no obtiene loader útil ni genera tráfico de transcripción.
- [ ] Configurar endpoint OpenAI-compatible de prueba `/audio/transcriptions` con credenciales/modelo no críticos.
- [ ] Nota de voz real OGG/Opus de WhatsApp se descarga una sola vez y se transcribe correctamente.
- [ ] `fileLength` declarado mayor a `TRANSCRIPTION_MAX_BYTES` se rechaza antes de descargar.
- [ ] Bytes reales por encima del límite se rechazan antes de subir aunque el tamaño declarado sea ausente/incorrecto.
- [ ] Request contiene solo audio + modelo, sin historial ni estado local adicional.
- [ ] Audit/logs no contienen audio, filename, transcript ni API key.
- [ ] HTTP 401/429/500 y timeout generan respuesta segura sin body upstream.
- [ ] Transcript con sintaxis `anota`, `recuérdame`, `agenda`, etc. se muestra como texto y no se ejecuta.
- [ ] Medir RAM, latencia/costo y revisar retención/privacidad del proveedor antes de audio sensible.

Evidencia local OpenClaw 2026-08-21: fake provider PASS para disabled/no-download, límites pre/post y transcript no ejecutable. Falta audio WhatsApp real.

## Stage 2C — proposal + approval boundary

### Automated development checks

- [x] `action_requests` persiste `pending`, `approved` y `rejected`.
- [x] Aprobar/rechazar es transición atómica solo desde `pending`.
- [x] `agenda ...` crea `calendar.create_event` pendiente con parser determinista.
- [x] Duración 5 min–8 h, default 60 min.
- [x] Propuesta expira al llegar la hora de inicio.
- [x] `acciones` no expone payload completo.
- [x] Audit no almacena título/payload sensible.
- [x] Aprobar por sí solo no ejecuta el write externo.

### Manual / self-chat QA

- [ ] `agenda mañana a las 10 reunión de prueba por 30 minutos` desde WhatsApp real crea una única propuesta.
- [ ] `aprueba acción #N` desde WhatsApp real cambia una sola vez a `approved` y todavía no crea evento.
- [ ] `rechaza acción #N` desde WhatsApp real cambia una sola vez a `rejected`.
- [ ] Persistencia de pending/approved/rejected tras restart/reboot real.
- [ ] Propuesta caducada no puede aprobarse.
- [ ] Audit real no contiene título/payload.
- [ ] Frases con mañana, weekdays, `DD/MM`, ISO y duración funcionan en America/Lima.

Evidencia local OpenClaw 2026-08-21: proposal/approve/reject/caducidad PASS sin WhatsApp real.

## Stage 2D — Google Calendar execution — manual / external QA

### Automated development checks

- [x] Executor acepta únicamente `approved` + `calendar.create_event` válido.
- [x] Revalida fecha/payload inmediatamente antes del write.
- [x] Ledger local guarda ejecución e idempotency key sin payload sensible.
- [x] Retry reutiliza la misma idempotency key.
- [x] Lease bloquea doble ejecución concurrente y recupera `started` huérfano.
- [x] Provider Google usa event ID determinista para idempotencia remota.
- [x] `409 duplicate` se recupera mediante lookup del event ID esperado.
- [x] `401` permite un único refresh/retry controlado.
- [x] `CALENDAR_ENABLED=false` por defecto.
- [x] Incluso habilitado, requiere `aprueba acción #N` + `ejecuta acción #N` separados.

### Manual / Google QA

- [ ] Crear OAuth client de prueba con mínimo alcance necesario y obtener refresh token no crítico.
- [ ] Verificar token refresh real y que secretos nunca entren a SQLite/audit/logs.
- [ ] Con `CALENDAR_ENABLED=false`, `ejecuta acción #N` no genera tráfico Google real.
- [ ] Acción pending/rejected/caducada jamás crea evento.
- [ ] Acción approved solo crea evento después de `ejecuta acción #N`.
- [ ] Repetir `ejecuta acción #N` no crea duplicado.
- [ ] Simular caída después del create remoto y antes del commit local; retry recupera el mismo evento.
- [ ] Verificar timezone, duración y título del evento real.
- [ ] Invalid/revoked refresh token falla de forma segura.
- [ ] Revisar scopes OAuth, almacenamiento de `.env`/secret y estrategia de rotación antes de uso diario.

Evidencia local OpenClaw 2026-08-21: boundary de Calendar PASS; QA Google quedó BLOCKED por falta de OAuth/calendario QA.

## Stage 2E — personal briefing / retention — manual QA

### Automated development checks

- [x] `briefing` es determinista y no usa IA.
- [x] Scheduler diario es opt-in y deduplica por fecha local.
- [x] Destino de briefing debe estar explícitamente en `WHATSAPP_SELF_JIDS`.
- [x] Retención operacional es opt-in y no toca notas/gastos/recordatorios/acciones/allowlists/credenciales.
- [x] `whatsapp_message_store` sigue `MESSAGE_RETENTION_DAYS` cuando `RETENTION_ENABLED=true`.

### Manual

- [ ] `briefing` muestra próximos recordatorios, notas activas, gasto del mes y acciones pendientes con datos reales vía WhatsApp.
- [ ] `BRIEFING_ENABLED=false` => cero envío programado real.
- [ ] Briefing programado se entrega una sola vez por día local incluso tras restart.
- [ ] Retry offline no produce duplicados.
- [ ] `RETENTION_ENABLED=false` no elimina filas operativas.
- [ ] Activar ventanas cortas en DB de prueba y confirmar purge exacto de messages/whatsapp_message_store/outbound/audit/briefing deliveries.
- [ ] Confirmar que estado de dominio y credenciales sobreviven al purge.
- [ ] Backup/restore antes y después del purge; revisar WAL/SHM y tamaño real del DB.

Evidencia local OpenClaw 2026-08-21: briefing, dedupe/retry y purge de tablas existentes en `271402b` PASS. El retry store se validó posteriormente por tests automáticos y requiere nuevo QA real.

## Stage 2F — Observer read-only — manual / release-blocking before daily use

### Automated development checks

- [x] `observed_chats` es una allowlist SQLite separada de `WHATSAPP_SELF_JIDS`.
- [x] Soporta JID directo, LID y grupo; default de retención 7 días, rango 1–90.
- [x] `ObserverService` no conoce `MessageTransport`, `AssistantCore`, capabilities ni providers externos.
- [x] Tabla `observations` dedicada, migración central versión 9, unique `(chat_jid,message_id)`.
- [x] Sink vuelve a imponer texto-only y máximo 4.000 caracteres.
- [x] Media observada se rechaza sin `loadMedia()`.
- [x] Routing self/observer es mutuamente excluyente.
- [x] Con Observer deshabilitado, no-self queda ignorado como antes.
- [x] `OBSERVER_ENABLED=false` por defecto.
- [x] Activarlo exige `WHATSAPP_ENABLED=true` + self-JID administrativo explícito.
- [x] Deshabilitar un chat detiene writes nuevos inmediatamente.
- [x] Purge propio de Observer usa `retention_days` de cada chat y no depende de `RETENTION_ENABLED`.
- [x] Observer no tiene ruta de `sendText`, IA, transcripción, Calendar ni creación de acciones.
- [x] `observaciones <jid> [1-10]` es una lectura self-chat explícita, exacta por JID, sin IA y con salida acotada.
- [x] Lecturas Observer se auditan con hash del JID + counts, nunca con JID/texto/label crudos.
- [x] `whatsapp_message_store` se escribe únicamente después de resolver la ruta self-chat; Observer/ignored retornan antes y no duplican contenido raw.

### Manual / real WhatsApp QA

- [ ] Con `OBSERVER_ENABLED=false`, un JID presente en `observed_chats` produce **cero filas** nuevas en `observations`.
- [ ] Con Observer habilitado y allowlist vacía, terceros/grupos producen cero filas.
- [ ] Agregar desde self-chat `observa chat <jid> como <label>` y confirmar que solo ese chat comienza a persistir texto.
- [ ] Chat no allowlisted nunca se persiste.
- [ ] Grupo allowlisted persiste `chat_jid`, sender y texto correctamente.
- [ ] PN/LID alternativo real se canonicaliza al JID que está allowlisted.
- [ ] Mensaje observado jamás produce reply, read-receipt adicional intencional, nota, gasto, recordatorio, acción, IA, transcripción ni Calendar traffic.
- [ ] Audio/imagen/documento/video observado no descarga media y no crea fila de observación.
- [ ] Confirmar además que Observer/terceros/grupos no crean filas en `whatsapp_message_store`.
- [ ] Duplicado/resend del mismo message ID crea una sola fila.
- [ ] `observaciones <jid>` desde el self-chat devuelve solo filas del JID exacto y nunca mezcla otro chat.
- [ ] `observaciones <jid> 10` respeta límite, truncamiento y timezone; `11` se rechaza.
- [ ] Tras `deja de observar <jid>`, no se capturan filas nuevas pero las retenidas siguen consultables hasta su purge y se marcan como chat deshabilitado.
- [ ] `deja de observar <jid>` detiene nuevas filas sin restart.
- [ ] Restart/reboot conserva allowlist y observaciones existentes.
- [ ] Retención real elimina cada chat según su ventana; un chat de 1 día no afecta uno de 30 días.
- [ ] Logs normales de Observer no contienen texto, JID, label ni contenido observado.
- [ ] Audit de lectura real no contiene texto, JID crudo ni label.
- [ ] Medir CPU/RAM/crecimiento DB con Observer activo durante al menos 24h.
- [ ] Revisar consentimiento, necesidad y minimización de datos antes de observar chats que involucren a terceros.

Evidencia local OpenClaw 2026-08-21: allowlist, PN/LID simulado, dedupe, media sin loader, lectura limitada, disable, retención y audit PASS. Live WhatsApp sigue PENDING.

## Health / operations — manual

- [ ] `/healthz` 200 y `/readyz` refleja DB/transport en deployment WhatsApp real.
- [ ] Puerto health no expuesto públicamente en deployment final.
- [ ] SIGTERM/SIGINT cierra todos los schedulers, transport, health y SQLite.
- [ ] Recuperación WAL/SHM después de kill no limpio.
- [ ] Permisos reales de directorio/DB en RPi.
- [ ] Backup/restore y row counts/migrations 1→11 desde DB nueva y sobre DB existente.
- [ ] Consumo CPU/RAM estable durante al menos 24h.

Evidencia OpenClaw 2026-08-21 sobre `271402b`: health/readiness local PASS con transport disabled, loopback PASS, SIGTERM PASS, WAL activo, migraciones 1–9 de ese commit y backup/restore básico PASS. Repetir migraciones incluyendo v10/v11 y deployment final.

## Stage 2G — Baileys retry/recovery

### Automated development checks

- [x] Migración v10 crea `whatsapp_message_store` persistente con PK `(remote_jid,message_id)`.
- [x] Migración v11 añade `remote_jid_alt` e índice PN/LID.
- [x] `getMessage` consulta el store en vez de devolver siempre `undefined`.
- [x] Respuestas enviadas por el asistente se guardan inmediatamente después de `sendMessage`.
- [x] Mensajes inbound solo se guardan después de resolver self-chat autorizado; Observer/ignored no entran al raw retry store.
- [x] Serialización usa `BufferJSON` y preserva `Uint8Array`/campos binarios.
- [x] Upsert es idempotente y el lookup exige el mismo `message_id` más primary/alias JID.
- [x] El mismo mensaje se recupera por PN o LID y un resend con identidades invertidas no duplica la fila ni pierde el alias.
- [x] Con retención operacional habilitada, el store sigue `MESSAGE_RETENTION_DAYS`.
- [x] Test de transporte demuestra que Observer y tráfico ignored dejan el retry store sin filas.

### Manual / real WhatsApp QA

- [ ] Validar que mensajes self reales crean filas recuperables en `whatsapp_message_store` y sobreviven restart.
- [ ] Validar con PN/LID reales que el mismo `message_id` se recupera por cualquiera de las identidades entregadas por Baileys.
- [ ] Forzar/observar `getMessage()` real durante resend/missing-message recovery.
- [ ] Validar resend/missing-message recovery real end-to-end.
- [ ] Confirmar que terceros/grupos/Observer no generan filas raw.
- [ ] Confirmar purge real del store con retención habilitada.
- [ ] Validar versión Baileys fijada contra comportamiento real actual.
- [ ] Revisar upgrades separadamente; no auto-upgrade.

## Privacy/security decisions still pending

- [x] Boundary propuesta + aprobación antes de Calendar write.
- [x] Calendar execution con ledger/idempotencia y doble acto explícito.
- [x] Chat-level Observer allowlist + workflow administrativo.
- [x] Retention/purge operacional y per-chat Observer.
- [x] Raw retry store limitado por código a self-chat autorizado/outbound y excluido de Observer.
- [x] Alias PN/LID del retry store no amplía el lookup sin coincidencia del mismo `message_id`.
- [ ] Decidir cifrado de SQLite y backups en el dispositivo final.
- [ ] Definir política de consentimiento/retención para chats observados antes de uso con terceros.
- [ ] Validar mediante QA real que third-party outbound permanece imposible.

## Stop point for risky features

El desarrollo automatizado puede continuar, pero **ningún QA manual anterior se considera aprobado**. Calendar writes, briefing programado y Observer siguen opt-in y requieren sus pruebas externas/reales antes de uso diario. Observer es estrictamente read-only: no se implementará respuesta automática a terceros dentro de este gate.
