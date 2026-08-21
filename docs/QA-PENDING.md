# Testing / QA pending

Updated: 2026-08-21 (America/Lima)

Este archivo es la fuente de verdad del QA que requiere una sesión WhatsApp real, proveedores externos, infraestructura final o condiciones operativas que no deben darse por aprobadas únicamente por tests automatizados. **El desarrollo puede continuar mientras estos checks permanezcan pendientes.**

## Último gate automatizado conocido — Stage 3

Sobre el código Stage 3A/B/C:

- [x] `npm ci` reproducible.
- [x] TypeScript strict en Node 22.18.
- [x] **151/151 tests PASS**.
- [x] `npm audit --omit=dev --audit-level=high`: **0 vulnerabilidades**.
- [x] Migraciones 1→13 sobre DB nueva cubiertas automáticamente.
- [x] SQLite FTS5 disponible en CI.
- [x] Búsqueda personal y Observer usan índices FTS físicamente separados.
- [x] Filtros por fuente, timezone y rango custom cubiertos.
- [x] Audit de búsqueda no guarda query/resultados ni fechas custom concretas.
- [ ] Docker `linux/amd64` del HEAD documental final — confirmar conclusión del último CI.
- [ ] Docker `linux/arm64` del HEAD documental final — confirmar conclusión del último CI.

Los gates automatizados no sustituyen ninguno de los checks manuales siguientes.

---

## QA ejecutado por OpenClaw — 2026-08-21

Commit probado:

`271402b71e1e890a3581d76667ddb876484d5e66`

Resultado global reportado: **BLOCKED**, principalmente por falta de sesión/número WhatsApp QA explícito y credenciales externas no críticas.

Entorno:

- host `vnic-gumorenos`;
- Ubuntu Linux 6.17.0-1019-oracle, `aarch64`;
- Node 22.23.2;
- npm 10.9.8;
- Docker 29.7.2;
- Baileys 7.0.0-rc13;
- checkout detached y limpio.

Evidencia obtenida en ese run:

- PASS: SHA remoto/PR, `npm ci`, typecheck + 128/128 tests de ese commit, runtime audit sin high+, Docker ARM64.
- BLOCKED host-only: Docker AMD64 en Oracle ARM64 sin binfmt/QEMU; no se consideró bug del repo.
- PASS local: ping/dedupe, estado/ayuda, notas, gastos, recordatorios/retry y persistencia SQLite.
- PASS local fake / BLOCKED externo: IA explícita, audio/transcripción y Calendar conservaron los boundaries esperados, sin proveedores externos reales.
- PASS local: briefing, dedupe diario y purge operacional del schema existente en ese commit.
- PASS local / PENDING live: Observer allowlist, PN/LID simulado, media sin loader, idempotencia, lectura limitada, disable y retención.
- PASS parcial operaciones: health/readiness local con transport disabled, loopback, SIGTERM, WAL, migraciones 1–9 y backup/restore básico.
- PENDING: pairing WhatsApp, restart/reboot/red reales, PN/LID/grupos reales, outbound real bloqueado a terceros, voice note real, Google/AI externos, briefing/Observer live y estabilidad 24 h.
- Hallazgo de código: en `271402b`, Baileys `getMessage` devolvía siempre `undefined`. Esto fue corregido posteriormente por Stage 2G (migraciones v10/v11 + store persistente), pero el recovery live sigue pendiente.

**No se consideran aprobados** los checks externos/live solo porque su equivalente local/fake haya pasado.

---

# Stage 1 — WhatsApp / RPi / core local

## Manual / release-blocking

- [ ] Desplegar primero con número/sesión no críticos.
- [ ] Pairing real con `WHATSAPP_ENABLED=true`.
- [ ] Allowlist self vacía => cero procesamiento y cero respuestas.
- [ ] Credenciales/Signal keys permanecen en SQLite; no aparece auth JSON folder.
- [ ] Restart del proceso reconecta sin pairing nuevo.
- [ ] Reboot físico del host final reconecta sin pairing nuevo.
- [ ] Logout real deja estado `logged_out` sin reconnect loop.
- [ ] Pérdida/restauración de red no genera replies duplicados.
- [ ] Validar PN y LID reales si WhatsApp entrega ambas identidades.
- [ ] `ping` produce exactamente un `pong`.
- [ ] `estado` y `ayuda` funcionan desde self-chat real.
- [ ] Echo del propio reply no genera loop.
- [ ] Mensajes reales de terceros/grupos nunca reciben replies.
- [ ] Caso PN/LID alternativo responde únicamente por un JID autorizado.
- [ ] Crear/listar/completar/archivar notas desde WhatsApp.
- [ ] Capturar/categorizar/listar/resumir gastos desde WhatsApp.
- [ ] Recordatorios: entrega única, cancelación, persistencia y retry offline reales.
- [ ] Boundary de medianoche/tildes/capitalización en `America/Lima`.

