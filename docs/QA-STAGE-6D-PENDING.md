# QA pendiente — Stage 6D dashboard ejecutivo de compromisos

Updated: 2026-08-25 (America/Lima)

Stage 6D agrega una vista ejecutiva local y explícita de compromisos abiertos. No agrega migración, flag, scheduler, IA, Observer, Calendar, transcripción ni acciones externas.

## Gate automatizado

- [x] TypeScript strict PASS en Node 22.18.
- [x] Suite completa inicial: 287/287 PASS.
- [x] Runtime dependency audit: 0 vulnerabilidades.
- [x] Docker `linux/amd64` build + smoke PDF/OCR PASS.
- [x] Docker `linux/arm64` build + smoke PDF/OCR PASS.
- [x] `resumen compromisos`, `estado compromisos` y `panel compromisos` son comandos explícitos.
- [x] Buckets mutuamente excluyentes: vencidos, resto de hoy, resto de semana, posteriores y sin fecha.
- [x] La suma de buckets coincide con el total de compromisos abiertos.
- [x] Los conteos se calculan directamente en SQLite y no se truncan por límites de render/listado.
- [x] Caso con 125 compromisos prueba que el total no queda limitado a 100.
- [x] `due_at == now` pertenece a vencidos.
- [x] `due_at == dayEnd` pertenece al resto de la semana, salvo que coincida con `weekEnd`.
- [x] `due_at == weekEnd` pertenece a posteriores.
- [x] Prioridad vencida lista como máximo 3 filas en orden determinista.
- [x] Próximos vencimientos lista como máximo 3 filas estrictamente futuras en orden determinista.
- [x] Bodies se compactan/truncan a 240 caracteres.
- [x] Respuesta total queda acotada a <=3500 caracteres.
- [x] Audit `commitment.summary` contiene solo conteos y cantidad mostrada; no body ni vencimientos exactos.
- [x] Wiring real: `CommitmentCapability` delega Stage 6D antes del manejo legacy.
- [x] Stage 6D no crea `action_request`.

## QA funcional live — PENDIENTE

Puede hacerse desde el self-chat autorizado y no requiere proveedores externos.

- [ ] Con cero compromisos abiertos, `resumen compromisos` muestra total 0 y estado vacío claro.
- [ ] Crear compromisos vencidos, hoy futuros, semana, posteriores y sin fecha; confirmar que cada uno aparece en un solo bucket.
- [ ] Confirmar que la suma visible de los cinco buckets coincide con `Abiertos`.
- [ ] Confirmar que compromisos `completed` y `cancelled` quedan fuera del resumen.
- [ ] Con más de 3 vencidos, mostrar solo los tres más antiguos por vencimiento/id.
- [ ] Con más de 3 futuros, mostrar solo los tres vencimientos más próximos.
- [ ] Confirmar que compromisos sin fecha no aparecen dentro de las listas de prioridad temporal.
- [ ] `estado compromisos` y `panel compromisos` devuelven el mismo estado que `resumen compromisos`.
- [ ] `resumen compromiso` u otros textos parecidos no activan el dashboard accidentalmente.
- [ ] Con body largo/multilínea, salida compacta y legible sin exceder el límite esperado.
- [ ] Completar/cancelar/reprogramar un compromiso y volver a ejecutar el resumen refleja inmediatamente el nuevo estado.
- [ ] Restart/reboot conserva los mismos conteos a igualdad de hora/estado.

## QA temporal — PENDIENTE

- [ ] Ejecutar alrededor de medianoche `America/Lima`: un compromiso posterior a medianoche cambia de `hoy` a `semana/posterior` según corresponda.
- [ ] Ejecutar el domingo antes de medianoche y el lunes después: confirmar transición limpia de `resto de semana` a `posteriores/semana nueva`.
- [ ] Confirmar que un vencimiento exactamente igual a `now` cuenta como vencido, no como futuro.
- [ ] Confirmar comportamiento exacto en `dayEnd` y `weekEnd` con datos controlados.
- [ ] Validar que un cambio horario del host no modifica los límites de negocio mientras `APP_TIME_ZONE=America/Lima`.

## Seguridad / privacidad — PENDIENTE

- [ ] Confirmar logs normales sin body ni vencimientos exactos del resumen.
- [ ] Confirmar audit `commitment.summary` con conteos solamente.
- [ ] Confirmar cero tráfico AI/Calendar/transcripción al ejecutar el dashboard.
- [ ] Confirmar cero `action_request` después de todos los aliases 6D.
- [ ] Confirmar que Observer/terceros no pueden invocar `CommitmentCapability` y por tanto no obtienen este resumen.

## Fuera de alcance

- Detección automática de promesas.
- Priorización mediante IA.
- Reordenamiento subjetivo por importancia.
- Mensajes a terceros.
- Escalamiento automático.
- Snooze/repetición.
- Modificación de compromisos desde el dashboard.

## Condición de cierre

Stage 6D puede considerarse cerrado a nivel de código cuando el HEAD documental final conserve suite/typecheck/audit + Docker AMD64/ARM64 verdes. El QA live de timezone, restart y aislamiento debe permanecer PENDIENTE hasta ejecutarse con evidencia real.