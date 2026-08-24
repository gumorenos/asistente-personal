# Stage 6 QA handoff

OpenClaw no está disponible durante esta tanda de desarrollo. Los pendientes de QA manual/live de Stage 6 están separados en:

- `docs/QA-STAGE-6A-PENDING.md` — captura explícita local, migración v16, self-chat/briefing/FTS/restart.
- `docs/QA-STAGE-6B-PENDING.md` — notificación opt-in de compromisos vencidos, migración v17, retry/restart/crash-window.

Cuando OpenClaw vuelva a estar disponible, usar estos dos archivos como fuente de verdad y ejecutar únicamente checks todavía `[ ]`. No reinterpretar tests automatizados como PASS live.

Prioridad de ejecución:

1. Stage 6A sobre DB real/copia v15→v16 y self-chat de la línea QA.
2. Stage 6B v16→v17, feature disabled/enabled, retry offline y persistencia tras restart.
3. Revisar explícitamente el crash-window documentado de Stage 6B antes de activar notificaciones permanentemente.

No hacer merge/deploy ni corregir código durante ese QA sin instrucción explícita; reportar evidencia para que ChatGPT implemente cualquier fix.
