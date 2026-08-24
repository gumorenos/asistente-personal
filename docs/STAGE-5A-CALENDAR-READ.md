# Stage 5A — Google Calendar read-only

Stage 5A agrega consultas explícitas de agenda y disponibilidad sin habilitar escrituras de Calendar.

## Boundary principal

`CALENDAR_READ_ENABLED` y `CALENDAR_ENABLED` son permisos funcionales distintos.

Para un despliegue de solo lectura:

```env
CALENDAR_READ_ENABLED=true
CALENDAR_ENABLED=false
```

Las credenciales OAuth son compartidas por la integración Google, pero el refresh token de un despliegue read-only debe emitirse con scopes mínimos de lectura:

- `https://www.googleapis.com/auth/calendar.events.readonly`
- `https://www.googleapis.com/auth/calendar.freebusy`

Stage 5A no crea, modifica ni elimina eventos y no escribe eventos/free-busy en SQLite.

## Comandos

```text
agenda hoy
agenda mañana
agenda semana

disponibilidad hoy
disponibilidad mañana
```

Estos comandos son matches exactos. Una intención de escritura más rica como:

```text
agenda mañana a las 10 reunión con Ana por 30 minutos
```

no es absorbida por Stage 5A y continúa hacia el flujo existente proposal → approval → explicit execution.

## Agenda

`events.list` se consulta con:

- `timeMin` / `timeMax` timezone-aware;
- `timeZone=APP_TIMEZONE`;
- `singleEvents=true` para expandir recurrencias;
- `orderBy=startTime`;
- `showDeleted=false`;
- límite de resultados configurado;
- proyección mínima `items(id,status,summary,start,end)`.

El dominio local conserva únicamente lo necesario para renderizar una respuesta efímera: ID, título y límites de tiempo/fecha. No se solicitan descripción, attendees ni location.

Se soportan eventos con hora y all-day. Los cancelados se ignoran.

## Disponibilidad

Defaults:

```env
CALENDAR_READ_DAY_START=08:00
CALENDAR_READ_DAY_END=20:00
CALENDAR_READ_MIN_FREE_MINUTES=30
```

Para `disponibilidad hoy` el inicio se eleva a `now` si parte de la ventana ya pasó. Si la ventana terminó, no se llama Google.

Los busy intervals recibidos se:

1. recortan a la ventana solicitada;
2. ordenan;
3. fusionan cuando se solapan o tocan;
4. convierten en huecos libres;
5. filtran por duración mínima.

## Privacidad y logs

Stage 5A no persiste respuestas de Google. El audit almacena solo información estructural:

- periodo (`today`, `tomorrow`, `week`);
- cantidad de eventos;
- cantidad de busy intervals;
- cantidad de huecos libres;
- tipo local de error.

No guarda títulos, response bodies, access tokens, refresh tokens ni rangos horarios exactos.

Los errores HTTP conservan únicamente status; un error `freeBusy` de calendario no propaga detalles remotos.

## OAuth y retries

El provider comparte el mecanismo de refresh OAuth ya existente. Ante HTTP 401:

1. fuerza refresh del access token una sola vez;
2. repite la misma consulta una sola vez;
3. si vuelve a fallar, devuelve error local seguro.

No existe loop de retry ilimitado.

## Configuración

```env
CALENDAR_READ_ENABLED=false
CALENDAR_READ_DAY_START=08:00
CALENDAR_READ_DAY_END=20:00
CALENDAR_READ_MIN_FREE_MINUTES=30
CALENDAR_READ_MAX_EVENTS=20
CALENDAR_READ_MAX_REPLY_CHARS=3500
```

Las credenciales siguen siendo:

```env
GOOGLE_CALENDAR_ID=primary
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
GOOGLE_CALENDAR_REFRESH_TOKEN=
CALENDAR_TIMEOUT_MS=20000
```

`npm run doctor` valida la configuración Stage 5A y reporta si Calendar read/write están habilitados, sin conectarse a Google.

## QA externo

Los tests fake/local no sustituyen OAuth/Calendar/WhatsApp reales. El checklist operativo está en [`QA-STAGE-5A-PENDING.md`](QA-STAGE-5A-PENDING.md).
