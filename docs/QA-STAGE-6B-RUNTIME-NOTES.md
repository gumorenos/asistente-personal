# Stage 6B runtime invariants

- Scheduler is created only when `COMMITMENT_NOTIFICATIONS_ENABLED=true` passes config validation.
- Config requires WhatsApp enabled and a destination exactly contained in `WHATSAPP_SELF_JIDS`.
- Scheduler starts only after `transport.connect()` succeeds.
- Scheduler stops before transport disconnect during shutdown.
- No raw destination JID is added to startup logs; only enabled/configured booleans are logged.
- Audit on successful notification contains commitment id/event type only.
- Error logs contain commitment id + error class name only.
- Observer is not consulted by Stage 6B.
