# Stage 4B — Testing / QA pending

Updated: 2026-08-23 (America/Lima)

Este checklist cubre únicamente el OCR local de Stage 4B. El QA acumulado general sigue en `docs/QA-PENDING.md`; la evidencia PASS de Stage 4A está en `docs/QA-STAGE-4A-2026-08-23.md`.

## Automated gates

- [ ] TypeScript strict PASS.
- [ ] Suite completa PASS sin regresiones Stage 4A.
- [ ] Runtime dependency audit sin high+.
- [ ] Docker `linux/amd64` build PASS.
- [ ] Docker `linux/arm64` build PASS.
- [ ] `pdfinfo`, `pdftotext` y `pdftoppm` disponibles dentro de ambas imágenes.
- [ ] Tesseract disponible dentro de ambas imágenes.
- [ ] `spa` y `eng` aparecen en `tesseract --list-langs`.
- [ ] PDF con capa de texto no invoca OCR.
- [ ] PDF sin capa de texto invoca OCR una única vez.
- [ ] Page-count disagreement entre text/OCR se rechaza.
- [ ] OCR page limit se aplica antes de rasterizar.
- [ ] OCR text bound detiene trabajo adicional al alcanzar el máximo.
- [ ] Language string inválido se rechaza antes de ejecutar procesos.
- [ ] `DOCUMENTS_OCR_ENABLED=true` requiere `DOCUMENTS_ENABLED=true`.
- [ ] Audit registra `method=ocr` sin texto/filename/caption.
- [ ] OCR vacío no persiste documento.

## Runtime QA — OpenClaw / host ARM64

Usar worktree aislado y fixtures sintéticos. No usar documentos personales.

- [ ] Checkout detached del HEAD Stage 4B exacto y worktree clean.
- [ ] `npm ci`, `npm run check` y audit reproducibles.
- [ ] Build Docker ARM64 desde el repo sin instalar paquetes manualmente después.
- [ ] Registrar versiones exactas de Poppler y Tesseract.
- [ ] Confirmar `spa` + `eng` dentro de la imagen.
- [ ] Generar PDF sintético **image-only** de una página con texto en español e inglés.
- [ ] Poppler `pdftotext` del fixture devuelve vacío o sin texto útil.
- [ ] Con `DOCUMENTS_OCR_ENABLED=false`, el documento no se persiste.
- [ ] Con `DOCUMENTS_OCR_ENABLED=true`, OCR recupera un token sintético único y persiste una sola fila.
- [ ] `busca documentos <token>` encuentra el texto OCR.
- [ ] Audit del OCR no contiene token, filename, paths temporales, stdout/stderr ni SHA completo.
- [ ] DB/WAL/SHM no contienen PNG rasterizados ni bytes PDF raw.
- [ ] No quedan `/tmp/assistant-ocr-*` después de success.
- [ ] No quedan `/tmp/assistant-ocr-*` después de fallo controlado.
- [ ] PDF text-layer normal sigue usando únicamente Poppler; demostrar que Tesseract no se necesita para ese caso.
- [ ] PDF image-only de más páginas que `DOCUMENTS_OCR_MAX_PAGES` se rechaza antes de OCR por página.
- [ ] Probar truncamiento con `DOCUMENTS_MAX_TEXT_CHARS` pequeño y confirmar que no continúa OCR innecesario.
- [ ] Validar deadline/timeout OCR de forma determinista y segura si el entorno lo permite; de lo contrario marcar subcheck BLOCKED, no FAIL.
- [ ] Medir aproximadamente tiempo y RSS para PDF image-only de 1 página.
- [ ] Medir aproximadamente tiempo y RSS para PDF image-only de 5–10 páginas dentro del límite.
- [ ] Backup/restore mantiene texto OCR y FTS funcional.

## Security boundary

- [ ] Texto OCR que visualmente diga `anota QA_NO_DEBE_CREAR_NOTA` no crea nota.
- [ ] Texto OCR que diga `agenda ...` no crea action request.
- [ ] Texto OCR que diga `ia ...` no llama proveedor AI.
- [ ] Caption de PDF escaneado tampoco se ejecuta como comando.
- [ ] Documento de tercero/grupo no recibe OCR/media loader si existe sesión WhatsApp QA autorizada.
- [ ] Observer sigue sin persistir media ni OCR.

## WhatsApp live — opcional hasta disponer de sesión QA autorizada

- [ ] PDF escaneado real/sintético enviado al self-chat se procesa una sola vez.
- [ ] Restart no duplica el documento ya indexado.
- [ ] Mensajes de terceros/grupos no generan OCR ni replies.

Si no existe una sesión WhatsApp QA previamente autorizada, este bloque debe reportarse `BLOCKED` sin pairing nuevo.

## Stop conditions

Stage 4B no debe considerarse listo para uso diario si se detecta:

- OCR ejecutándose para PDFs que ya tienen texto;
- persistencia de PDF/PNG raw;
- tempfiles huérfanos reproducibles;
- bypass de límites de páginas/DPI/texto/timeout;
- texto OCR reinyectándose a comandos/capabilities;
- media Observer llegando al OCR;
- diferencia relevante de funcionamiento entre AMD64 y ARM64.
