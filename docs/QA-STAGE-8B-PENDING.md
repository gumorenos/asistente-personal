# Stage 8B QA — automated coverage and pending live checks

Stage 8B introduces deterministic executive priorities. This file distinguishes automated evidence from checks that require real external services/devices.

## Automated coverage

The repository test/CI gate must remain green for the final Stage 8B HEAD. Automated coverage includes:

- feature disabled by default and bounded `EXECUTIVE_PRIORITIES_*` configuration;
- natural explicit command parsing (`prioridades`, `prioridades hoy`, `¿Qué priorizo hoy?`);
- disabled mode owns only Stage 8B commands and performs zero Calendar/Gmail work;
- deterministic overdue-first ordering for commitments/reminders;
- exclusion of undated, closed/cancelled and beyond-today items;
- application-timezone day boundary handling;
- global action cap prioritizing overdue work;
- Calendar query restricted to remaining today with provider limit 1;
- no Calendar free/busy, slot suggestion or write path;
- bounded Gmail request with `unreadOnly: true` and metadata only;
- defensive filtering of non-unread Gmail rows;
- deterministic unread Gmail ordering;
- external text sanitization, including Unicode format/bidi characters;
- no inference that unread Gmail means urgent/high priority;
- provider-failure isolation with no upstream error-body leakage;
- strict total reply bound;
- `replyPersistence: ephemeral`;
- no `action_request` creation;
- audit contains structural counts/status/error type only;
- `doctor` validates/reports Stage 8B without provider connectivity.

Final automated gate required before closing the stage:

- `npm ci --no-audit --no-fund` PASS;
- TypeScript `tsc --noEmit` PASS;
- all repository tests PASS;
- `npm audit --omit=dev --audit-level=high` PASS with 0 high+ vulnerabilities;
- Docker Compose non-root identity validation PASS;
- Docker linux/amd64 build PASS;
- amd64 PDF/OCR smoke PASS;
- amd64 bind-mounted data write smoke PASS;
- Docker linux/arm64 build PASS;
- arm64 PDF/OCR smoke PASS;
- arm64 bind-mounted data write smoke PASS.

Exact final HEAD/run evidence belongs in the Stage 8B pull request once the documentation commits have completed their final CI run.

## Live QA — PENDING

Do **not** mark these PASS from automated tests.

- [ ] Real WhatsApp self-chat: `prioridades`.
- [ ] Real WhatsApp self-chat: `prioridades hoy`.
- [ ] Real WhatsApp self-chat: `¿Qué priorizo hoy?`.
- [ ] Verify a real overdue commitment/reminder appears before remaining-today work.
- [ ] With real Calendar read enabled, verify only a remaining event today is surfaced and past events are not returned by the Stage 8B request.
- [ ] With real Gmail Stage 7A enabled, verify bounded unread metadata only; no body/snippet/attachment is retrieved.
- [ ] Confirm the response does not claim unread email is urgent merely because it is unread.
- [ ] Confirm Calendar/Gmail OAuth/provider failures degrade only their own sections and do not expose upstream details.
- [ ] With real Baileys transport, verify the executive-priorities response is not stored as a retry payload because it is ephemeral.
- [ ] Restart the QA container and confirm local priorities continue to work with persisted local state.

## Batch-QA policy

Per current project policy, Stage 8B is **not** being sent to OpenClaw immediately. Live QA is being accumulated with subsequent Stage 8 changes. No production deploy or merge is part of this QA document.
