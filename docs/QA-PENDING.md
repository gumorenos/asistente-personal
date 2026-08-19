# Testing / QA pending

Updated: 2026-08-18 (America/Lima)

Este archivo es la fuente de verdad del QA que requiere una sesión real, infraestructura externa o condiciones operativas que no deben darse por aprobadas únicamente por tests automatizados. El desarrollo puede continuar mientras estos checks permanecen pendientes.

## Stage 1 — automated development gates completed

- [x] Instalación reproducible con `package-lock.json` y `npm ci`.
- [x] TypeScript strict / `tsc --noEmit` pasa en Node 22.18.
- [x] Suite automatizada cubre core, SQLite, capabilities, scheduler, configuración, PN/LID guard y health/readiness.
- [x] Notas: crear/listar/completar/archivar.
- [x] Gastos: PEN, categorías, recategorización, rangos y resumen.
- [x] Recordatorios: sin fecha, relativos, hoy/mañana, weekday y fecha explícita.
- [x] Scheduler reintenta fallas y audita entrega.
- [x] Config/JIDs/input bounds validados.
- [x] `/healthz` y `/readyz` con tests HTTP.
- [x] Runtime dependency audit pasa.
- [x] Docker `linux/amd64` y `linux/arm64` pasan.

Resultado automatizado de cierre de Stage 1: **26 tests + typecheck + runtime audit + multi-arch Docker gates**.

## Stage 1 — WhatsApp pairing/session — manual / release-blocking

- [ ] Desplegar primero en entorno no crítico o con número de prueba.
- [ ] Configurar `WHATSAPP_ENABLED=true` y teléfono E.164 solo dígitos.
- [ ] Con `WHATSAPP_SELF_JIDS` vacío confirmar cero procesamiento/respuestas.
- [ ] Confirmar pairing code y vinculación.
- [ ] Confirmar credenciales/Signal keys en SQLite sin auth JSON folder.
- [ ] Reiniciar proceso y reconectar sin pairing code nuevo.
- [ ] Reiniciar físicamente RPi y reconectar.
- [ ] Desvincular desde WhatsApp -> `logged_out` sin reconnect loop.
- [ ] Simular pérdida/restauración de red sin respuestas duplicadas.

## Stage 1 — self-chat authorization — manual / release-blocking

- [ ] Validar PN confiable y, si aplica, LID antes de añadirlo a allowlist.
- [ ] `ping` -> exactamente un `pong`.
- [ ] `estado` y `ayuda` funcionan.
- [ ] Echo del propio reply no genera loop.
- [ ] Mensajes a/de terceros no se procesan ni responden.
- [ ] Grupos no se procesan/persisten.
- [ ] Caso PN/LID alternativo real responde por el JID autorizado.

## Stage 1 — commands on real self-chat

- [ ] Crear/listar/completar/archivar notas.
- [ ] Capturar/categorizar/listar/resumir gastos reales.
- [ ] Crear recordatorio corto y confirmar entrega única.
- [ ] Validar `mañana`, weekday y fechas explícitas en America/Lima.
- [ ] Cancelar reminder y comprobar que no se entrega.
- [ ] Reiniciar entre creación/vencimiento y comprobar persistencia.
- [ ] Vencer offline y comprobar reintento tras recuperar red.
- [ ] Reminder sin fecha no se envía espontáneamente.
- [ ] Boundary de medianoche y tildes/capitalización reales.

## Stage 2A — AI provider — manual / external QA

- [ ] Con `AI_ENABLED=false`, `ia hola` responde localmente que IA está deshabilitada y no hay tráfico de red.
- [ ] Configurar un endpoint OpenAI-compatible de prueba con modelo/API key no críticos.
- [ ] Confirmar que `ia hola` produce exactamente una llamada a `/chat/completions`.
- [ ] Confirmar mediante logs/proxy del proveedor que un mensaje normal sin prefijo `ia`/`ai` no genera tráfico externo.
- [ ] Confirmar que `anota`, `gastos`, `recordatorios`, `ping`, `estado` y `ayuda` no generan tráfico al proveedor.
- [ ] Verificar que la petición contiene solo system prompt fijo + prompt explícito actual, sin historial, notas, gastos ni recordatorios.
- [ ] Revisar `audit_log`: debe registrar provider/model/tamaños, nunca prompt ni respuesta.
- [ ] Revisar logs del proceso: `AI_API_KEY`, prompt y respuesta no deben aparecer por defecto.
- [ ] Simular HTTP 401/429/500 y confirmar respuesta segura sin body remoto ni ejecución de acciones.
- [ ] Simular timeout y confirmar error local seguro.
- [ ] Probar límites `AI_MAX_INPUT_CHARS`, `AI_MAX_REPLY_CHARS` y `AI_MAX_OUTPUT_TOKENS`.
- [ ] Confirmar que output que parezca un comando (`anota ...`, `recuérdame ...`) se devuelve como texto y NO se ejecuta.
- [ ] Medir latencia/costo del proveedor elegido antes de habilitarlo para uso diario.
- [ ] Revisar política de retención/privacidad del proveedor elegido antes de enviar información sensible.

## Health / operations — manual

- [ ] `/healthz` 200 en deployment real.
- [ ] `/readyz` refleja DB/transport durante startup/conexión/degradación.
- [ ] Puerto health no expuesto públicamente.
- [ ] SIGTERM/SIGINT cierra scheduler, transport, health y SQLite.
- [ ] Recuperación WAL/SHM después de kill no limpio.
- [ ] Permisos reales de directorio/DB en RPi.
- [ ] Backup/restore sobre copia descartable y verificación de row counts/migrations.
- [ ] Consumo CPU/RAM estable durante al menos 24h.

## Baileys reliability gaps before Observer mode

- [ ] Persisted raw WhatsApp message store para `getMessage()`.
- [ ] Validar resend/missing-message recovery.
- [ ] Validar versión Baileys fijada contra comportamiento real actual.
- [ ] Revisar upgrades de Baileys separadamente; no auto-upgrade.

## Privacy/security before non-self chats or external writes

- [ ] Chat-level allowlist y workflow administrativo.
- [ ] Retention/purge jobs.
- [ ] Decidir cifrado de SQLite/backups.
- [ ] Action-approval model antes de Calendar.
- [ ] Tests que prueben que third-party outbound no ocurre sin aprobación.

## Stop point for risky features

Stage 1 está cerrado a nivel de desarrollo pero su QA real sigue pendiente. Stage 2A puede desarrollarse en paralelo porque no amplía el perímetro de WhatsApp ni habilita acciones externas. **Observer, respuestas a terceros y Calendar writes siguen bloqueados hasta implementar sus boundaries de autorización.**
