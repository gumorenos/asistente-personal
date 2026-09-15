# QA pendiente — Stage 7D Gmail analysis

Los tests/CI automatizados no convierten ninguna prueba Gmail/OAuth/WhatsApp/proveedor IA real en PASS. Según la estrategia actual del proyecto, estos checks live se acumulan para una ronda posterior junto con otros bloques; no se solicita QA remoto inmediatamente después de Stage 7D.

## Gate automatizado — PASS

Implementación validada en `102e7027a7e0d78d73f78fe7a12a11d76b8b51d8`, CI #676 (run `34979276710`):

- [x] `npm ci --no-audit --no-fund` PASS en Node 22.18.0 / npm 10.9.3.
- [x] TypeScript `tsc --noEmit` PASS.
- [x] 335/335 tests PASS, 0 fail/skipped/cancelled.
- [x] Edge case de priorización: 10 correos con metadata hostil/larga y límite mínimo de 1000 chars conserva JSON válido y todas las filas.
- [x] `npm audit --omit=dev --audit-level=high` PASS — 0 vulnerabilidades.
- [x] `docker compose config` con identidad non-root PASS.
- [x] Docker linux/amd64 build PASS.
- [x] linux/amd64 PDF/OCR smoke PASS.
- [x] linux/amd64 bind-mounted data write smoke como host identity PASS.
- [x] Docker linux/arm64 build PASS.
- [x] linux/arm64 PDF/OCR smoke PASS.
- [x] linux/arm64 bind-mounted data write smoke como host identity PASS.

`sharp` queda fijado en la versión parcheada `0.35.4`; el lockfile fue regenerado limpiamente y el helper temporal usado para refrescarlo fue eliminado de la rama. No se actualizó Baileys como parte de este fix.

## Configuración / doble opt-in — PENDING live

- [ ] Con Gmail read habilitado y `GMAIL_ANALYSIS_ENABLED=false`, confirmar que no se llama al proveedor IA.
- [ ] Con IA genérica habilitada y `GMAIL_ANALYSIS_ENABLED=false`, confirmar que ningún correo se exporta.
- [ ] Habilitar Stage 7D únicamente con cuenta Gmail QA y proveedor IA controlado.
- [ ] Confirmar que `doctor` falla cerrado si falta Gmail read o AI cuando Stage 7D está activo.

## Resumen explícito — PENDING live

- [ ] Ejecutar `correos` desde self-chat y luego `resume correo #N` sobre un mensaje QA conocido.
- [ ] Validar alias `resumen correo #N`.
- [ ] Confirmar que sin lista previa, índice inválido, TTL vencido o restart no se abre ningún mensaje.
- [ ] Confirmar que se obtiene únicamente el body del correo exacto seleccionado.
- [ ] Confirmar que Gmail id/thread id no llegan al proveedor IA.
- [ ] Confirmar output legible, sanitizado y acotado.

## Priorización metadata-only — PENDING live

- [ ] Ejecutar `prioriza correos` y `prioriza correos 3` con corpus QA controlado.
- [ ] Capturar request de QA al proveedor y confirmar que contiene solo fecha/unread/From/Subject y número temporal.
- [ ] Confirmar que no se solicita body/snippet/attachment para priorización.
- [ ] Confirmar que Gmail id/thread id no salen al proveedor.
- [ ] Confirmar que priorizar invalida una selección anterior y exige `correos` antes de un posterior `correo #N`.

## Prompt injection / seguridad — PENDING live

- [ ] Usar un correo QA cuyo subject/body incluya instrucciones tipo `ignore previous instructions`, solicitudes de ejecutar acciones y caracteres bidi/control.
- [ ] Confirmar que el análisis trata ese contenido como datos y no ejecuta instrucciones.
- [ ] Confirmar que no se crea `action_request`, Calendar event, commitment, reminder ni write Gmail.
- [ ] Confirmar que no existe respuesta a terceros/grupos y Observer no puede disparar Stage 7D.
- [ ] Confirmar que el modelo no recibe herramientas ni contexto personal adicional automático.

## Persistencia / audit — PENDING live

- [ ] Revisar SQLite después de resumen y priorización: no body, From/Subject, Gmail ids/thread ids, payload IA ni respuesta IA persistidos por Stage 7D.
- [ ] Revisar `whatsapp_message_store`: respuestas de análisis deben quedar fuera por `ephemeral`.
- [ ] Revisar audit: solo metadata operacional; ningún contenido de correo ni texto del proveedor.
- [ ] Restart: no se reconstruye selección ni estado de análisis Gmail.

## Errores reales — PENDING live

- [ ] Timeout/fallo del proveedor IA devuelve error seguro sin filtrar contenido upstream.
- [ ] Fallo Gmail durante resumen no provoca llamada IA con datos parciales.
- [ ] Revocación/401 Gmail sigue respetando el comportamiento de Stage 7A/7B y no amplía scopes.

## Criterio de cierre live

Stage 7D puede cerrarse live solo cuando se ejecute una ronda acumulada con evidencia reproducible de los checks aplicables. Hasta entonces: **código/CI automatizado PASS + QA Gmail/OAuth/WhatsApp/IA real pendiente**.
