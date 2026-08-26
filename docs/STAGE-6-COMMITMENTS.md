# Stage 6 — compromisos personales

## Stage 6A: captura explícita local

Los compromisos son estado local explícito del self-chat. No son detectados automáticamente desde conversaciones y no dependen de IA.

Ejemplos:

```text
compromiso mañana a las 10 enviar informe a Ana
compromiso revisar presupuesto
me comprometo a renovar el dominio
prometí revisar el contrato
compromisos
compromisos vencidos
cumplí compromiso #3
cancela compromiso #4
busca compromisos dominio
```

La tabla `commitments` conserva body, vencimiento opcional y estado `open/completed/cancelled`. La fuente `commitment` entra en `self_memory_fts`, nunca en Observer.

## Stage 6B: notificación opt-in al vencer

Stage 6B agrega únicamente entrega al self-chat de compromisos explícitos ya vencidos.

```env
COMMITMENT_NOTIFICATIONS_ENABLED=false
COMMITMENT_NOTIFICATION_DESTINATION_JID=
```

Para habilitar:

- `WHATSAPP_ENABLED=true`;
- destino válido PN/LID directo;
- destino presente exactamente en `WHATSAPP_SELF_JIDS`.

El scheduler consulta como máximo 20 compromisos por ciclo, en orden de vencimiento/id, y entrega únicamente filas:

- `status='open'`;
- `due_at IS NOT NULL`;
- `due_at <= now`;
- `notified_at IS NULL`.

Antes de cada envío se vuelve a leer la fila para reducir notificaciones stale si cambió durante el procesamiento del batch. Un envío exitoso marca `notified_at`; un fallo conserva la fila elegible para retry.

## Stage 6C: reprogramación y vistas temporales

Stage 6C sigue siendo completamente local y explícito. No agrega migraciones, proveedores ni schedulers.

Comandos:

```text
compromisos hoy
compromisos semana
compromisos esta semana
compromisos sin fecha
reprograma compromiso #3 mañana a las 10
mueve compromiso #3 miércoles a las 9
```

Las vistas `hoy` y `semana` usan los mismos límites deterministas `America/Lima` del resto de la aplicación y consultas de intervalo `[inicio, fin)`. Solo incluyen compromisos `open`; `sin fecha` incluye únicamente `due_at IS NULL`. Cada body se compacta/trunca y la respuesta completa está limitada a 3500 caracteres.

Reprogramar:

- exige un id existente en estado `open`;
- exige una nueva fecha/hora futura válida;
- reutiliza el parser temporal determinista existente;
- cambia `due_at`, actualiza `updated_at` y limpia `notified_at` únicamente cuando el vencimiento realmente cambia;
- si la fecha/hora pedida coincide exactamente con el vencimiento actual, es un no-op y conserva `notified_at`, evitando rearmar por accidente una notificación ya entregada;
- si el vencimiento cambia, `notified_at` queda limpio para que, si Stage 6B está habilitado, el compromiso pueda avisarse una vez al llegar el nuevo vencimiento;
- no reabre compromisos `completed` o `cancelled`;
- no crea `action_request` ni hace tráfico de red.

El audit de una reprogramación efectiva conserva solo id y metadata estructural (`hadPreviousDueAt`, `notificationReset`); no guarda body ni la fecha/hora exacta nueva. Un no-op no genera `commitment.rescheduled`.

## Stage 6D: dashboard ejecutivo local

Stage 6D agrega una vista explícita para contestar “qué tan cargados están mis compromisos” sin reutilizar el briefing ni introducir IA.

Comandos equivalentes:

```text
resumen compromisos
estado compromisos
panel compromisos
```

El resumen divide todos los compromisos `open` en cinco buckets mutuamente excluyentes:

1. `vencidos`: `due_at <= now`;
2. `hoy, aún por vencer`: `now < due_at < dayEnd`;
3. `resto de esta semana`: `dayEnd <= due_at < weekEnd`;
4. `posteriores`: `due_at >= weekEnd`;
5. `sin fecha`: `due_at IS NULL`.

Los límites diarios/semanales se calculan con `APP_TIME_ZONE` (`America/Lima` por defecto) y la suma de los cinco buckets debe coincidir siempre con el total `open`. Los conteos se calculan directamente en SQLite y no heredan el límite máximo de los listados.

Además del total, la respuesta muestra como máximo:

- tres compromisos vencidos en orden de vencimiento/id;
- tres próximos compromisos estrictamente futuros en orden de vencimiento/id.

Cada body se compacta y limita a 240 caracteres; la respuesta total queda acotada a 3500 caracteres. Los compromisos sin fecha se resumen como conteo y se revisan con `compromisos sin fecha`.

El audit `commitment.summary` conserva únicamente conteos agregados y cuántas filas se mostraron. No guarda body, timestamps exactos de vencimiento ni query libre.

Stage 6D:

- no crea ni modifica compromisos;
- no crea `action_request`;
- no llama IA, Calendar ni transcripción;
- no depende de Observer;
- no agrega migración, flag, provider ni scheduler.

El briefing permanece intencionalmente separado: ya muestra hasta cinco compromisos abiertos dentro de un resumen personal más amplio. Stage 6D es una consulta explícita especializada, no otra variante del briefing.

## Límites de seguridad

Stages 6A–6D:

- no analizan Observer para crear compromisos;
- no detectan promesas automáticamente;
- no llaman IA, Calendar ni transcripción para captura/listado/reprogramación/dashboard;
- no crean `action_request` por captura/listado/reprogramación/notificación/dashboard;
- las notificaciones no pueden usar un JID fuera de `WHATSAPP_SELF_JIDS`;
- audit evita body y timestamps exactos privados;
- logs de fallo de notificación guardan id + tipo de error, no body/error privado.

## Semántica de entrega de Stage 6B

No se afirma exactly-once distribuido. El envío remoto ocurre antes de persistir `notified_at`, por lo que existe un crash-window si el proceso muere después de que WhatsApp acepte el mensaje y antes del commit SQLite. El comportamiento objetivo es:

- una entrega en operación normal;
- retry después de fallo antes/durante `sendText()`;
- sin reenvío después de que `notified_at` quedó persistido;
- después de una reprogramación explícita 6C a un vencimiento realmente distinto, una nueva entrega es elegible únicamente al alcanzar el nuevo vencimiento;
- reprogramar al mismo vencimiento no vuelve a habilitar una notificación ya marcada.

Ese crash-window debe validarse con la línea WhatsApp QA antes de activar Stage 6B de forma permanente.

## Fuera de alcance

El futuro promise detector automático requiere otra etapa con trust boundary y consentimiento independientes. Stage 6 no extrae compromisos de terceros ni convierte automáticamente texto observado en estado accionable. Tampoco reabre compromisos cerrados implícitamente ni implementa snooze/repetición periódica automática. Stage 6D no introduce priorización subjetiva o mediante IA: “prioridad” significa únicamente vencidos más antiguos y próximos vencimientos más cercanos.