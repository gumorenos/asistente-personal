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

Las vistas `hoy` y `semana` usan los mismos límites deterministas `America/Lima` del resto de la aplicación y consultas de intervalo `[inicio, fin)`. Solo incluyen compromisos `open`; `sin fecha` incluye únicamente `due_at IS NULL`.

Reprogramar:

- exige un id existente en estado `open`;
- exige una nueva fecha/hora futura válida;
- reutiliza el parser temporal determinista existente;
- cambia solo `due_at` y `updated_at`;
- limpia `notified_at` para que, si Stage 6B está habilitado, el compromiso pueda avisarse una vez al llegar el nuevo vencimiento;
- no reabre compromisos `completed` o `cancelled`;
- no crea `action_request` ni hace tráfico de red.

El audit de reprogramación conserva solo id y metadata estructural (`hadPreviousDueAt`, `notificationReset`); no guarda body ni la fecha/hora exacta nueva.

## Límites de seguridad

Stages 6A–6C:

- no analizan Observer para crear compromisos;
- no detectan promesas automáticamente;
- no llaman IA, Calendar ni transcripción;
- no crean `action_request` por captura/listado/reprogramación/notificación;
- las notificaciones no pueden usar un JID fuera de `WHATSAPP_SELF_JIDS`;
- audit evita body y timestamps exactos privados;
- logs de fallo de notificación guardan id + tipo de error, no body/error privado.

## Semántica de entrega de Stage 6B

No se afirma exactly-once distribuido. El envío remoto ocurre antes de persistir `notified_at`, por lo que existe un crash-window si el proceso muere después de que WhatsApp acepte el mensaje y antes del commit SQLite. El comportamiento objetivo es:

- una entrega en operación normal;
- retry después de fallo antes/durante `sendText()`;
- sin reenvío después de que `notified_at` quedó persistido;
- después de una reprogramación explícita 6C, una nueva entrega es elegible únicamente al alcanzar el nuevo vencimiento.

Ese crash-window debe validarse con la línea WhatsApp QA antes de activar Stage 6B de forma permanente.

## Fuera de alcance

El futuro promise detector automático requiere otra etapa con trust boundary y consentimiento independientes. Stage 6 no extrae compromisos de terceros ni convierte automáticamente texto observado en estado accionable. Tampoco reabre compromisos cerrados implícitamente ni implementa snooze/repetición periódica automática.
