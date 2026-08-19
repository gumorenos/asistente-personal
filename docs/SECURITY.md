# Security model

## Stage 1 rules

1. **No automatic third-party messaging.** El transporte rechaza cualquier destino fuera de `WHATSAPP_SELF_JIDS`.
2. **No ambient observation.** Stage 1 solo procesa el self-chat autorizado.
3. **No message-based identity discovery.** Con la allowlist vacía se ignora todo mensaje; un mensaje que tú envíes a otra persona no puede convertirse en identidad propia candidata.
4. **Canonical authorized destination.** Si WhatsApp entrega PN/LID alternativos, el core usa como destino el JID que realmente coincidió con la allowlist.
5. **No message body logging by default.** `LOG_MESSAGE_CONTENT=false`.
6. **No full history sync.** Baileys usa `syncFullHistory=false`.
7. **No online-presence takeover.** `markOnlineOnConnect=false`.
8. **Auth state in SQLite.** Credenciales y Signal keys no se guardan mediante el multi-file JSON state de ejemplo de Baileys.
9. **Local health endpoint.** Docker publica 8787 únicamente en `127.0.0.1` por defecto.
10. **Data directory permissions.** La app intenta mantener el directorio de datos con modo `0700`.
11. **Validated configuration.** Timezone, booleanos, teléfono y formatos de self-JID se validan al iniciar; grupos y JIDs malformados son rechazados.
12. **Bounded commands.** Los comandos locales excesivamente largos se rechazan.
13. **Soft lifecycle transitions.** Notas y recordatorios cambian de estado; Stage 1 no implementa borrado destructivo mediante comandos de chat.
14. **Mutation audit.** Creación/cambio de estado/categoría/entrega se registra sin duplicar cuerpos sensibles en metadata del audit log.
15. **Locked dependencies.** CI y Docker usan `package-lock.json` + `npm ci`, y CI ejecuta audit de dependencias de runtime con umbral `high`.

## Important limitation

Baileys usa el protocolo de WhatsApp Web y no la API oficial de Meta WhatsApp Business. Sigue existiendo riesgo de rotura de protocolo o restricciones de cuenta. No usar este proyecto para bulk messaging, unsolicited messaging, scraping, stalking o automated outreach.

## Secrets

La base SQLite contiene material sensible de autenticación de WhatsApp. Trata como secretos:

- `data/assistant.db`;
- archivos WAL/SHM;
- `.env`;
- cualquier backup de la base;
- pairing codes mientras estén vigentes.

Antes de habilitar backups remotos, usar cifrado en reposo o un destino de backup cifrado. Nunca commitear `.env` ni archivos de `data/`.

## Permission levels for future stages

- **Level 0:** lectura/resumen local.
- **Level 1:** notas, recordatorios y gastos locales — implementado en Stage 1.
- **Level 2:** modificaciones externas como Calendar — requerirá confirmación explícita.
- **Level 3:** comunicación a terceros — requerirá confirmación explícita cada vez.

Stage 1 no implementa Level 2 ni Level 3.
