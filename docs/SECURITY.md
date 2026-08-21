# Security model

## Stage 1 transport/local rules

1. **No automatic third-party messaging.** `sendText()` rechaza cualquier destino fuera de `WHATSAPP_SELF_JIDS`.
2. **Self-chat guard remains authoritative for commands.** Solo mensajes `fromMe=true`, no-grupo y allowlisted pueden entrar a `AssistantCore`.
3. **No message-based identity discovery.** La app no autoriza identidades a partir de mensajes recibidos.
4. **Canonical authorized destination.** PN/LID se resuelve al identificador que realmente pasó la allowlist.
5. **No message body logging by default.** `LOG_MESSAGE_CONTENT=false`.
6. **No full history sync.** Baileys mantiene `syncFullHistory=false`.
7. **No online-presence takeover.** `markOnlineOnConnect=false`.
8. **Auth state in SQLite.** Credenciales y Signal keys no usan multi-file JSON state.
9. **Local health endpoint.** Docker publica health únicamente en loopback por defecto.
10. **Validated configuration and bounded commands.** Configuración y tamaños se validan al iniciar/procesar.
11. **Soft lifecycle + audit.** Mutaciones locales quedan auditadas sin copiar contenido sensible innecesario.
12. **Locked dependencies.** CI/Docker usan `package-lock.json` + `npm ci` y audit runtime.

## Stage 2A — AI rules

1. `AI_ENABLED=false` por defecto; solo `ia`/`ai` explícito invoca al proveedor.
2. Mensajes normales/comandos locales no salen al proveedor.
3. No se exporta historial/contexto local automáticamente.
4. No hay tools/function calling ni acciones.
5. Endpoint remoto exige HTTPS; HTTP solo loopback.
6. API key queda en env y no entra en audit/logs.
7. Audit registra metadata, nunca prompt/respuesta.
8. Input/output/timeout están acotados.
9. Error bodies upstream no se muestran.

## Stage 2B — transcription rules

1. `TRANSCRIPTION_ENABLED=false` por defecto.
2. Solo audio que ya pasó self-chat guard puede recibir `loadMedia()`.
3. Con transcripción deshabilitada el loader no se invoca.
4. `fileLength` declarado se valida antes de download y los bytes reales antes de upload.
5. Audio fuera de límites no se envía al proveedor.
6. El buffer no se persiste como archivo por la app.
7. Endpoint remoto exige HTTPS; HTTP solo loopback.
8. API key queda en env y no entra en SQLite/audit/logs.
9. Audit no guarda bytes, filename ni transcript.
10. Error bodies upstream no se muestran.
11. El transcript es terminal y no se reinyecta como comando.

## Stage 2C — proposal and approval rules

1. `agenda ...` crea una `action_request` local `pending`.
2. `aprueba acción #N` solo cambia estado local a `approved`.
3. Solo una acción `pending` puede transicionar una vez a `approved` o `rejected`.
4. Propuestas Calendar expiran en `startAt` y no pueden aprobarse vencidas.
5. Output de IA/transcripción no se reinyecta en proposal/approval capabilities.
6. Payloads se validan y acotan antes de persistir.
7. Audit registra tipo/timing/decision, no título/payload completo.
8. El payload Calendar local debe tratarse con sensibilidad equivalente a notas/reminders.

## Stage 2D — Calendar execution rules

1. `CALENDAR_ENABLED=false` por defecto.
2. Habilitar Calendar requiere credenciales OAuth explícitas.
3. **Approval is still not execution.** Un write requiere además `ejecuta acción #N` desde el self-chat.
4. Executor acepta únicamente action type soportado y estado `approved`.
5. Payload, timezone y vigencia se revalidan inmediatamente antes del write.
6. `action_executions` mantiene ledger por action ID e idempotency key.
7. Retries reutilizan la misma key; ejecución reciente en `started` bloquea concurrencia.
8. Una lease `started` huérfana puede recuperarse con la misma key tras la ventana de crash.
9. Google provider deriva un event ID determinista de la idempotency key.
10. `409 duplicate` se verifica contra el event ID esperado en vez de crear otro evento.
11. Un `401` permite un único refresh/retry controlado.
12. Refresh token/client secret/client ID no se escriben en audit ni logs por diseño.
13. Propuestas/listados/aprobación/rechazo no requieren ni deben producir tráfico Google.

