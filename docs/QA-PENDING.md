# Testing / QA pending

Updated: 2026-08-18 (America/Lima)

This file is the source of truth for tests that cannot be completed automatically in the current development environment or that require a real WhatsApp/Raspberry Pi session.

## Automated checks completed during Stage 0 development

- [x] Router: `ping` returns `pong` without AI.
- [x] Router: unknown text produces a safe local acknowledgement.
- [x] SQLite migrations run in-memory.
- [x] Message ID deduplication is idempotent.
- [x] Assistant outbound IDs are persisted for loop prevention.
- [x] Core processes a duplicate inbound message only once.
- [x] WhatsApp normalizer handles plain text.
- [x] WhatsApp normalizer preserves alternate JID/LID information and group detection.

Local result: **7 tests passed** on Node 22.16 using the experimental type-stripping flag. Target runtime/CI is Node 22.18+.

## CI / dependency validation

- [ ] GitHub Actions installs the pinned Baileys release successfully.
- [ ] `npm run typecheck` passes against actual Baileys v7 typings.
- [ ] `npm test` passes on Node 22.18.0 in GitHub Actions.
- [ ] Docker image builds on linux/amd64.
- [ ] Docker image builds on linux/arm64 (Raspberry Pi 5 target).
- [ ] Generate and commit `package-lock.json` after first dependency install; switch CI/Docker from `npm install` to `npm ci`.
- [ ] Run `npm audit` after lockfile creation and review all high/critical findings before deployment.

## WhatsApp pairing and session persistence — manual

- [ ] Deploy to a non-critical test environment first.
- [ ] Set `WHATSAPP_ENABLED=true` and a valid `WHATSAPP_PHONE_NUMBER` in E.164 digits-only format.
- [ ] Confirm a pairing code is generated once and can be entered in WhatsApp > Linked devices.
- [ ] Confirm credentials are stored in SQLite tables and no Baileys auth JSON folder is created.
- [ ] Restart the process and verify reconnection occurs without a new pairing code.
- [ ] Restart the Raspberry Pi and verify reconnection occurs without a new pairing code.
- [ ] Intentionally unlink the device in WhatsApp and verify state becomes `logged_out` without a reconnect loop.
- [ ] Simulate network loss and verify reconnect succeeds without duplicate replies.

## Self-chat discovery / allowlist — manual and release-blocking

- [ ] Start once with `WHATSAPP_SELF_JIDS` empty.
- [ ] Send a message in WhatsApp's self-chat and confirm the service logs candidate JID(s) but **does not reply**.
- [ ] Record PN (`@s.whatsapp.net`) and, when present, LID (`@lid`) identities in `WHATSAPP_SELF_JIDS`.
- [ ] Confirm self-chat `ping` produces exactly one `pong`.
- [ ] Confirm `estado` and `ayuda` work.
- [ ] Confirm the assistant's own `pong` event does not trigger another reply (no loop).
- [ ] Send a normal message from the account to another person and confirm the assistant does **not** respond to that person.
- [ ] Send a message in a group and confirm the assistant does **not** respond or persist it.
- [ ] Receive a message from another person and confirm it is not processed/persisted.
- [ ] Verify behavior for messages whose primary JID is `@lid` and alternate is `@s.whatsapp.net`.

## Health / operations — manual

- [ ] `/healthz` returns HTTP 200 while the process is alive.
- [ ] `/readyz` exposes database and transport state correctly.
- [ ] Health port is reachable locally but not exposed publicly from the RPi/router/Cloudflare.
- [ ] SIGTERM/SIGINT closes the health server and SQLite cleanly.
- [ ] Confirm WAL/SHM recovery after an unclean process kill.
- [ ] Confirm data directory/database permissions on the actual RPi filesystem.
- [ ] Create a local backup and restore it to a disposable copy; verify migrations and message count.

## Baileys reliability gaps to resolve before Observer mode

- [ ] Implement a persisted raw WhatsApp message store for Baileys `getMessage()`; current Stage 0 returns `undefined`.
- [ ] Validate resend/missing-message behavior before relying on message recovery.
- [ ] Validate rc13 against current WhatsApp Web behavior before considering a Baileys upgrade.
- [ ] Review any newer Baileys release separately; do not auto-upgrade because v7 is still sensitive to protocol changes.

## Privacy / security review before enabling non-self chats

- [ ] Add chat-level allowlist table and admin workflow.
- [ ] Add retention/purge jobs.
- [ ] Decide whether SQLite/backups need application-level encryption in addition to filesystem security.
- [ ] Add explicit action-approval model before Calendar or any third-party write capability.
- [ ] Add tests proving outbound third-party messaging cannot occur without approval before implementing that feature.

## Current stop point

Stage 0 is ready for CI and real-session QA when the branch is pushed. **Do not enable Observer mode or third-party replies yet.**
