# QA pendiente — Stage 5B sugerencias de horarios

Updated: 2026-08-24 (America/Lima)

Stage 5B genera opciones deterministas a partir de Calendar read/free-busy. No usa IA, no crea acciones y no escribe Calendar.

## Gate automatizado — CI final verde

- [x] TypeScript strict PASS en Node 22.18.
- [x] Suite completa PASS — 241/241 tests.
- [x] Runtime dependency audit sin vulnerabilidades high+ — 0 vulnerabilidades.
- [x] Docker `linux/amd64` PASS, incluido smoke PDF/OCR.
- [x] Docker `linux/arm64` PASS, incluido smoke PDF/OCR.
- [x] `CALENDAR_SLOT_SUGGESTIONS_ENABLED=false` por defecto.
- [x] Habilitar sugerencias exige `CALENDAR_READ_ENABLED=true`.
- [x] Habilitar sugerencias NO exige `CALENDAR_ENABLED=true`.
- [x] Máximo de sugerencias limitado a 1–5.
- [x] Alignment validado entre 5–60 min y divisor exacto de 60.
- [x] Duración de reunión limitada a 15–240 min.
- [x] Duración debe respetar alignment antes de consultar Calendar.
- [x] Para `hoy`, se descarta tiempo anterior a `now` mediante Stage 5A.
- [x] Inicio se redondea hacia adelante al siguiente boundary configurado.
- [x] Opciones se generan determinísticamente, ordenadas y sin solaparse.
- [x] Se corta al máximo configurado.
- [x] Stage 5B usa solo free/busy de Stage 5A; no usa IA.
- [x] Capability exacta no intercepta la sintaxis de creación `agenda mañana a las 10 ...`.
- [x] Feature disabled devuelve respuesta local y cero provider work.
- [x] Test comprueba que sugerir horarios deja `action_requests` pendientes en cero.
- [x] Audit guarda periodo/duración/conteos, no horas propuestas.
- [x] Error de provider no filtra detalle privado al audit/reply.
- [x] `npm run doctor` valida y reporta Stage 5B sin red.

CI que cierra el gate automatizado: run #435 (`32692944680`).

## Google Calendar real — PENDIENTE

- [ ] Usar el mismo Calendar QA/read-only de Stage 5A con scopes mínimos.
- [ ] Con writes deshabilitados, `propón horarios mañana para 30 minutos` devuelve opciones coherentes con Calendar real.
- [ ] Crear hueco que comience fuera de boundary (p.ej. 09:17) y confirmar alineación a 09:30 con alignment 15.
- [ ] Crear busy intervals solapados/contiguos y confirmar que no aparecen falsos huecos.
- [ ] Día completamente libre: primeras opciones empiezan en el inicio de ventana y respetan duración/alignment.
- [ ] Día completamente ocupado: cero sugerencias.
- [ ] Ventana restante menor a duración: cero sugerencias.
- [ ] Probar 15, 30, 45, 60, 90, 120 y 240 minutos.
- [ ] Probar duración inválida/no alineada y confirmar cero tráfico Google.
- [ ] Confirmar que ningún evento es creado/modificado/borrado durante todos los casos.

## WhatsApp live — PENDIENTE

- [ ] Desde self-chat: comando con tilde `propón horarios mañana para 30 minutos` funciona.
- [ ] Desde self-chat: variante `propon` funciona.
- [ ] Desde self-chat: variante `sugiere` funciona.
- [ ] Respuesta contiene como máximo el número configurado de opciones.
- [ ] Respuesta incluye aviso de que no se creó acción/evento.
- [ ] Repetir exactamente el comando con Calendar sin cambios produce las mismas opciones salvo avance natural de `now` para `hoy`.
- [ ] Mensajes de terceros/grupos no pueden invocar Stage 5B.
- [ ] Observer no puede invocar Stage 5B.
- [ ] Una hora sugerida que parezca texto de comando no genera segunda ejecución.
- [ ] Después de sugerir, `acciones` no muestra acción nueva.
- [ ] `CALENDAR_ENABLED=false` continúa impidiendo cualquier write.

## Operación / privacidad — PENDIENTE

- [ ] Ejecutar `npm run doctor` en host real con Stage 5B enabled; confirmar mediante observación de red que doctor no contacta Google.
- [ ] Revisar logs: no deben contener lista de horarios propuesta ni tokens OAuth.
- [ ] Revisar audit SQLite: no debe contener timestamps/horas exactas de sugerencias.
- [ ] Confirmar en SQLite que no se persisten free slots/sugerencias.
- [ ] Medir latencia desde host objetivo; debe ser aproximadamente la de una consulta freeBusy.
- [ ] Reinicio/reboot no cambia algoritmo/config salvo datos actuales de Calendar.

## Condición de cierre Stage 5B

El gate automatizado está cerrado. No marcar Stage 5B live completo hasta tener Stage 5A live read-only funcional + opciones reales verificadas + confirmación explícita de cero actions y cero Calendar writes.