## Stage 2E — briefing and operational retention

1. `BRIEFING_ENABLED=false` por defecto.
2. El briefing es determinista y no llama IA.
3. El destino debe coincidir exactamente con un JID de `WHATSAPP_SELF_JIDS`.
4. Delivery ledger evita más de un envío por fecha local.
5. `RETENTION_ENABLED=false` por defecto.
6. La retención operacional solo purga normalized self-chat messages, outbound IDs, audit y briefing deliveries.
7. No purga notas, gastos, recordatorios, action requests, allowlists ni credenciales.

## Stage 2F — Observer read-only rules

Observer introduce lectura limitada de chats de terceros/grupos, pero **no introduce permiso de comunicación**.

1. `OBSERVER_ENABLED=false` por defecto.
2. Activarlo exige `WHATSAPP_ENABLED=true` y al menos un self-JID administrativo explícito.
3. Cada chat requiere además una fila `observed_chats.enabled=1`.
4. El self-chat route y Observer route son mutuamente excluyentes.
5. `ObserverService` no recibe `MessageTransport`, `AssistantCore`, capabilities ni providers externos.
6. `SqliteObservationSink` usa una tabla `observations` separada de `messages`.
7. Solo se acepta `kind=text`, entre 1 y 4.000 caracteres.
8. El route Observer nunca adjunta `loadMedia()`; audio/imágenes/documentos/video no se descargan.
9. Unique `(chat_jid,message_id)` hace idempotente el almacenamiento.
10. Deshabilitar un chat detiene writes futuros inmediatamente.
11. Cada chat tiene retención 1–90 días, default 7.
12. `ObserverRetentionScheduler` aplica esa retención aunque `RETENTION_ENABLED=false`.
13. Audit del purge almacena solo counts, no JID/label/texto.
14. Errores Observer se loguean sin contenido/JID.
15. Ningún mensaje observado puede crear nota, gasto, reminder, proposal, approval o Calendar write.
16. Ningún mensaje observado puede invocar IA/transcripción automáticamente.
17. Ningún componente Observer expone o recibe `sendText()`.
18. No hay respuestas automáticas a terceros/grupos dentro de este stage.

## Important limitations

Baileys usa el protocolo de WhatsApp Web y no la API oficial de Meta WhatsApp Business. Existe riesgo de rotura de protocolo, restricciones de cuenta y diferencias PN/LID que requieren QA real.

Un proveedor remoto de IA recibe el prompt explícito después de `ia`/`ai`. Un proveedor remoto de transcripción recibe audio autorizado cuando la feature está habilitada. Google recibe datos del evento únicamente tras approval + ejecución explícita y con Calendar habilitado.

Observer puede almacenar contenido de terceros cuando está activado y el chat fue allowlisted. Antes de usarlo con conversaciones reales deben definirse necesidad, consentimiento aplicable, minimización y retención apropiada.

## Secrets

Tratar como secretos:

- `data/assistant.db`, WAL/SHM y backups;
- `.env`;
- pairing codes;
- `AI_API_KEY`;
- `TRANSCRIPTION_API_KEY`;
- `GOOGLE_CALENDAR_CLIENT_SECRET`;
- `GOOGLE_CALENDAR_REFRESH_TOKEN`;
- cualquier backup que contenga `observations`.

## Permission levels

- **Level 0:** lectura/resumen local del propio estado.
- **Level 1:** notas, reminders y gastos locales.
- **Level 1E:** envío externo explícito de texto/audio para obtener respuesta sin acciones.
- **Level 1O:** Observer read-only: persistencia local minimizada de chats expresamente allowlisted; cero outbound.
- **Level 1P:** propuesta/consentimiento local de una acción externa.
- **Level 2:** modificación externa como Google Calendar; requiere enable explícito + approval + ejecución separada + revalidación + idempotencia.
- **Level 3:** comunicación a terceros. **No implementada.**

El Stage 2 actual implementa hasta Level 2 para Calendar bajo doble acto explícito. Observer permanece Level 1O y no habilita Level 3.
