# Stage 8A — resumen ejecutivo determinista

Stage 8A es la primera capa que combina varias capacidades ya existentes en una sola vista ejecutiva. Su objetivo no es añadir otra integración externa, sino transformar estado local y fuentes read-only ya autorizadas en un resumen operativo útil desde el self-chat.

## Comandos explícitos

```text
resumen ejecutivo
panel ejecutivo
```

No se activa con texto libre ni en background.

## Configuración

```env
EXECUTIVE_SUMMARY_ENABLED=false
EXECUTIVE_SUMMARY_MAX_GMAIL_MESSAGES=3
EXECUTIVE_SUMMARY_MAX_CALENDAR_EVENTS=5
EXECUTIVE_SUMMARY_MAX_LOCAL_ITEMS=3
EXECUTIVE_SUMMARY_MAX_REPLY_CHARS=3500
```

La feature está deshabilitada por defecto. Sus límites son independientes y conservadores:

- Gmail metadata: 1–5 mensajes;
- Calendar: 1–10 eventos;
- filas locales por sección: 1–5;
- reply total: 1000–6000 caracteres.

`doctor` valida esta configuración localmente sin conectarse a Gmail o Calendar.

## Fuentes

El snapshot usa siempre estado local disponible:

- resumen de compromisos abiertos;
- compromisos vencidos/próximos;
- recordatorios pendientes.

Las fuentes externas son estrictamente opcionales y respetan sus boundaries existentes:

### Calendar

Solo participa si `CALENDAR_READ_ENABLED=true` y existe el `CalendarReadService` de Stage 5A.

Stage 8A consulta únicamente la agenda de **hoy** y limita el fan-out en la propia llamada al servicio. El nuevo argumento opcional de `CalendarReadService.agenda(period, requestedMaxEvents)` conserva el comportamiento previo para otros callers y aplica `min(requestedMaxEvents, CALENDAR_READ_MAX_EVENTS)` antes de llegar al provider.

Stage 8A no usa Calendar write, free/busy, slot suggestions ni exact availability.

### Gmail

Solo participa si `GMAIL_READ_ENABLED=true` y existe el provider metadata-only de Stage 7A.

La llamada es equivalente a:

```ts
listInbox({ unreadOnly: false, limit: EXECUTIVE_SUMMARY_MAX_GMAIL_MESSAGES })
```

Se muestran únicamente metadata ya permitida por Stage 7A:

- unread;
- From;
- Subject;
- fecha interna para ordenar.

Stage 8A no solicita ni consume:

- body;
- snippet;
- attachments;
- Gmail search;
- Gmail message/thread ids para output;
- Stage 7D AI analysis.

La ordenación es determinista: no leídos primero y luego más recientes.

## Sin IA

Stage 8A es deliberadamente determinista y **no usa IA**. No requiere `AI_ENABLED` ni `GMAIL_ANALYSIS_ENABLED`.

Esto permite disponer de una vista ejecutiva aun cuando las funciones de IA estén apagadas, reduce exportación de datos y crea una base estable para una posible síntesis opt-in futura.

## Fallos parciales

Calendar y Gmail se aíslan individualmente. Si una fuente externa falla:

- el error upstream no se muestra;
- la sección indica que no está disponible;
- el resto del snapshot, especialmente estado local, sigue respondiendo.

Si la fuente no está habilitada, la sección lo indica explícitamente en lugar de intentar conectarse.

## Seguridad y persistencia

El resultado combinado usa `replyPersistence: 'ephemeral'` porque puede incluir títulos de Calendar, From/Subject de Gmail y texto local sensible. Por tanto su payload no entra al `whatsapp_message_store` local de retry/getMessage.

Los valores externos se sanitizan eliminando controles Unicode `Cc`/`Cf`, incluyendo bidi, y se compacta whitespace antes de mostrarlos.

Audit registra únicamente metadata operacional agregada:

- cantidad de compromisos abiertos/vencidos;
- cantidad de recordatorios incluidos;
- estado Calendar y cantidad devuelta;
- estado Gmail, cantidad devuelta y número de no leídos.

Audit no guarda títulos de eventos, remitentes, asuntos, cuerpos, ids Gmail, ids Calendar ni texto del snapshot.

## No crea ni ejecuta acciones

Stage 8A no tiene acceso a ningún executor y no implementa:

- creación/modificación de Calendar;
- Gmail writes;
- commitments automáticos;
- reminders automáticos;
- third-party messages;
- Observer reads;
- AI/tool calls;
- polling o scheduler propio.

La capability se ejecuta únicamente dentro de `AssistantCore`; la frontera self-chat existente sigue siendo la que permite llegar a ella. Observer permanece separado.

## Output esperado

La respuesta se estructura en secciones acotadas:

```text
🧭 Resumen ejecutivo — <fecha local>

🤝 Compromisos
...

⏰ Recordatorios
...

📅 Agenda de hoy
...

📨 Gmail reciente
...
```

El reply total se corta de forma estructural por líneas para no exceder `EXECUTIVE_SUMMARY_MAX_REPLY_CHARS`.

## Fuera de alcance de Stage 8A

- síntesis o ranking mediante IA;
- lectura de cuerpos Gmail;
- detección automática de urgencia semántica;
- conversión de emails/mensajes en compromisos;
- acciones automáticas;
- briefing proactivo;
- comunicación a terceros.

Esas capacidades deben abrir boundaries separados. En particular, cualquier futura inteligencia sobre promesas debe seguir el patrón `detectar → sugerir → confirmar → crear`, nunca crear compromisos silenciosamente.
