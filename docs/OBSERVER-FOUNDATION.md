# Observer foundation

Observer is **not enabled yet**. This document defines the security and architecture contract that must remain true before any third-party or group-chat ingestion is connected to Baileys.

## Current state

Implemented:

- explicit `observed_chats` allowlist managed only from the authorized self-chat;
- per-chat retention setting (1-90 days) stored with the allowlist;
- `ObserverService` separated from `AssistantCore`;
- `ObservationSink` interface separated from the WhatsApp transport;
- text-only observation boundary;
- PN/LID alternate-JID canonicalization against the observer allowlist;
- bounded observed text (4,000 characters);
- duplicate handling delegated to an idempotent sink;
- media is rejected by the observer service without invoking `loadMedia()`;
- operational retention framework exists and is disabled by default.

Not implemented/active:

- no Baileys listener routes third-party/group messages to `ObserverService`;
- no persistent `ObservationSink` exists yet;
- no observed message is stored by the running application;
- no summaries/alerts are generated from observed chats;
- no reply can be sent to an observed chat;
- no observed message can invoke local capabilities, AI, transcription, Calendar proposals or Calendar execution.

## Required data flow

The only acceptable future path is:

```text
Baileys message
      |
      +--> self-chat guard ----> AssistantCore ----> self-chat reply
      |
      +--> observer guard -----> ObserverService ---> ObservationSink
                                      |
                                      X no AssistantCore
                                      X no MessageTransport
                                      X no Capability[]
                                      X no AI/transcription automatically
                                      X no external action executor
```

A message must never be passed through both paths merely because it is `fromMe=true`. The self-chat path remains defined by `WHATSAPP_SELF_JIDS`; the Observer path remains defined independently by `observed_chats`.

## Persistent sink requirements

Before transport activation, the persistent sink must:

1. use a dedicated table rather than the Stage 1 `messages` table;
2. use `(chat_jid, message_id)` or an equivalent unique key for idempotency;
3. store only the minimum fields required for read-only analysis;
4. never store media bytes;
5. enforce bounded text again at the persistence boundary;
6. support purge using each allowlisted chat's `retention_days`;
7. make disabling a chat stop future writes immediately;
8. never expose a method that sends a WhatsApp message;
9. be covered by tests proving duplicate delivery is idempotent and retention is per-chat.

## Transport activation requirements

A future `OBSERVER_ENABLED` flag must default to `false`. When false, the transport must preserve current Stage 1 behavior exactly: third-party and group messages are ignored before persistence.

When true, transport handling must still obey all of the following:

- only `messages.upsert` live notifications initially; no full-history sync;
- only JIDs currently enabled in `observed_chats`;
- text only for the first release;
- no media download;
- no `sendText` call from Observer code;
- no automatic AI call;
- no automatic action/proposal creation;
- failure in Observer must not break self-chat handling;
- disabling a JID takes effect without requiring a schema change.

## Retention

The generic operational retention scheduler does not yet purge future observation rows because they do not exist yet. The persistent Observer sink must implement per-chat retention using `observed_chats.retention_days`; this must be tested before `OBSERVER_ENABLED` can be added to `.env.example` as a usable feature.

## QA gate

Real-device checks remain in [`QA-PENDING.md`](QA-PENDING.md). In particular, adding a real JID to the allowlist today must still result in **zero observation**, because no transport ingestion path is active yet.
