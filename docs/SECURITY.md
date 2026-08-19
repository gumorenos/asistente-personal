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
3. Con transcripción deshabilitada el loader no se invoca y el audio no se descarga para esta capability.
4. `fileLength` declarado se usa como pre-check; después se comprueba el tamaño real del buffer.
5. Audio que excede el límite no se envía al proveedor.
6. El buffer de audio no se persiste como archivo por la app; permanece efímero en memoria.
7. Endpoint remoto exige HTTPS; HTTP solo loopback.
8. `TRANSCRIPTION_API_KEY` queda en env y no entra en SQLite/audit/logs.
9. Audit registra proveedor/modelo/tamaños/MIME/estado, nunca bytes de audio, nombre de archivo ni transcript.
10. Error bodies upstream no se muestran.
11. La transcripción es texto terminal: no se reinyecta al router y no ejecuta comandos.

## Important limitations

Baileys usa el protocolo de WhatsApp Web y no la API oficial de Meta WhatsApp Business. Sigue existiendo riesgo de rotura de protocolo o restricciones de cuenta.

Un proveedor remoto de IA recibe el prompt explícito después de `ia`/`ai`. Un proveedor remoto de transcripción recibe el audio autorizado cuando la transcripción está habilitada. Sus políticas de retención/privacidad deben revisarse antes de uso con datos sensibles.

## Secrets

Tratar como secretos `data/assistant.db`, WAL/SHM, `.env`, backups, pairing codes, `AI_API_KEY` y `TRANSCRIPTION_API_KEY`.

## Permission levels

- **Level 0:** lectura/resumen local.
- **Level 1:** notas, recordatorios y gastos locales — Stage 1.
- **Level 1E:** envío externo explícito de texto/audio para obtener una respuesta sin acciones — Stage 2A/2B.
- **Level 2:** modificaciones externas como Calendar — requerirá confirmación explícita.
- **Level 3:** comunicación a terceros — requerirá confirmación explícita cada vez.

Stage 2A/2B no implementan Level 2 ni Level 3.
