# Observer read-only contract

Observer existe como feature **opt-in** y está deshabilitado por defecto con `OBSERVER_ENABLED=false`. Su objetivo inicial es persistir texto de chats expresamente autorizados para análisis posterior, sin responder, ejecutar comandos ni invocar servicios externos.

## Activation gates

Para que Observer pueda arrancar se requieren simultáneamente:

1. `WHATSAPP_ENABLED=true`;
2. al menos un `WHATSAPP_SELF_JIDS` administrativo explícito;
3. `OBSERVER_ENABLED=true`;
4. el chat concreto debe estar `enabled` en la tabla `observed_chats`.

Si cualquiera de esas condiciones falta, el chat no se persiste.

La allowlist se administra únicamente desde el self-chat mediante:

```text
observa chat <jid> como <etiqueta>
chats observados
deja de observar <jid>
```

Agregar un chat con Observer deshabilitado solo prepara la allowlist y no captura nada.

## Data flow

```text
Baileys live messages.upsert
          |
          v
normalizeWhatsAppMessage
          |
          +--> self-chat autorizado ----> AssistantCore ----> reply solo al self-chat
          |
          +--> no-self + OBSERVER_ENABLED
                        |
                        v
                 ObserverService
                        |
                 observed_chats guard
                        |
                        v
                SqliteObservationSink
                        |
                   observations
```

Los dos caminos son mutuamente excluyentes. Un mensaje que resolvió como self-chat nunca entra al Observer.

## Hard isolation

`ObserverService` y `SqliteObservationSink` no reciben:

- `MessageTransport`;
- `AssistantCore`;
- `Capability[]`;
- `AiProvider`;
- `TranscriptionProvider`;
- Calendar executor/provider.

El transport solo entrega un mensaje normalizado al handler Observer y retorna. No existe callback inverso para producir una respuesta.

Por tanto, un mensaje observado no puede por diseño:

- llamar `sendText()`;
- crear notas, gastos o recordatorios;
- crear/aprobar/ejecutar acciones;
- invocar IA;
- solicitar transcripción;
- escribir Calendar.

## Storage

La migración central versión 9 crea una tabla dedicada:

```text
observations
  chat_jid
  message_id
  sender_id
  timestamp
  text
  kind = text
  is_group
  created_at
  PRIMARY KEY(chat_jid, message_id)
```

No reutiliza la tabla Stage 1 `messages`.

Reglas de persistencia:

- solo texto;
- 1–4.000 caracteres después de normalización/bounding;
- media nunca se persiste;
- media nunca recibe `loadMedia()` desde el camino Observer;
- duplicados del mismo `(chat_jid, message_id)` son idempotentes;
- listados del sink siempre son chat-scoped y tienen límite máximo;
- deshabilitar el chat impide writes futuros inmediatamente.

## Retention

Cada fila de `observed_chats` define `retention_days` entre 1 y 90 días; default 7.

`ObserverRetentionScheduler` corre únicamente cuando Observer está habilitado y purga usando la ventana de cada chat. Es independiente de `RETENTION_ENABLED`, porque la retención de datos de terceros no debe depender de la política operacional general.

El audit del purge contiene solo el número de filas eliminadas, nunca texto, JID ni label.

## Logging

Observer no registra contenido observado en logs normales. Los errores del handler se reducen al tipo/nombre de error sin texto del mensaje ni JID.

`LOG_MESSAGE_CONTENT` continúa aplicando al flujo de self-chat y no habilita logging del contenido Observer.

## Current limitations

Observer initial es deliberadamente mínimo:

- solo eventos live `messages.upsert` de tipo `notify`;
- `syncFullHistory=false` permanece intacto;
- no importa historial previo;
- no descarga ni analiza audio/imágenes/documentos/video;
- no genera resúmenes automáticos;
- no ejecuta IA automática;
- no envía alertas derivadas del contenido observado;
- no responde a terceros ni grupos.

Antes de ampliar cualquiera de esas capacidades debe existir un gate separado de privacidad/autorización y su QA correspondiente.

## Real-device QA

Los checks obligatorios siguen en [`QA-PENDING.md`](QA-PENDING.md). En particular deben demostrarse en WhatsApp real:

- `OBSERVER_ENABLED=false` => cero nuevas observaciones incluso si la allowlist contiene JIDs;
- chat no allowlisted => cero persistencia;
- text-only + no media download;
- cero replies/acciones/tráfico externo causado por contenido observado;
- deshabilitación inmediata;
- idempotencia ante resend;
- retención por chat tras restart/reboot;
- minimización y consentimiento adecuados antes de observar conversaciones con terceros.
