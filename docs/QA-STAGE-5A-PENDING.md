# QA pendiente — Stage 5A Calendar read-only

Updated: 2026-08-24 (America/Lima)

Stage 5A agrega lectura explícita de Google Calendar sin habilitar writes. Este checklist separa lo cubierto automáticamente de lo que requiere credenciales/Calendar/WhatsApp/host reales.

## Último gate automatizado conocido

Commit probado: `874294913b0457a9ed61162e07deec65527815f1`

GitHub Actions CI #417, run `32692438263`:

- [x] TypeScript strict PASS en Node 22.18.
- [x] **234/234 tests PASS**.
- [x] `npm audit --omit=dev --audit-level=high`: **0 vulnerabilidades**.
- [x] Docker `linux/amd64` PASS + smoke PDF/OCR tooling PASS.
- [x] Docker `linux/arm64` PASS + smoke PDF/OCR tooling PASS.
- [x] `CALENDAR_READ_ENABLED=false` por defecto.
- [x] Calendar read puede habilitarse con `CALENDAR_ENABLED=false`.
- [x] Read habilitado exige client id, client secret y refresh token.
- [x] Ventana laboral, mínimo de slot, max events y reply bounds se validan.
- [x] `events.list` usa `timeMin/timeMax`, `singleEvents=true`, `orderBy=startTime` y proyección mínima `id/status/summary/start/end`.
- [x] Eventos cancelados se ignoran.
- [x] Eventos timed y all-day se normalizan sin descripción, attendees, location ni otros campos.
- [x] `freeBusy.query` consulta un solo calendario y normaliza únicamente intervalos busy válidos.
- [x] 401 fuerza exactamente un refresh/retry.
- [x] HTTP errors no exponen response body remoto.
- [x] Errores a nivel calendario en freeBusy no exponen detalle remoto.
- [x] `agenda hoy`, `agenda mañana` y `agenda semana` usan boundaries timezone-aware.
- [x] `disponibilidad hoy` descarta tiempo ya pasado dentro del día.
- [x] Busy intervals solapados se fusionan antes de calcular huecos.
- [x] Solo se muestran huecos >= `CALENDAR_READ_MIN_FREE_MINUTES`.
- [x] `agenda mañana a las 10 ...` no es interceptado por Calendar read y sigue disponible para proposal/write flow.
- [x] Audit guarda solo periodo y conteos; no títulos, horas ni response bodies.
- [x] Fallos se devuelven como error local seguro.
- [x] `npm run doctor` valida/reportar Calendar read de forma local y no implementa llamadas Google.

El commit de este documento es posterior al gate citado y no cambia código productivo. Los checks externos/live siguientes continúan pendientes.

## OAuth / Google Calendar real — PENDIENTE

- [ ] Crear credenciales QA no críticas o usar un Calendar QA dedicado.
- [ ] Emitir refresh token con scopes mínimos de Stage 5A:
  - `https://www.googleapis.com/auth/calendar.events.readonly`
  - `https://www.googleapis.com/auth/calendar.freebusy`
- [ ] Confirmar que el token de solo lectura NO tiene scope de escritura.
- [ ] Con `CALENDAR_ENABLED=false` y `CALENDAR_READ_ENABLED=true`, `agenda hoy` lista eventos reales.
- [ ] Validar evento con hora y evento all-day reales.
- [ ] Validar recurrencia real expandida por `singleEvents=true`.
- [ ] Validar evento privado: respetar exactamente lo que Google permita ver; no intentar recuperar campos ocultos.
- [ ] `disponibilidad mañana` coincide con Google Calendar dentro de la ventana configurada.
- [ ] Crear busy intervals contiguos/solapados y comprobar merge + free slots.
- [ ] Día sin eventos devuelve agenda vacía y disponibilidad completa dentro de ventana.
- [ ] Día totalmente ocupado devuelve cero huecos.
- [ ] Refresh token revocado devuelve error seguro sin secretos/body remoto.
- [ ] Probar 401 real/reautorización si puede hacerse sin alterar cuenta principal.
- [ ] Revisar logs del proceso: no deben contener access token, refresh token, título de eventos ni intervalos de agenda.
- [ ] Revisar audit SQLite: no debe contener títulos ni horas exactas consultadas.

## WhatsApp live — PENDIENTE

- [ ] Desde self-chat real: `agenda hoy` produce una sola respuesta.
- [ ] Desde self-chat real: `agenda mañana` y `agenda semana` funcionan en `America/Lima`.
- [ ] Desde self-chat real: `disponibilidad hoy` y `disponibilidad mañana` funcionan.
- [ ] `CALENDAR_READ_ENABLED=false` produce respuesta local de feature deshabilitada y cero tráfico Google.
- [ ] Mensajes de terceros/grupos nunca pueden invocar Calendar read a través del core.
- [ ] Observer allowlisted no puede disparar Calendar read.
- [ ] Respuesta de Calendar read que contenga texto parecido a comandos no se reejecuta.
- [ ] `agenda mañana a las 10 reunión QA por 30 minutos` sigue creando únicamente propuesta de write; no hace `events.list`.
- [ ] `CALENDAR_ENABLED=false` continúa bloqueando `ejecuta acción #N` aunque Calendar read esté habilitado.

## Operación / seguridad — PENDIENTE

- [ ] Ejecutar `npm run doctor` en host real con Calendar read enabled y confirmar mediante observación de red que no hace tráfico Google.
- [ ] Restart del proceso conserva configuración y vuelve a consultar sin pairing OAuth interactivo.
- [ ] Medir latencia de `agenda hoy` y `disponibilidad mañana` desde el host objetivo.
- [ ] Confirmar comportamiento ante pérdida/restauración de red sin duplicar mensajes WhatsApp.
- [ ] Revisar cuota de Calendar API con uso personal normal.
- [ ] Confirmar en DB real que no se persisten eventos/free-busy; Stage 5A debe ser lectura remota efímera.

## Condición de cierre Stage 5A

No marcar Stage 5A como QA live completo hasta tener: gate CI verde + token read-only real + agenda/freeBusy reales + boundaries WhatsApp/self-chat + confirmación de cero writes con `CALENDAR_ENABLED=false`.
