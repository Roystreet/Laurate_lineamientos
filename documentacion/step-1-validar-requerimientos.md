# Step 1 — Validar Requerimientos

## Objetivo
Verificar que los MD generados en step 0 tengan la estructura mínima.

## Entrada
- `data/mutable/requerimientos/<codigo>/<codigo>.md`
- `data/mutable/lineamientos/req_<codigo>/`

## Validaciones
- El MD del requerimiento contiene secciones `# Requerimiento` y `## Contenido`.
- Tiene front-matter YAML (warning si falta).
- Existe la carpeta de lineamientos asociada (warning si falta).

## Salida
- Reporte por consola con `errores` (bloquean) y `warnings` (no bloquean).

## Comando
- `npm run step:1`
