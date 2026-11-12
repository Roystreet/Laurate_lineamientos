# Step 0 — Convertir a Markdown

## Objetivo
Tomar los archivos crudos (mixtos: `.txt`, `.json`, `.docx`, `.pdf`, `.xlsx`) y convertirlos a Markdown estructurado con front-matter YAML.

## Entrada
- `data/data-sin-procesar/requerimientos/` → archivos crudos de cada requerimiento.
- `data/data-sin-procesar/lineamientos_requerimiento/req_<codigo>/` → carpetas con lineamientos por requerimiento.

## Salida
- `data/mutable/requerimientos/<codigo>/<codigo>.md`
- `data/mutable/lineamientos/req_<codigo>/<id>.md`

## Sub-procesos
Por defecto, `step:0` corre los tres sub-scripts en orden:
- `convertir-requerimiento.js`: itera archivos crudos en `requerimientos/`, infiere el código (regex `\d+(\.\d+)+`) y genera el MD.
- `convertir-lineamiento.js`: por cada carpeta `req_<codigo>`, convierte sus archivos a un MD por lineamiento.
- `convertir-plan.js`: placeholder (no-op). Queda como gancho para una fuente de "plan" aún por definir.

## Comandos
- `npm run step:0`
- `npm run generar:requerimientos` (equivalente a `step:0 --solo=requerimientos`)
- `npm run generar:lineamientos` (equivalente a `step:0 --solo=lineamientos`)
- `npm run step:0 -- --solo=plan` (solo el sub-script `convertir-plan`)

## Notas
- La carpeta de salida se **limpia** en cada corrida (idempotencia).
- Si un JSON crudo tiene `codigo`, `titulo` o `descripcion`, se usan como metadatos.
