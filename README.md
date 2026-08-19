# Asistente Personal

Asistente personal autónomo con WhatsApp como interfaz inicial. El núcleo funciona sin OpenClaw, Claude Code, Codex ni otros agentes externos; cualquier integración de ese tipo será opcional y desacoplada.

## Estado

**Stage 0 — foundation / self-chat.**

Incluye:

- TypeScript ESM sobre Node 22.18+;
- SQLite integrado con `node:sqlite`;
- migraciones y persistencia de mensajes;
- interfaz `MessageTransport` independiente de WhatsApp;
- adapter Baileys v7 fijado a una versión concreta;
- auth state de Baileys persistido en SQLite;
- normalización de mensajes y soporte PN/LID alternativo;
- allowlist estricta para self-chat;
- protección básica contra respuestas en bucle;
- comandos deterministas `ping`, `estado`, `ayuda`;
- `/healthz` y `/readyz`;
- Docker/Docker Compose;
- CI y tests unitarios.

Todavía **no** incluye IA, Calendar, audios, Observer, documentos ni agentes externos.

## Seguridad por defecto

`WHATSAPP_ENABLED=false` y `WHATSAPP_SELF_JIDS` vacío son los defaults. Con la allowlist vacía, el servicio puede detectar y registrar el JID candidato de un mensaje propio para configuración, pero **no procesa ni responde**.

El transporte también rechaza programáticamente cualquier `sendText()` cuyo destino no esté en `WHATSAPP_SELF_JIDS`.

## Desarrollo local

Requisitos: Node 22.18+.

```bash
cp .env.example .env
npm install
npm run check
npm run dev
```

Con WhatsApp deshabilitado se puede validar DB/core/health sin emparejar ninguna cuenta.

## Primer emparejamiento WhatsApp

1. Usa preferentemente una cuenta/número de prueba para la primera validación.
2. En `.env`, configura:

```env
WHATSAPP_ENABLED=true
WHATSAPP_PHONE_NUMBER=519XXXXXXXX
WHATSAPP_SELF_JIDS=
```

3. Arranca la app. Mostrará un pairing code en logs.
4. Vincula el dispositivo desde WhatsApp.
5. En tu self-chat envía `ping`. Con la allowlist aún vacía, la app **no debe responder** y registrará el JID candidato sin registrar el contenido del mensaje.
6. Copia el/los JID propios encontrados a `WHATSAPP_SELF_JIDS`, por ejemplo:

```env
WHATSAPP_SELF_JIDS=519XXXXXXXX@s.whatsapp.net,123456789012345@lid
```

7. Reinicia y envía `ping` otra vez. La respuesta esperada es `pong` una sola vez.

Todo este flujo está marcado como QA manual en [`docs/QA-PENDING.md`](docs/QA-PENDING.md).

## Docker

```bash
cp .env.example .env
docker compose up -d --build
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/readyz
```

El compose publica health únicamente en loopback del host.

## Arquitectura

Ver [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) y [`docs/SECURITY.md`](docs/SECURITY.md).

## Próximas etapas

1. cerrar QA real de Stage 0 y persistencia/reconexión;
2. notas, recordatorios y gastos;
3. abstracción de proveedor IA;
4. audio/transcripción;
5. Calendar con confirmación;
6. briefing;
7. Observer read-only sobre allowlist explícita;
8. memoria/búsqueda y documentos;
9. integraciones opcionales con agentes externos, si aportan valor.

## Aviso sobre Baileys

Baileys interactúa con el protocolo de WhatsApp Web; no es la API oficial de WhatsApp Business. Este proyecto es para uso personal y conservador. No debe utilizarse para spam, mensajes masivos, outreach automatizado, vigilancia ni automatización abusiva.
