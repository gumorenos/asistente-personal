# QA pendiente — Stage 7A Gmail metadata-only

Updated: 2026-08-25 (America/Lima)

Stage 7A agrega lectura explícita y opt-in de metadata Gmail. No lee bodies/adjuntos, no persiste correo, no usa IA y no modifica el buzón.

## Gate automatizado

- [x] `GMAIL_READ_ENABLED=false` por defecto.
- [x] Habilitar requiere credenciales OAuth Gmail dedicadas.
- [x] Límites de request 1–10 y respuesta acotada.
- [x] `users.messages.list` usa `INBOX`; unread agrega `UNREAD`.
- [x] `includeSpamTrash=false`.
- [x] Stage 7A nunca usa parámetro `q`.
- [x] `users.messages.get` usa exclusivamente `format=metadata`.
- [x] Solo solicita headers `From` y `Subject`.
- [x] No usa `format=full` ni `format=raw`.
- [x] Fan-out de detalles queda limitado al número pedido/configurado.
- [x] IDs duplicados de list se deduplican antes de fetch de detalle.
- [x] Detail id/threadId debe coincidir con el item listado.
- [x] `internalDate` se valida y normaliza.
- [x] Headers externos se compactan y acotan.
- [x] Caracteres Unicode `Cc`/`Cf`, incluidos controles bidi, se eliminan antes de render.
- [x] Un 401 fuerza como máximo un refresh/retry.
- [x] Errores HTTP no exponen body upstream.
- [x] Capability explicit-only; texto general no activa Gmail.
- [x] Modo disabled hace cero llamadas al provider.
- [x] Audit de éxito guarda solo modo/conteos.
- [x] Audit no guarda sender, subject, Gmail id ni thread id.
- [x] Fallos devuelven respuesta segura y audit sin detalle privado.
- [x] Lectura Gmail no crea `action_request`.
- [x] Runtime usa un token provider Gmail separado de Calendar.
- [x] `doctor` valida configuración Gmail sin hacer conectividad de proveedor.
- [x] `.env.example` documenta scope `gmail.metadata` y límites.
- [ ] Gate final del HEAD documental: TypeScript + suite completa PASS.
- [ ] Gate final: runtime dependency audit 0 vulnerabilidades.
- [ ] Gate final: Docker `linux/amd64` + smoke PASS.
- [ ] Gate final: Docker `linux/arm64` + smoke PASS.

## QA live Google/Gmail — PENDIENTE

Usar preferiblemente una cuenta/corpus QA no sensible.

- [ ] Crear/obtener un refresh token dedicado con scope mínimo `https://www.googleapis.com/auth/gmail.metadata`.
- [ ] Confirmar desde Google que el token no tiene scopes Gmail adicionales innecesarios.
- [ ] `GMAIL_READ_ENABLED=false`: `correos` responde disabled y no genera tráfico Gmail.
- [ ] Habilitado: `correos` devuelve metadata de mensajes del Inbox real.
- [ ] `correos no leídos` devuelve solamente mensajes `INBOX + UNREAD`.
- [ ] Comparar fecha, From, Subject y unread contra Gmail UI para varios mensajes controlados.
- [ ] Mensaje sin Subject usa fallback seguro.
- [ ] Mensaje con From ausente/malformado usa fallback seguro.
- [ ] Probar 1, default y máximo configurado; `max+1` se rechaza localmente.
- [ ] Confirmar que un correo no leído permanece no leído después de consultarlo.
- [ ] Confirmar labels, archive/trash/spam y demás estado del buzón no cambian.
- [ ] Confirmar que ningún attachment se descarga.
- [ ] Inspeccionar requests/logs de API: no `q`, no `format=full/raw`, no body/attachment endpoint.
- [ ] Revocar/invalidar refresh token y confirmar error seguro.
- [ ] Validar recuperación real tras access-token 401 si puede reproducirse sin ampliar permisos.
- [ ] Restart/reboot conserva configuración pero no existe metadata Gmail persistida en SQLite.
- [ ] Revisar SQLite/backup: no sender, subject, Gmail id/thread id introducidos por Stage 7A.
- [ ] Revisar logs/audit: no sender/subject/Gmail ids ni upstream bodies.
- [ ] Observer/terceros no pueden invocar la capability; solo self-chat autorizado llega a AssistantCore.
- [ ] Confirmar cero tráfico AI/Calendar/embeddings/transcripción por una consulta Gmail.
- [ ] Confirmar cero `action_request` tras consultas reales.
- [ ] Medir latencia y cuota para 1/5/10 mensajes; documentar si el patrón list + N metadata gets es aceptable.

## Seguridad / privacidad — decisiones antes de ampliar Gmail

- [ ] Revisar si el uso cotidiano necesita realmente body read antes de abrir Stage 7B.
- [ ] Si se quiere body, definir retención y si será solo efímero o persistido/indexado localmente.
- [ ] Si se quiere búsqueda Gmail libre, evaluar el scope requerido y separar ese consentimiento.
- [ ] Si se quiere cualquier write (read/unread/labels/archive/delete), definir action pipeline y aprobación explícita.
- [ ] Si se quiere send/reply/forward, diseñar preview exacto + confirmación separada antes de habilitar scopes de envío.
- [ ] Si se quiere IA sobre correo, definir qué contenido puede salir a proveedor y mantenerlo opt-in explícito.

## Fuera de alcance

- body HTML/plain text;
- attachments;
- free-text Gmail search;
- persistencia/indexado de email;
- resúmenes AI;
- polling/background monitor;
- marcar leído/no leído;
- labels/archive/trash/delete;
- send/reply/forward/drafts.

## Condición de cierre

Stage 7A puede considerarse cerrado a nivel de código cuando el HEAD final tenga suite/typecheck/audit + Docker AMD64/ARM64 verdes. Ningún check Gmail live se considera aprobado por ese gate automatizado.