---

# Stage 2A — IA explícita

## Manual / external QA

- [ ] `AI_ENABLED=false`: `ia hola` genera cero tráfico externo real.
- [ ] Configurar endpoint OpenAI-compatible QA con credenciales no críticas.
- [ ] `ia hola` produce exactamente una llamada a `/chat/completions`.
- [ ] Mensaje normal y comandos locales generan cero tráfico AI.
- [ ] Request real contiene solo system prompt fijo + prompt explícito actual.
- [ ] Logs/audit no contienen API key, prompt ni respuesta.
- [ ] HTTP 401/429/500 y timeout devuelven error seguro sin body upstream.
- [ ] Límites de input/output/tokens se respetan.
- [ ] Output que parezca comando no se ejecuta.
- [ ] Medir latencia/costo y revisar política real de retención/privacidad del proveedor elegido.

Evidencia previa: fake provider PASS para disabled/no-call, llamada explícita única, request mínimo y error seguro.

---

# Stage 2B — audio / transcripción

## Manual / external QA

- [ ] `TRANSCRIPTION_ENABLED=false`: una nota de voz autorizada real no genera upload al proveedor.
- [ ] Audio de terceros/grupos no obtiene una ruta de transcripción útil.
- [ ] Configurar `/audio/transcriptions` QA con credenciales/modelo no críticos.
- [ ] Nota de voz WhatsApp real OGG/Opus se descarga una sola vez y se transcribe correctamente.
- [ ] `fileLength` declarado por encima de `TRANSCRIPTION_MAX_BYTES` se rechaza antes de download.
- [ ] Bytes reales por encima del límite se rechazan antes de upload.
- [ ] Request contiene solo audio + modelo.
- [ ] Logs/audit no contienen audio, filename, transcript ni API key.
- [ ] HTTP 401/429/500 y timeout devuelven error seguro.
- [ ] Transcript que diga `anota`, `recuérdame`, `agenda`, etc. se muestra como texto y no se ejecuta.
- [ ] Medir RAM, latencia/costo y política de retención del proveedor.

Evidencia previa: fake provider PASS para no-download, límites pre/post y transcript terminal/no ejecutable.

---

# Stage 2C — propuestas / aprobación

## Manual / self-chat QA

- [ ] `agenda mañana a las 10 reunión de prueba por 30 minutos` crea una única propuesta.
- [ ] `aprueba acción #N` cambia una sola vez a `approved` y todavía no crea evento.
- [ ] `rechaza acción #N` cambia una sola vez a `rejected`.
- [ ] Estados pending/approved/rejected sobreviven restart/reboot real.
- [ ] Propuesta caducada no puede aprobarse.
- [ ] Audit real no contiene título/payload.
- [ ] `mañana`, weekdays, `DD/MM`, ISO y duración funcionan en `America/Lima`.

---

# Stage 2D — Google Calendar

## Manual / external QA

- [ ] Crear OAuth client QA con mínimo alcance necesario y refresh token no crítico.
- [ ] Token refresh real funciona y secretos no entran a SQLite/audit/logs.
- [ ] `CALENDAR_ENABLED=false`: `ejecuta acción #N` genera cero tráfico Google.
- [ ] Acción pending/rejected/caducada jamás crea evento.
- [ ] Acción approved crea evento únicamente tras `ejecuta acción #N`.
- [ ] Repetir ejecución no crea duplicado.
- [ ] Simular caída después del create remoto y antes del commit local; retry recupera el mismo evento.
- [ ] Validar timezone, duración y título del evento real.
- [ ] Refresh token inválido/revocado falla de forma segura.
- [ ] Revisar scopes, almacenamiento de secretos y estrategia de rotación.

---

# Stage 2E — briefing / retención

## Manual

