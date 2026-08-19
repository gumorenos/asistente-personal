# Security model

## Current rules

1. **No automatic third-party messaging.** Stage 0 transport refuses all destinations outside `WHATSAPP_SELF_JIDS`.
2. **No ambient observation.** Only explicitly configured self-chat JIDs are processed.
3. **No message body logging by default.** `LOG_MESSAGE_CONTENT=false` is the default.
4. **No full history sync.** Baileys starts with `syncFullHistory=false`.
5. **No online-presence takeover.** `markOnlineOnConnect=false` is used so the linked client does not intentionally suppress phone notifications.
6. **Auth state in SQLite.** Credentials and signal keys are not written as Baileys multi-file JSON state.
7. **Local health endpoint.** Docker publishes port 8787 only on `127.0.0.1` by default.
8. **Data directory permissions.** The application attempts to keep its data directory at mode `0700`.

## Important limitation

Baileys uses WhatsApp Web's protocol and is not the official Meta WhatsApp Business API. Account restrictions or protocol breakage remain possible. Do not use this project for bulk messaging, unsolicited messaging, scraping, stalking, or automated outreach.

## Secrets

The SQLite database contains sensitive WhatsApp authentication material. Treat `data/assistant.db`, its WAL/SHM files, and every backup as secrets.

Before remote backups are enabled, add encryption at rest or an encrypted backup target. Never commit `.env` or the `data/` database files.

## Future permission levels

- Level 0: local read/summarize.
- Level 1: local notes/reminders/expenses.
- Level 2: external state changes such as Calendar; confirmation required.
- Level 3: communication to third parties; explicit confirmation required every time.
