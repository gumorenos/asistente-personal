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

## Límites de seguridad

Stage 6B:

- no analiza Observer;
- no detecta promesas automáticamente;
- no llama IA, Calendar ni transcripción;
- no crea `action_request`;
- no puede usar un JID fuera de `WHATSAPP_SELF_JIDS`;
- audit guarda id/evento, no body ni timestamp de vencimiento;
- logs de fallo guardan id + tipo de error, no body/error privado.

## Semántica de entrega

No se afirma exactly-once distribuido. El envío remoto ocurre antes de persistir `notified_at`, por lo que existe un crash-window si el proceso muere después de que WhatsApp acepte el mensaje y antes del commit SQLite. El comportamiento objetivo es:

- una entrega en operación normal;
- retry después de fallo antes/ durante `sendText()`;
- sin reenvío después de que `notified_at` quedó persistido.

Ese crash-window debe validarse con la línea WhatsApp QA antes de activar Stage 6B de forma permanente.

## Fuera de alcance

El futuro promise detector automático requiere otra etapa con trust boundary y consentimiento independientes. Stage 6 no extrae compromisos de terceros ni convierte automáticamente texto observado en estado accionable.
