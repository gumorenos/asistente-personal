# Stage 5B — sugerencias deterministas de horarios

Stage 5B convierte la disponibilidad read-only de Stage 5A en una lista pequeña de opciones útiles. No usa IA, no crea `action_requests` y no escribe en Google Calendar.

## Activación

```env
CALENDAR_READ_ENABLED=true
CALENDAR_SLOT_SUGGESTIONS_ENABLED=true
CALENDAR_ENABLED=false
```

`CALENDAR_SLOT_SUGGESTIONS_ENABLED=true` exige Calendar read. No exige ni habilita Calendar writes.

## Comando

```text
propón horarios mañana para 30 minutos
```

También se aceptan `propon` y `sugiere`, y los periodos `hoy` / `mañana`.

La duración debe estar entre 15 y 240 minutos y ser múltiplo del alignment configurado (15 min por defecto).

## Algoritmo

1. Stage 5B pide a Stage 5A disponibilidad para la duración exacta solicitada.
2. Stage 5A consulta `freeBusy` dentro de la ventana configurada.
3. Para `hoy`, nunca usa tiempo anterior a `now`.
4. Cada hueco se alinea hacia adelante al siguiente boundary (`:00`, `:15`, `:30`, `:45` por defecto).
5. Se generan opciones no solapadas avanzando por la duración solicitada.
6. Se devuelven las primeras N opciones, N=3 por defecto.

Ejemplo conceptual: si son 09:17, el hueco libre termina 10:00 y se piden 30 min, la primera opción válida es 09:30–10:00.

## Safety boundary

La respuesta termina explícitamente con:

> Solo son sugerencias: no se creó ninguna acción ni evento.

Stage 5B no tiene dependencia de `ActionRequestRepository`, de ejecutores ni del provider de Calendar write. El test de capability comprueba además que después de sugerir horarios la tabla lógica de acciones pendientes continúa vacía.

Si más adelante se permite elegir una opción, esa selección deberá transformarse en una **propuesta normal** y seguir el pipeline existente:

1. propuesta;
2. aprobación explícita;
3. ejecución explícita;
4. write idempotente.

No se implementa selección/ejecución en Stage 5B.

## Configuración

```env
CALENDAR_SLOT_SUGGESTIONS_ENABLED=false
CALENDAR_SLOT_MAX_SUGGESTIONS=3
CALENDAR_SLOT_ALIGNMENT_MINUTES=15
CALENDAR_SLOT_MAX_REPLY_CHARS=2000
```

`CALENDAR_SLOT_MAX_SUGGESTIONS`: 1–5.

`CALENDAR_SLOT_ALIGNMENT_MINUTES`: 5–60 y debe dividir 60 exactamente.

## Privacidad

La respuesta al self-chat contiene las horas propuestas, pero audit no guarda esas horas. Solo registra:

- periodo;
- duración solicitada;
- cantidad devuelta;
- si la ventana ya terminó;
- tipo local de error si falla.

No se persisten free slots ni sugerencias en SQLite.

## Operación

`npm run doctor` valida este feature de forma local y reporta max suggestions/alignment. No contacta Google.

QA real pendiente: [`QA-STAGE-5B-PENDING.md`](QA-STAGE-5B-PENDING.md).
