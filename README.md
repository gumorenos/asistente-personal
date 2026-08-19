# Asistente Personal

Asistente personal autónomo con WhatsApp como interfaz inicial. El núcleo funciona sin OpenClaw, Claude Code, Codex ni otros agentes externos; cualquier integración de ese tipo será opcional y desacoplada.

## Estado

**Stage 1 — desarrollo completo / QA real de WhatsApp pendiente.**

Stage 1 entrega un asistente local, determinista y limitado al self-chat:

- TypeScript ESM sobre Node 22.18+;
- SQLite integrado con `node:sqlite`, WAL y migraciones;
- interfaz `MessageTransport` independiente de WhatsApp;
- adapter Baileys v7 fijado a una versión concreta;
- auth state de Baileys persistido en SQLite;
- normalización PN/LID y resolución canónica del JID autorizado;
- allowlist estricta de self-chat para entrada y salida;
- deduplicación y prevención de loops;
- validación estricta de configuración;
- notas locales con completar/archivar;
- gastos PEN con categorías, consultas por período y resúmenes;
- recordatorios persistentes con cancelar/completar y scheduler con reintento;
- parsing de `hoy`, `mañana`, `en N minutos/horas/días`, días de semana y fechas explícitas;
- auditoría local de mutaciones sin guardar cuerpos en metadata de auditoría;
- `/healthz` y `/readyz`;
- `package-lock.json`, `npm ci` y audit de dependencias de runtime;
- Docker/Docker Compose;
- CI con tests y builds `linux/amd64` + `linux/arm64`.

Stage 1 **no incluye** IA, Calendar, audio, Observer, documentos ni agentes externos. Esas capacidades pertenecen a etapas posteriores.

## Seguridad por defecto

`WHATSAPP_ENABLED=false` y `WHATSAPP_SELF_JIDS` vacío son los defaults.

Con la allowlist vacía:

- no se procesa ningún mensaje de WhatsApp;
- no se envía ninguna respuesta;
- los mensajes enviados por ti a terceros no se usan para “descubrir” identidades propias;
- el transporte solo puede mostrar metadata de identidad que provenga de la propia sesión/configuración de WhatsApp para ayudarte a configurar manualmente la allowlist.

`sendText()` vuelve a validar el destino y rechaza cualquier JID que no esté expresamente incluido en `WHATSAPP_SELF_JIDS`.

## Desarrollo local

Requisitos: Node 22.18+.

```bash
cp .env.example .env
npm ci
npm run check
npm audit --omit=dev --audit-level=high
npm run dev
```

Con WhatsApp deshabilitado se puede validar DB, core, capabilities y health sin emparejar ninguna cuenta.

## Comandos de Stage 1

```text
ping
estado
ayuda

anota comprar filtro de agua
notas
completa nota #1
archiva nota #2

gasté S/ 78.50 en taxi #transporte
gastos
gastos hoy
gastos semana
gastos mes
resumen gastos mes
categoriza gasto #1 como transporte

recuérdame en 30 minutos revisar el horno
recuérdame mañana a las 10 pagar la tarjeta
recuérdame viernes a las 16 llamar a Pedro
recordatorios
completa recordatorio #1
cancela recordatorio #2
```

## Primer emparejamiento WhatsApp

Haz la primera validación preferentemente con una cuenta o número no crítico.

1. Configura el teléfono y habilita el transporte, pero deja vacía la allowlist:

```env
WHATSAPP_ENABLED=true
WHATSAPP_PHONE_NUMBER=519XXXXXXXX
WHATSAPP_SELF_JIDS=
```

2. Arranca la app y vincula el dispositivo con el pairing code.
3. Al conectar, la app puede mostrar `configuredPhoneJid` y/o `ownSocketId` provenientes de la configuración/sesión. **No autoriza automáticamente ninguno.**
4. Con `WHATSAPP_SELF_JIDS` vacío, cualquier mensaje debe ser ignorado y no debe producir respuesta.
5. Configura manualmente el JID PN confiable correspondiente a tu número y, solo si fue validado, el LID asociado:

```env
WHATSAPP_SELF_JIDS=519XXXXXXXX@s.whatsapp.net,123456789012345@lid
```

6. Reinicia el servicio y envía `ping` en tu self-chat. Debe responder `pong` exactamente una vez.
7. Ejecuta el checklist completo de [`docs/QA-PENDING.md`](docs/QA-PENDING.md) antes de considerar el despliegue listo para uso diario.

## Docker

```bash
cp .env.example .env
docker compose up -d --build
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/readyz
```

El compose publica health únicamente en loopback del host.

## Arquitectura y seguridad

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/QA-PENDING.md`](docs/QA-PENDING.md)

## Después de Stage 1

El siguiente trabajo empieza en Stage 2 y no modifica la independencia del core:

1. abstracción opcional de proveedor de IA para lenguaje más flexible;
2. audio/transcripción;
3. Calendar con propuesta + confirmación antes de escribir;
4. briefing personal;
5. Observer read-only sobre chats expresamente autorizados;
6. memoria/búsqueda y documentos;
7. integraciones opcionales con OpenClaw, Claude Code, Codex u otros agentes, solo si aportan valor.

## Aviso sobre Baileys

Baileys interactúa con el protocolo de WhatsApp Web y no es la API oficial de WhatsApp Business. Este proyecto es para uso personal y conservador. No debe utilizarse para spam, mensajes masivos, outreach automatizado, vigilancia ni automatización abusiva.
