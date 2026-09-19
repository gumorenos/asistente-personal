# Stage 8C QA — automated coverage and pending live checks

Stage 8C adds deterministic executive briefing. Automated evidence and live-provider evidence remain separate.

## Automated gate

Before closing the stage, require all repository tests, TypeScript, high+ production audit, Compose non-root validation, Docker amd64/arm64 builds, PDF/OCR smoke on both architectures, and bind-mounted data write smoke on both architectures to pass.

Automated coverage must include disabled-by-default configuration, explicit command parsing including Spanish punctuation, deterministic overdue-first local ordering, bounded output, ephemeral persistence, independent Calendar/Gmail boundaries, no AI/action/write path, sanitized external text, provider-failure isolation, and content-free audit metadata.

## Live QA — PENDING

Do not mark these PASS from automated CI.

- [ ] Real WhatsApp self-chat: `qué tengo hoy` / `¿Qué tengo hoy?`.
- [ ] Real WhatsApp self-chat: `dame mi briefing`.
- [ ] Real WhatsApp self-chat: `briefing ejecutivo`.
- [ ] Confirm Baileys session persistence after restart and Stage 8C reply remains ephemeral in retry storage.
- [ ] Confirm overdue local items appear before remaining-today local items.
- [ ] With real Calendar read enabled, confirm only remaining events today are surfaced and Calendar write is untouched.
- [ ] With real Gmail metadata read enabled, confirm only bounded unread metadata is requested; no body/snippet/attachment/search/AI path.
- [ ] Confirm the briefing never states or implies that unread Gmail is urgent merely because it is unread.
- [ ] Confirm Calendar/Gmail failures degrade only their sections and expose no upstream sensitive error details.
- [ ] Confirm third-party messages cannot invoke Stage 8C through the core self-chat boundary.

## Batch-QA policy

No OpenClaw request is made for Stage 8C alone. Live QA remains accumulated with WhatsApp/Baileys, Calendar, Gmail, Observer, notifications, documents, and the Stage 8 executive features for a later combined round. No merge or production deployment is part of this stage.
