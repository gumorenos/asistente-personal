# Testing / QA pending

Updated: 2026-08-20 (America/Lima)

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

- [ ] `AI_ENABLED=false`: `ia hola` no genera tráfico externo.
- [ ] Configurar endpoint OpenAI-compatible de prueba con credenciales no críticas.
- [ ] `ia hola` => exactamente una llamada a `/chat/completions`.
- [ ] Mensaje normal y comandos locales no generan tráfico al proveedor.
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
- [ ] `fileLength` declarado mayor a `TRANSCRIPTION_MAX_BYTES` se rechaza antes de descargar.
- [ ] Bytes reales por encima del límite se rechazan antes de subir aunque el tamaño declarado sea ausente/incorrecto.
- [ ] Request contiene solo audio + modelo, sin historial ni estado local adicional.
- [ ] Audit/logs no contienen audio, filename, transcript ni API key.
- [ ] HTTP 401/429/500 y timeout generan respuesta segura sin body upstream.
- [ ] Transcript con sintaxis `anota`, `recuérdame`, `agenda`, etc. se muestra como texto y no se ejecuta.
- [ ] Medir RAM, latencia/costo y revisar retención/privacidad del proveedor antes de audio sensible.

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

- [ ] `agenda mañana a las 10 reunión de prueba por 30 minutos` crea una única propuesta.
- [ ] `aprueba acción #N` cambia una sola vez a `approved` y todavía no crea evento.
- [ ] `rechaza acción #N` cambia una sola vez a `rejected`.
- [ ] Persistencia de pending/approved/rejected tras restart/reboot.
- [ ] Propuesta caducada no puede aprobarse.
- [ ] Audit real no contiene título/payload.
- [ ] Frases con mañana, weekdays, `DD/MM`, ISO y duración funcionan en America/Lima.

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
- [ ] Con `CALENDAR_ENABLED=false`, `ejecuta acción #N` no genera tráfico Google.
- [ ] Acción pending/rejected/caducada jamás crea evento.
- [ ] Acción approved solo crea evento después de `ejecuta acción #N`.
- [ ] Repetir `ejecuta acción #N` no crea duplicado.
- [ ] Simular caída después del create remoto y antes del commit local; retry recupera el mismo evento.
- [ ] Verificar timezone, duración y título del evento real.
- [ ] Invalid/revoked refresh token falla de forma segura.
- [ ] Revisar scopes OAuth, almacenamiento de `.env`/secret y estrategia de rotación antes de uso diario.

## Stage 2E — personal briefing / retention — manual QA

### Automated development checks

- [x] `briefing` es determinista y no usa IA.
- [x] Scheduler diario es opt-in y deduplica por fecha local.
- [x] Destino de briefing debe estar explícitamente en `WHATSAPP_SELF_JIDS`.
- [x] Retención operacional es opt-in y no toca notas/gastos/recordatorios/acciones/allowlists/credenciales.

### Manual

- [ ] `briefing` muestra próximos recordatorios, notas activas, gasto del mes y acciones pendientes con datos reales.
- [ ] `BRIEFING_ENABLED=false` => cero envío programado.
- [ ] Briefing programado se entrega una sola vez por día local incluso tras restart.
- [ ] Retry offline no produce duplicados.
- [ ] `RETENTION_ENABLED=false` no elimina filas operativas.
- [ ] Activar ventanas cortas en DB de prueba y confirmar purge exacto de messages/outbound/audit/briefing deliveries.
- [ ] Confirmar que estado de dominio y credenciales sobreviven al purge.
- [ ] Backup/restore antes y después del purge; revisar WAL/SHM y tamaño real del DB.

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

### Manual / real WhatsApp QA

- [ ] Con `OBSERVER_ENABLED=false`, un JID presente en `observed_chats` produce **cero filas** nuevas en `observations`.
- [ ] Con Observer habilitado y allowlist vacía, terceros/grupos producen cero filas.
- [ ] Agregar desde self-chat `observa chat <jid> como <label>` y confirmar que solo ese chat comienza a persistir texto.
- [ ] Chat no allowlisted nunca se persiste.
- [ ] Grupo allowlisted persiste `chat_jid`, sender y texto correctamente.
- [ ] PN/LID alternativo real se canonicaliza al JID que está allowlisted.
- [ ] Mensaje observado jamás produce reply, read-receipt adicional intencional, nota, gasto, recordatorio, acción, IA, transcripción ni Calendar traffic.
- [ ] Audio/imagen/documento/video observado no descarga media y no crea fila de observación.
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

## Health / operations — manual

- [ ] `/healthz` 200 y `/readyz` refleja DB/transport en deployment real.
- [ ] Puerto health no expuesto públicamente.
- [ ] SIGTERM/SIGINT cierra todos los schedulers, transport, health y SQLite.
- [ ] Recuperación WAL/SHM después de kill no limpio.
- [ ] Permisos reales de directorio/DB en RPi.
- [ ] Backup/restore y row counts/migrations 1→9 desde DB nueva y sobre DB existente.
- [ ] Consumo CPU/RAM estable durante al menos 24h.

## Baileys reliability gaps

- [ ] Persisted raw WhatsApp message store para `getMessage()` antes de depender de resend/missing-message recovery.
- [ ] Validar resend/missing-message recovery real.
- [ ] Validar versión Baileys fijada contra comportamiento real actual.
- [ ] Revisar upgrades separadamente; no auto-upgrade.

## Privacy/security decisions still pending

- [x] Boundary propuesta + aprobación antes de Calendar write.
- [x] Calendar execution con ledger/idempotencia y doble acto explícito.
- [x] Chat-level Observer allowlist + workflow administrativo.
- [x] Retention/purge operacional y per-chat Observer.
- [ ] Decidir cifrado de SQLite y backups en el dispositivo final.
- [ ] Definir política de consentimiento/retención para chats observados antes de uso con terceros.
- [ ] Validar mediante QA real que third-party outbound permanece imposible.

## Stop point for risky features

El desarrollo automatizado puede continuar, pero **ningún QA manual anterior se considera aprobado**. Calendar writes, briefing programado y Observer siguen opt-in y requieren sus pruebas externas/reales antes de uso diario. Observer es estrictamente read-only: no se implementará respuesta automática a terceros dentro de este gate.