- [ ] `briefing` muestra recordatorios, notas, gasto del mes y acciones pendientes con datos reales.
- [ ] `BRIEFING_ENABLED=false`: cero envío programado.
- [ ] Briefing automático se entrega una sola vez por fecha local incluso tras restart.
- [ ] Retry offline no produce duplicados.
- [ ] `RETENTION_ENABLED=false`: no elimina filas operativas.
- [ ] Con ventanas cortas en DB QA, confirmar purge exacto de `messages`, `whatsapp_message_store`, outbound, audit y briefing deliveries.
- [ ] Notas/gastos/recordatorios/actions/allowlists/auth sobreviven al purge.
- [ ] Backup/restore antes y después del purge; revisar WAL/SHM y tamaño DB.

---

# Stage 2F — Observer read-only

## Manual / release-blocking antes de uso diario

- [ ] `OBSERVER_ENABLED=false`: chats presentes en `observed_chats` generan cero observaciones nuevas.
- [ ] Observer habilitado + allowlist vacía: terceros/grupos generan cero filas.
- [ ] `observa chat <jid> como <label>` inicia captura solo para ese chat.
- [ ] Chat no allowlisted nunca se persiste.
- [ ] Grupo allowlisted persiste `chat_jid`, sender y texto correctamente.
- [ ] PN/LID alternativo real se canonicaliza al JID allowlisted.
- [ ] Mensaje observado jamás genera reply, nota, gasto, reminder, acción, IA, transcripción ni Calendar traffic.
- [ ] Audio/imagen/documento/video observado no descarga media ni crea observación text-only falsa.
- [ ] Observer/terceros/grupos no crean filas en `whatsapp_message_store`.
- [ ] Duplicado/resend del mismo message ID crea una sola fila.
- [ ] `observaciones <jid>` devuelve solo el JID exacto solicitado.
- [ ] `observaciones <jid> 10` respeta límite/truncamiento/timezone; `11` se rechaza.
- [ ] `deja de observar <jid>` detiene nuevas filas sin restart.
- [ ] Filas ya retenidas siguen consultables hasta purge y se identifican como chat deshabilitado.
- [ ] Restart/reboot conserva allowlist/observaciones.
- [ ] Retención por chat respeta ventanas diferentes, p.ej. 1 día vs 30 días.
- [ ] Logs normales Observer no contienen texto/JID/label.
- [ ] Audit de lectura no contiene texto/JID crudo/label.
- [ ] Medir CPU/RAM/crecimiento DB durante ≥24 h.
- [ ] Revisar consentimiento, necesidad y minimización antes de observar conversaciones de terceros.

---

# Stage 2G — Baileys retry / `getMessage`

## Automated — implementado

- [x] v10 crea `whatsapp_message_store`.
- [x] v11 añade `remote_jid_alt` e índice PN/LID.
- [x] `getMessage` consulta SQLite.
- [x] Outbound se guarda después de `sendMessage` exitoso.
- [x] Inbound se guarda solo tras autorizar self-chat.
- [x] Observer/ignored no entra al raw retry store.
- [x] `BufferJSON` preserva campos binarios.
- [x] Upsert idempotente y lookup por same `message_id` + primary/alias JID.
- [x] PN/LID invertidos no duplican ni pierden el alias.
- [x] Store sigue `MESSAGE_RETENTION_DAYS` si retención está habilitada.

## Manual / live WhatsApp

- [ ] Mensajes self reales crean filas recuperables y sobreviven restart.
- [ ] Mismo `message_id` se recupera por PN o LID reales.
- [ ] Forzar/observar `getMessage()` durante resend/missing-message recovery.
- [ ] Validar resend/missing-message recovery end-to-end.
- [ ] Confirmar live que terceros/grupos/Observer no generan filas raw.
- [ ] Confirmar purge real del store.
- [ ] Validar la versión Baileys fijada contra comportamiento live.
- [ ] Upgrades Baileys se prueban separadamente; no auto-upgrade.

---

# Stage 3 — memoria / búsqueda local FTS5

## Automated — Stage 3A

- [x] v12 crea `self_memory_fts` y `observation_fts` como índices separados.
- [x] Backfill inicial de messages/notas/observations.
- [x] Triggers INSERT/UPDATE/DELETE mantienen índices sincronizados.
- [x] `self_memory_fts` nunca devuelve contenido Observer.
- [x] Query compiler limita 200 chars / 8 tokens y no ejecuta sintaxis FTS cruda.
- [x] Matching Unicode/diacríticos/prefijos funciona.
- [x] `busca <texto>` excluye el propio `message_id` del comando.
- [x] Observer search exige JID administrativamente conocido + SQL exact `chat_jid = ?`.
- [x] Dos chats con la misma keyword no se mezclan.
- [x] Purge base elimina entradas FTS correspondientes.

