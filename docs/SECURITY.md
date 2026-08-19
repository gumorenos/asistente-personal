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

1. **Opt-in at two levels.** `AI_ENABLED=false` por defecto y, aun habilitada, la IA solo se invoca con `ia`/`ai` explícito.
2. **No automatic data sharing.** Mensajes normales y comandos locales no salen al proveedor.
3. **No history/context export.** Una llamada contiene únicamente system prompt fijo + prompt explícito actual.
4. **No AI tools/actions.** El modelo devuelve texto; no puede escribir Calendar, mandar mensajes, cambiar SQLite ni ejecutar comandos.
5. **Remote TLS required.** `AI_BASE_URL` remoto debe usar HTTPS. HTTP solo se permite en loopback.
6. **Secrets stay in env.** `AI_API_KEY` no se persiste en SQLite ni se incluye en logs/audit.
7. **Audit without content.** Se registra proveedor/modelo/tamaños/resultado operacional, nunca prompt o respuesta.
8. **Bounded exposure.** Hay límites de input, output tokens, reply chars y timeout.
9. **Safe upstream errors.** Bodies de errores del proveedor no se incorporan a mensajes ni audit.

## Important limitations

Baileys usa el protocolo de WhatsApp Web y no la API oficial de Meta WhatsApp Business. Sigue existiendo riesgo de rotura de protocolo o restricciones de cuenta.

Un proveedor de IA remoto recibe el texto que el usuario escriba después de `ia`/`ai`. Su política de retención y privacidad depende del proveedor elegido; Stage 2A no puede garantizar qué hace el proveedor después de recibir ese prompt.

## Secrets

Tratar como secretos:

- `data/assistant.db` y WAL/SHM;
- `.env`;
- backups;
- pairing codes vigentes;
- `AI_API_KEY`.

Nunca commitear `.env` ni archivos de `data/`. Antes de backups remotos, usar cifrado en reposo o destino cifrado.

## Permission levels

- **Level 0:** lectura/resumen local.
- **Level 1:** notas, recordatorios y gastos locales — Stage 1.
- **Level 1E:** consulta externa de texto explícitamente solicitada, sin acciones — Stage 2A IA.
- **Level 2:** modificaciones externas como Calendar — requerirá confirmación explícita.
- **Level 3:** comunicación a terceros — requerirá confirmación explícita cada vez.

Stage 2A no implementa Level 2 ni Level 3.
