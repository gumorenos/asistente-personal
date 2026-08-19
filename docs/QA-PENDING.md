# Testing / QA pending

Updated: 2026-08-18 (America/Lima)

This file is the source of truth for tests that cannot be completed automatically in the current development environment or that require a real WhatsApp/Raspberry Pi session.

## Automated checks completed

### Stage 0 foundation

- [x] Router: `ping` returns `pong` without AI.
- [x] Router: unknown text produces a safe local acknowledgement.
- [x] SQLite migrations run in-memory.
- [x] Message ID deduplication is idempotent.
- [x] Assistant outbound IDs are persisted for loop prevention.
- [x] Core processes a duplicate inbound message only once.
- [x] WhatsApp normalizer handles plain text.
- [x] WhatsApp normalizer preserves alternate JID/LID information and group detection.
- [x] GitHub Actions installs pinned Baileys `7.0.0-rc13` successfully.
- [x] `npm run typecheck` passes against actual Baileys v7 typings on Node 22.18.0.
- [x] Original 7 tests pass in GitHub Actions on Node 22.18.0.

CI green for Stage 0 at commit `bed3012065d6dd44688fc6d93bcfc05d74956d5f`.

### Stage 1A local capabilities

- [x] Deterministic parser stores `anota <texto>` as a local note.
- [x] Expense parser accepts PEN examples such as `gasté S/ 78.50 en supermercado`.
- [x] Expense parser preserves original description text rather than normalized text.
- [x] Reminder parser resolves `mañana a las 10` using configured `APP_TIMEZONE`.
- [x] Note, expense and reminder repositories persist to SQLite.
- [x] `notas`, `gastos` and `recordatorios` return persisted local state.
- [x] Reminder scheduler delivers a due reminder only once.
- [x] Failed reminder delivery remains pending for retry.
- [x] Migration v2 adds reminder destination/delivery fields.

Local result after Stage 1A: **13 tests passed** on Node 22.16 using the experimental type-stripping flag. GitHub CI on Node 22.18+ remains the release source of truth.

## CI / dependency validation still pending

- [ ] Stage 1A `npm run typecheck` passes in GitHub Actions.
- [ ] Stage 1A all 13 tests pass in GitHub Actions on Node 22.18.0.
- [ ] Docker image builds on linux/amd64.
- [ ] Docker image builds on linux/arm64 (Raspberry Pi 5 target).
- [ ] Generate and commit `package-lock.json`; switch CI/Docker from `npm install` to `npm ci`.
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
- [ ] Confirm that sending a message from the account to a third party while discovery mode is active cannot be mistaken for authorization; review candidate-JID discovery before production use.
- [ ] Record PN (`@s.whatsapp.net`) and, when present, LID (`@lid`) identities in `WHATSAPP_SELF_JIDS`.
- [ ] Confirm self-chat `ping` produces exactly one `pong`.
- [ ] Confirm `estado` and `ayuda` work.
- [ ] Confirm the assistant's own `pong` event does not trigger another reply (no loop).
- [ ] Send a normal message from the account to another person and confirm the assistant does **not** respond to that person.
- [ ] Send a message in a group and confirm the assistant does **not** respond or persist it.
- [ ] Receive a message from another person and confirm it is not processed/persisted.
- [ ] Verify behavior for messages whose primary JID is `@lid` and alternate is `@s.whatsapp.net`.

## Stage 1A commands — manual on real self-chat

- [ ] `anota comprar filtro de agua` saves once and `notas` shows it.
- [ ] `gasté S/ 78.50 en supermercado` saves correct amount/currency/description and `gastos` shows it.
- [ ] `recuérdame mañana a las 10 pagar la tarjeta` resolves to 10:00 America/Lima.
- [ ] Due reminder is delivered to self-chat exactly once.
- [ ] Restart between reminder creation and due time; delivery still occurs.
- [ ] Disconnect network at due time; reminder remains pending and is delivered after connectivity returns.
- [ ] Undated `recuérdame revisar presupuesto` stays pending but is not spuriously sent.
- [ ] Check midnight boundary for `mañana` in America/Lima.
- [ ] Check invalid times (e.g. 25:00) do not create a wrongly scheduled reminder.
- [ ] Check decimal comma and decimal point expenses.
- [ ] Check descriptions with accents/capitalization survive round-trip.

## Health / operations — manual

- [ ] `/healthz` returns HTTP 200 while the process is alive.
- [ ] `/readyz` exposes database and transport state correctly.
- [ ] Health port is reachable locally but not exposed publicly from the RPi/router/Cloudflare.
- [ ] SIGTERM/SIGINT stops reminder scheduler, closes health server and SQLite cleanly.
- [ ] Confirm WAL/SHM recovery after an unclean process kill.
- [ ] Confirm data directory/database permissions on the actual RPi filesystem.
- [ ] Create a local backup and restore it to a disposable copy; verify migrations and row counts.

## Baileys reliability gaps to resolve before Observer mode

- [ ] Implement a persisted raw WhatsApp message store for Baileys `getMessage()`; current Stage 0/1 returns `undefined`.
- [ ] Validate resend/missing-message behavior before relying on message recovery.
- [ ] Validate rc13 against current WhatsApp Web behavior before considering a Baileys upgrade.
- [ ] Review any newer Baileys release separately; do not auto-upgrade protocol-sensitive versions.

## Privacy / security review before enabling non-self chats

- [ ] Add chat-level allowlist table and admin workflow.
- [ ] Add retention/purge jobs.
- [ ] Decide whether SQLite/backups need application-level encryption in addition to filesystem security.
- [ ] Add explicit action-approval model before Calendar or any third-party write capability.
- [ ] Add tests proving outbound third-party messaging cannot occur without approval before implementing that feature.

## Current stop point for risky features

Stage 1A may continue through CI and local capability development. **Do not enable Observer mode, third-party replies, Calendar writes or external agents until the relevant safety/approval layer exists.**
