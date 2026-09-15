# Stage 8B — deterministic executive priorities

Stage 8B adds an explicit, read-only daily-priorities view. It is intentionally deterministic and does not use AI.

## Commands

- `prioridades`
- `prioridades hoy`
- `qué priorizo hoy`

Command matching is accent-insensitive and accepts normal Spanish opening/closing question punctuation. Unrelated text is not intercepted.

## Opt-in and defaults

The feature is disabled by default:

```env
EXECUTIVE_PRIORITIES_ENABLED=false
EXECUTIVE_PRIORITIES_MAX_ACTION_ITEMS=5
EXECUTIVE_PRIORITIES_MAX_GMAIL_MESSAGES=3
EXECUTIVE_PRIORITIES_MAX_REPLY_CHARS=2500
```

Bounds are validated at startup/doctor:

- action items: 1–10;
- Gmail metadata rows: 1–5;
- reply length: 800–6000 characters.

Enabling Stage 8B does not enable Calendar or Gmail. Those sources are used only when their independent read-only features are already enabled.

## Deterministic ordering

The action section uses local commitments and reminders only.

1. Open commitments already due and pending reminders already due are placed under `Atiende ahora`.
2. Remaining open commitments and pending reminders due before the end of the current local day are placed under `Después hoy`.
3. Each bucket is ordered by due time with stable deterministic tie-breaking.
4. The global `EXECUTIVE_PRIORITIES_MAX_ACTION_ITEMS` cap is applied with overdue work first.

Undated items, closed/cancelled items and items after the current local day are excluded from the action ranking.

The local-day boundary uses the configured application timezone (normally `America/Lima`).

## Calendar context

When Stage 5A Calendar read is enabled, Stage 8B asks only for the next remaining event today:

- range starts at the current instant;
- range ends at local day end;
- provider result limit is 1;
- no free/busy query;
- no slot suggestion;
- no exact-availability query;
- no Calendar write.

The event title is treated as untrusted text and sanitized before rendering. Provider IDs are never rendered or audited.

If Calendar read is disabled, the output says so without calling the provider. If the provider fails, the failure is isolated and local priorities still render; upstream error details are not exposed.

## Gmail context

When Stage 7A Gmail metadata read is enabled, Stage 8B requests only a bounded unread INBOX metadata view:

```text
listInbox({ unreadOnly: true, limit: EXECUTIVE_PRIORITIES_MAX_GMAIL_MESSAGES })
```

Only sanitized `From`, `Subject`, unread state and ordering date are consumed. The service defensively drops any returned row that is not marked unread and sorts the remaining metadata deterministically newest-first.

Stage 8B never requests or consumes:

- message body;
- snippet;
- attachments;
- full/raw payload;
- Gmail search;
- Gmail IDs/thread IDs in output or audit;
- Stage 7D AI analysis.

Unread mail is **context only**. Stage 8B explicitly states that unread does not imply urgency and never labels a message urgent/high-priority based only on metadata.

If Gmail read is disabled, no provider call occurs. Provider failure is isolated and does not suppress local/Calendar sections.

## Privacy and safety boundary

Stage 8B:

- is explicit self-chat functionality only through the normal core trust boundary;
- does not use AI;
- creates no `action_request`;
- performs no mutations to commitments, reminders, Calendar or Gmail;
- adds no scheduler or polling;
- strips control/format characters, including bidi controls, from rendered external/local text;
- strictly bounds the complete reply;
- always returns `replyPersistence: ephemeral` because the combined output may contain personal local state, Calendar titles and Gmail headers;
- audits only aggregate counts/source status and structural error type;
- never audits commitment/reminder text, Calendar titles, Gmail headers, provider IDs or rendered output.

## Doctor

`doctor` validates Stage 8B configuration locally and reports `feature.executive_priorities`. It does not contact Calendar, Gmail, WhatsApp or any AI provider.

## QA policy

Automated tests cover parsing, timezone/day boundaries, deterministic ordering, global caps, sanitization, provider isolation, no-action behavior, ephemeral replies and content-free audit.

Real WhatsApp/Calendar/Gmail validation remains a separate live QA gate and is intentionally accumulated with later Stage 8 work instead of being run after every feature. See `QA-STAGE-8B-PENDING.md`.
