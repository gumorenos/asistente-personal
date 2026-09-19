# Stage 8C — deterministic executive briefing

Stage 8C adds an explicit, manual executive briefing that combines the deterministic Stage 8 foundations into one bounded read-only interaction.

Commands: `qué tengo hoy`, `dame mi briefing`, `briefing ejecutivo`. Spanish opening/closing punctuation and accents are normalized for matching.

The feature is OFF by default with `EXECUTIVE_BRIEFING_ENABLED=false`. Bounds are independently configured with `EXECUTIVE_BRIEFING_MAX_ACTION_ITEMS`, `EXECUTIVE_BRIEFING_MAX_CALENDAR_EVENTS`, `EXECUTIVE_BRIEFING_MAX_GMAIL_MESSAGES`, and `EXECUTIVE_BRIEFING_MAX_REPLY_CHARS`.

The briefing orders overdue local commitments/reminders before remaining-today local items. Calendar is consulted only when Calendar read is independently enabled and only for the remaining part of today. Gmail is consulted only when Gmail metadata read is independently enabled and requests bounded unread INBOX metadata. Unread mail is context, never proof of urgency. No Gmail body, snippet, attachment, search, AI analysis, provider ID, write, or action path is used.

Calendar titles and Gmail headers are untrusted data and are sanitized before rendering. Provider failures are isolated by section. The complete reply is bounded and always ephemeral. Audit records only counts, source status, and structural error type; it does not store rendered content, local item text, Calendar titles, Gmail headers, or provider IDs.

Stage 8C uses no AI, creates no `action_request`, performs no mutation, and adds no scheduler or polling. Enabling Stage 8C does not silently enable Calendar or Gmail.

This stage intentionally leaves Stage 8A and 8B behavior unchanged. Shared-domain extraction can be tightened in a later refactor once the three deterministic views have live UX evidence; avoiding a broad refactor here reduces regression risk in closed stacked stages.
