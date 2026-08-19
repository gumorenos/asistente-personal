# Security model

## Stage 1 transport/local rules

1. **No automatic third-party messaging.** El transporte rechaza cualquier destino fuera de `WHATSAPP_SELF_JIDS`.
2. **No ambient observation.** Solo se procesa el self-chat autorizado.
3. **No message-based identity discovery.** Con la allowlist vacía se ignora todo mensaje.
4. **Canonical authorized destination.** PN/LID se resuelve al identificador que realmente pasó la allowlist.
5. **No message body logging by default.** `LOG_MESSAGE_CONTENT=false`.
6. **No full history sync.** Baileys usa `syncFullHistory=false`.
7. **No online-presence takeover.** `markOnlineOnConnect=false`.
8. **Auth state in SQLite.** Credenciales y Signal keys no usan multi-file JSON state.
9. **Local health endpoint.** Docker publica 8787 únicamente en loopback por defecto.
10. **Validated configuration and bounded commands.** Configuración y tamaños se validan al iniciar/procesar.
11. **Soft lifecycle transitions and mutation audit.** Notas/recordatorios cambian de estado y las mutaciones se auditan.
12. **Locked dependencies.** CI y Docker usan `package-lock.json` + `npm ci`; CI audita dependencias runtime.

## Stage 2A AI rules

1. `AI_ENABLED=false` por defecto y la IA requiere `ia`/`ai` explícito.
2. Mensajes normales/comandos locales no salen al proveedor.
3. No se exporta historial/contexto local.
4. No hay tools/actions.
5. Endpoint remoto exige HTTPS; HTTP solo loopback.
6. `AI_API_KEY` permanece en env y no entra en audit/logs.
7. Audit registra metadata, nunca prompt/respuesta.
8. Input/output/timeout están acotados.
9. Bodies de errores upstream no se muestran.

## Stage 2B transcription rules

1. `TRANSCRIPTION_ENABLED=false` por defecto.
2. Solo un audio que ya pasó la allowlist de self-chat puede recibir un `loadMedia` utilizable.
3. Con transcripción deshabilitada el loader no se invoca.
4. `fileLength` declarado se usa como pre-check; luego se comprueba el tamaño real del buffer.
5. Audio que excede límites no se envía al proveedor.
6. El buffer no se persiste como archivo por la app.
7. Endpoint remoto exige HTTPS; HTTP solo loopback.
8. `TRANSCRIPTION_API_KEY` queda en env y no entra en SQLite/audit/logs.
9. Audit no guarda bytes, nombre de archivo ni transcript.
10. Bodies de error upstream no se muestran.
11. El transcript es texto terminal y no ejecuta comandos.

## Stage 2C action approval / Calendar proposal rules

1. **Proposal is not execution.** `agenda ...` solo crea una fila local `action_requests` con estado `pending`.
2. **Approval is not execution.** `aprueba acción #N` cambia estado local a `approved`; Stage 2C no contiene ningún Google Calendar client/executor.
3. **Atomic decision.** Solo una acción `pending` puede pasar una vez a `approved` o `rejected`.
4. **Expiry.** Propuestas Calendar tienen `expires_at=startAt`; una propuesta vencida no se lista ni puede aprobarse.
5. **No hidden action creation from AI/audio.** Output de IA/transcripción no se reinyecta en `CalendarProposalCapability` ni en `ActionApprovalCapability`.
6. **Bounded payloads.** `action_type`, summary y `payload_json` se validan/acotan antes de persistir.
7. **Audit minimization.** Audit registra action type/timing/decision, no el título ni payload completo.
8. **Local sensitive payload.** El payload Calendar se almacena en SQLite y debe tratarse con la misma sensibilidad que notas/reminders.
9. **No external network requirement.** Crear/listar/aprobar/rechazar propuestas no requiere ni debe producir tráfico a Google.
10. **Future executor must revalidate.** Una futura capa de write no podrá confiar solo en `approved`: deberá validar schema/vigencia/provider y usar idempotencia.

## Important limitations

Baileys usa el protocolo de WhatsApp Web y no la API oficial de Meta WhatsApp Business. Sigue existiendo riesgo de rotura de protocolo o restricciones de cuenta.

Un proveedor remoto de IA recibe el prompt explícito después de `ia`/`ai`. Un proveedor remoto de transcripción recibe el audio autorizado cuando la transcripción está habilitada. Sus políticas de retención/privacidad deben revisarse antes de uso con datos sensibles.

Stage 2C todavía no autentica contra Google y por diseño no puede crear/modificar eventos reales.

## Secrets

Tratar como secretos `data/assistant.db`, WAL/SHM, `.env`, backups, pairing codes, `AI_API_KEY` y `TRANSCRIPTION_API_KEY`. Un futuro OAuth refresh token de Calendar también será secreto y no deberá aparecer en logs/audit.

## Permission levels

- **Level 0:** lectura/resumen local.
- **Level 1:** notas, recordatorios y gastos locales — Stage 1.
- **Level 1E:** envío externo explícito de texto/audio para obtener respuesta sin acciones — Stage 2A/2B.
- **Level 1P:** propuesta y consentimiento local para una futura acción externa, sin ejecución — Stage 2C.
- **Level 2:** modificaciones externas como Calendar — requiere executor explícito, consentimiento previo, revalidación e idempotencia.
- **Level 3:** comunicación a terceros — requerirá confirmación explícita cada vez.

Stage 2 actual no implementa Level 2 ni Level 3.