## Automated — Stage 3B

- [x] v13 incorpora recordatorios y gastos a `self_memory_fts`.
- [x] Recordatorio usa `due_at` si existe; si no, creación.
- [x] Gasto indexa descripción + categoría + moneda + monto.
- [x] Recategorizar un gasto actualiza el índice.
- [x] Filtros `mensajes`, `notas`, `recordatorios`, `gastos` no mezclan fuentes.
- [x] Audit guarda source/counts, no query/resultados.

## Automated — Stage 3C

- [x] `hoy`, `semana`, `mes` usan los mismos boundaries timezone-aware que gastos.
- [x] Custom `desde YYYY-MM-DD hasta YYYY-MM-DD` es inclusivo para el usuario e interno `[start,endExclusive)`.
- [x] Límites exactos de medianoche `America/Lima` cubiertos.
- [x] Rango inválido/invertido se rechaza sin ejecutar búsqueda.
- [x] Audit guarda `temporalScope` y no las fechas custom concretas.
- [x] Repository valida bounds temporales.

## Manual / deployment QA

- [ ] Ejecutar migraciones v12/v13 sobre **copia de una DB real existente** y validar backfill.
- [ ] `busca filtro` desde WhatsApp real encuentra mensaje/nota anterior sin devolver el propio comando.
- [ ] `busca notas presupuesto` devuelve solo notas.
- [ ] `busca recordatorios visa` devuelve solo recordatorios.
- [ ] `busca gastos taxi` devuelve solo gastos y muestra términos actuales tras recategorización.
- [ ] Mayúsculas/tildes/prefijos reales (`reun`, `reunión`) funcionan.
- [ ] Keyword presente solo en Observer produce cero resultados con `busca <keyword>`.
- [ ] Dos chats Observer con misma keyword: `busca observaciones <jidA> <keyword>` devuelve exclusivamente JID A.
- [ ] JID Observer desconocido administrativamente se rechaza.
- [ ] Chat Observer deshabilitado permite buscar únicamente filas retenidas hasta purge.
- [ ] `busca gastos hoy taxi` respeta medianoche Lima.
- [ ] `busca ... semana ...` empieza en lunes local.
- [ ] `busca ... mes ...` respeta primer día local.
- [ ] Custom range incluye ambos días pedidos y excluye el día posterior.
- [ ] Logs/audit reales no contienen query/resultados ni fechas custom concretas.
- [ ] Medir latencia/tamaño adicional DB/FTS con volumen real.
- [ ] Backup/restore con FTS; búsquedas siguen funcionando tras restore.

Estos checks de Stage 3 pueden agruparse posteriormente con el QA WhatsApp/RPi mediante OpenClaw. **No bloquean continuar el desarrollo mientras los gates automatizados permanezcan verdes.**

---

# Health / operations

- [ ] `/healthz` 200 y `/readyz` refleja DB/transport en deployment live.
- [ ] Puerto health no expuesto públicamente.
- [ ] SIGTERM/SIGINT cierra schedulers, transport, health y SQLite.
- [ ] Recuperación WAL/SHM tras kill no limpio.
- [ ] Permisos reales de directorio/DB en host final.
- [ ] Backup/restore y row counts con migraciones **1→13** sobre DB nueva y DB existente.
- [ ] CPU/RAM/DB estables durante ≥24 h.

---

# Privacy / security decisions pending

- [x] Proposal + approval antes de Calendar write.
- [x] Calendar execution con ledger/idempotencia y doble acto explícito.
- [x] Observer chat allowlist + retención por chat.
- [x] Raw retry store limitado a self-chat autorizado/outbound.
- [x] Alias PN/LID no amplía lookup sin same `message_id`.
- [x] FTS personal y Observer físicamente separados.
- [x] Observer search exact-JID only.
- [x] Stage 3 no usa IA/embeddings/providers externos.
- [ ] Decidir cifrado de SQLite y backups en dispositivo final.
- [ ] Definir política de consentimiento/retención de chats observados antes de uso con terceros.
- [ ] Validar live que third-party outbound permanece imposible.

## Stop point for risky features

El desarrollo automatizado puede continuar, pero **ningún QA manual anterior se considera aprobado**. Calendar writes, briefing programado y Observer siguen opt-in y requieren sus pruebas externas/reales antes de uso diario. Observer permanece estrictamente read-only; no se implementará respuesta automática a terceros dentro de estos gates.
