# Proyecto DACI — Lineamientos

Pipeline en Node.js (JavaScript puro, ESM) para procesar requerimientos y lineamientos crudos: convertirlos a Markdown estructurado, validarlos, analizarlos con LLM (OpenAI) y generar matrices Excel consolidadas.

## Requisitos
- Node.js >= 20
- npm (o pnpm)
- `OPENAI_API_KEY` en `.env` (requerida para `step:2` y `pipeline`).

## Instalación
```bash
npm install
cp .env.example .env   # luego editar OPENAI_API_KEY
```

## Estructura
```
src/
  config/paths.js                          Rutas centralizadas
  helpers/                                 fs, markdown, excel, logger, parsers (txt/json/docx/pdf/xlsx)
  llm/
    openai.client.js                       Cliente Responses API de OpenAI
    parse-json.js                          Parser tolerante de JSON devuelto por el LLM
    index.js                               Barrel
  prompt/
    propmt-analizar-requerimientos/        Prompt system + builder de prompt user
  steps/
    0-convertir-a-markdown/                Crudo → MD (requerimientos, lineamientos, plan)
    1-validar-requerimientos/              Validación estructural de los MD
    2-procesar-requerimiento/              Análisis LLM (gpt-5-mini) → hallazgos.xlsx por req
    3-generar-excel-por-requerimiento/     Excel de lineamientos por requerimiento
    4-generar-matriz-total-lineamientos/   Matriz Excel total de lineamientos
    5-consolidar-hallazgos/                Consolidado global de hallazgos
  index.js                                 Router CLI de steps
data/
  data-sin-procesar/                       Archivos crudos de entrada
  inmutable/
    lineamiento-hallazgo/<codigo>/         Salida del step 2 (xlsx por requerimiento)
    consolidado/consolidado.xlsx           Salida del step 5
  mutable/                                 Salida regenerable (MD)
  matriz-lineamientos/                     Excel de steps 3 y 4
documentacion/                             Un .md por step + índice general
logs/
```

## Comandos npm
| Comando | Descripción |
|---|---|
| `npm run generar:requerimientos` | Step 0 — solo sub-convertidor de requerimientos |
| `npm run generar:lineamientos` | Step 0 — solo sub-convertidor de lineamientos |
| `npm run step:0` | Convertir crudo a Markdown |
| `npm run step:1` | Validar estructura de requerimientos |
| `npm run step:2` | Analizar requerimientos × lineamientos con LLM (requiere `OPENAI_API_KEY`) |
| `npm run step:3` | Generar un Excel por requerimiento (lineamientos) |
| `npm run step:4` | Generar matriz total de lineamientos |
| `npm run step:5` | Consolidar todos los hallazgos en un Excel global |
| `npm run pipeline` | Ejecuta `0 → 1 → 2 → 3 → 4 → 5` end-to-end |

## Flujo
```
data/data-sin-procesar
        │
        ▼
   step 0  ─────────►  data/mutable (MD)
                          │
        ┌─────────────────┼────────────────┬──────────────┐
        ▼                 ▼                ▼              ▼
     step 1            step 2           step 3         step 4
   (validar)       (LLM hallazgos)    (xlsx req)    (matriz total)
                          │                │              │
                          ▼                ▼              ▼
       data/inmutable/lineamiento-hallazgo/    data/matriz-lineamientos/
                          │
                          ▼
                       step 5
                          │
                          ▼
       data/inmutable/consolidado/consolidado.xlsx
```

## Convención de naming
- Requerimientos: código jerárquico `1.1.1.1`.
- Lineamientos: viven en carpetas `req_<codigo>` (ej. `req_1.1.1.1`).

## Formatos soportados de entrada
`.txt`, `.md`, `.json`, `.docx` (mammoth), `.pdf` (pdf-parse), `.xlsx` (exceljs).

## Documentación
Detalle por script en [`documentacion/`](documentacion/):
- [Índice general](documentacion/README.md)
- [Step 0 — Convertir a Markdown](documentacion/step-0-convertir-a-markdown.md)
- [Step 1 — Validar requerimientos](documentacion/step-1-validar-requerimientos.md)
- [Step 2 — Procesar requerimiento (LLM)](documentacion/step-2-procesar-requerimiento.md)
- [Step 3 — Excel por requerimiento](documentacion/step-3-generar-excel-por-requerimiento.md)
- [Step 4 — Matriz total](documentacion/step-4-generar-matriz-total-lineamientos.md)
- [Step 5 — Consolidar hallazgos](documentacion/step-5-consolidar-hallazgos.md)

## Notas
- `data/mutable/` y `data/matriz-lineamientos/` se regeneran en cada corrida; no editar a mano.
- `data/inmutable/` contiene salidas del LLM y su consolidado; conservar bajo control.
- `step:2` y `pipeline` cargan `.env` automáticamente vía `node --env-file=.env` (Node 20+).
