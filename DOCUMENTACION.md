# Documentación — Proyecto Daci Lineamientos

> Pipeline en Node.js (JS puro, ESM) para **auditoría de calidad institucional**: contrasta
> documentos de evidencia ("lineamientos") contra criterios base ("requerimientos") usando
> modelos LLM de OpenAI, y produce matrices Excel de hallazgos.

Este documento explica **qué hace el proyecto**, **cómo ejecutarlo** y **cómo extenderlo de
forma segura**. Todo el análisis está basado en el código de [`src/`](src/).

---

## 1. Visión general

El objetivo del proyecto es **auditar evidencia documental**. Una universidad (u otra
institución) tiene un conjunto de **requerimientos** de calidad (criterios que debe cumplir),
y para cada requerimiento aporta uno o varios **lineamientos** (políticas, procedimientos,
manuales, que son la evidencia). El pipeline:

1. Normaliza documentos crudos (PDF, DOCX, XLSX, etc.) a **Markdown**.
2. Extrae de cada requerimiento una **ficha JSON** con su nombre y sus **consideraciones**
   (condiciones que la evidencia debe satisfacer), usando un LLM.
3. **Audita** cada lineamiento contra su requerimiento y consideraciones, también con un LLM,
   produciendo **hallazgos** clasificados.
4. **Consolida** todos los hallazgos en una matriz Excel pivoteada lista para revisión.

### Diagrama del flujo (comando `pipeline`)

```
documentos crudos (data/data-sin-procesar/)
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 0  convertir-a-markdown                                  │
│   requerimientos → data/mutable/requerimientos/<cod>/<cod>.md │
│   lineamientos   → data/mutable/lineamientos/req_<cod>/<id>.md│
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ generate:formato_json_ficha_requerimientos   (LLM)           │
│   → data/mutable/requerimientos-json/<cod>.json              │
│     { nombre_requerimiento, tipo,                            │
│       requerimientos_relacionados[], consideraciones[] }     │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 1  validar-requerimientos  (validación, sin LLM)        │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 2  procesar-requerimiento   (LLM, multi-criterio)       │
│   por requerimiento: TODOS sus lineamientos juntos,          │
│   los 6 criterios aplicables EN PARALELO → hallazgos         │
│   → data/inmutable/lineamiento-hallazgo/<cod>/<cod>.xlsx     │
└─────────────────────────────────────────────────────────────┘
        │
        ├─────────────► STEP 3  excel por requerimiento (inventario)
        │                  → data/matriz-lineamientos/req_<cod>.xlsx
        ├─────────────► STEP 4  matriz total de lineamientos (inventario)
        │                  → data/matriz-lineamientos/matriz-total-lineamientos.xlsx
        ▼
┌─────────────────────────────────────────────────────────────┐
│ STEP 5  consolidar-hallazgos                                 │
│   matriz por lineamiento (C1) + filas de hallazgos (2-6)     │
│   → data/inmutable/consolidado/consolidado.xlsx             │
└─────────────────────────────────────────────────────────────┘
```

> **Nota:** los Steps 3 y 4 generan matrices de **inventario/preview** de los lineamientos
> (no contienen los hallazgos del LLM). Los resultados de auditoría reales están en Step 2
> (por requerimiento) y Step 5 (consolidado).

---

## 2. Conceptos del dominio

| Concepto | Significado |
|---|---|
| **Requerimiento** | Criterio base que la institución debe cumplir. Identificado por un **código** jerárquico (ej. `5.3.1.14`). |
| **Tipo de requerimiento** | `lineamiento` \| `plan` \| `informe` \| `reporte`. Lo **clasifica el LLM** en `generate`. Define qué criterios aplican. |
| **Lineamiento** | Documento de evidencia (política, procedimiento, manual) asociado a un requerimiento. Un requerimiento puede tener **N** lineamientos. |
| **Consideración** | Condición concreta que la evidencia debe satisfacer. Se extraen del texto del requerimiento. Alimentan el **Criterio 1**. |
| **Requerimientos relacionados** | Códigos de otros requerimientos vinculados (de "EXIGENCIAS DE LA CALIDAD VINCULADAS"). Insumo del **Criterio 6 (Integración)**. |
| **Criterio** | Una de las **6 dimensiones** de evaluación (ver §2.1). Cada criterio se evalúa con su propio prompt. |
| **Hallazgo** | Resultado del análisis del LLM para un criterio sobre el conjunto de lineamientos. `tipo_hallazgo`: `Observación` \| `Oportunidad de mejora` \| `Cumple`. |
| **estado** | Veredicto del criterio: `Cumple` \| `No cumple` \| `No aplica`. |
| **literal** | Cita textual del fragmento de la evidencia donde se cumple (vacío/N/A si no). |
| **integracion** | Solo Criterio 6: `Integrado` \| `Parcial` \| `No Integrado`. |

Relación: `1 Requerimiento → N Lineamientos`, `1 Requerimiento → N Consideraciones`,
`1 Requerimiento → 6 Criterios`. En la auditoría (Step 2), **cada criterio aplicable se evalúa
contra el CONJUNTO completo de lineamientos** del requerimiento (no uno por uno), para lograr
evaluaciones congruentes.

### 2.1. Los 6 criterios y su aplicabilidad

| # | Criterio | Aplica a (tipo) | Foco |
|---|---|---|---|
| 1 | Información completa | todos | Trazabilidad, cumple las `consideraciones`, formato/aprobación (código/versión/fecha), sin alteraciones. |
| 2 | Coherencia | todos | Articulación lógica interna (documentos de gestión) y externa (normativa nacional). |
| 3 | Consistencia | todos | Estructura clara y lógica, justificación/sustento, vinculación con el objetivo. |
| 4 | Sostenibilidad | `plan`, `informe`, `reporte` | Planificación, recursos (financieros/humanos), mecanismos de seguimiento y evaluación. |
| 5 | Mejora continua | `informe` | Identificación de mejoras a partir de resultados y acciones para incorporarlas. |
| 6 | Integración | `lineamiento` | ¿Los entregables de los requerimientos relacionados están establecidos en los lineamientos? |

La matriz `tipo → criterios` vive en el registro [`src/prompt/criterios/index.js`](src/prompt/criterios/index.js)
(`CRITERIOS[].aplicaA`). Un criterio no aplicable genera **una fila `estado = No aplica`** (trazable).

---

## 3. Arquitectura del código

```
src/
├── index.js                      # Punto de entrada / dispatcher CLI
├── config/
│   └── paths.js                  # Todas las rutas de datos + helpers de nombres
├── steps/
│   ├── 0-convertir-a-markdown/
│   │   ├── index.js              # runStep0 (orquesta los 3 sub-conversores)
│   │   ├── convertir-requerimiento.js
│   │   ├── convertir-lineamiento.js
│   │   └── convertir-plan.js     # NO-OP (placeholder, pendiente de fuente)
│   ├── generar-json-requerimientos/
│   │   └── index.js              # runGenerarJsonRequerimientos (LLM)
│   ├── 1-validar-requerimientos/index.js   # runStep1
│   ├── 2-procesar-requerimiento/index.js   # runStep2 (LLM, núcleo multi-criterio)
│   ├── 3-generar-excel-por-requerimiento/index.js  # runStep3
│   ├── 4-generar-matriz-total-lineamientos/index.js # runStep4
│   └── 5-consolidar-hallazgos/index.js     # runStep5 (matriz por lineamiento)
├── helpers/
│   ├── fs.helper.js              # I/O de archivos (fast-glob, fs/promises)
│   ├── markdown.helper.js        # Construcción de Markdown + front-matter
│   ├── excel.helper.js           # Esquema y lectura/escritura de Excel de hallazgos
│   ├── logger.js                 # Logger con colores (chalk)
│   └── parsers/
│       ├── index.js              # parseAny() + SUPPORTED_EXTS
│       ├── parseTxt.js  parseJson.js  parseDocx.js  parsePdf.js  parseXlsx.js
├── llm/
│   ├── index.js                  # Re-exporta callOpenAI y parsers JSON
│   ├── openai.client.js          # Cliente OpenAI (Responses API)
│   └── parse-json.js             # parseLlmJson / parseLlmJsonObject
└── prompt/
    ├── criterios/                            # ★ Prompts de los 6 criterios + registro
    │   ├── _base.js                          # ROL, reglas comunes, bloques y formato JSON
    │   ├── c1-informacion-completa.js … c6-integracion.js
    │   └── index.js                          # CRITERIOS, TIPOS, planCriterios(), normalizeTipo()
    ├── propmt-analizar-requerimientos/        # (LEGADO: auditor de 1 criterio; ya no se usa)
    │   ├── index.js  template.js
    └── propmt-convertir-requerimientos-json/  # (sic: typo "propmt") extractor de la ficha
        └── index.js  template.js (SYSTEM_PROMPT del extractor)
```

### Punto de entrada — [`src/index.js`](src/index.js)

- `parseArgs(argv)`: separa `command` de `--flags` (formato `--clave=valor` o `--clave` como
  booleano `true`).
- `STEPS`: mapa `step:0 … step:5` → función del step.
- `COMMANDS`: mapa `generate:formato_json_ficha_requerimientos` → función.
- `runPipeline(flags)`: ejecuta **en orden** step0 → generarJson → step1 → step2 → step3 →
  step4 → step5.
- `main()`: despacha `pipeline`, un step, o un comando; captura errores y hace `process.exit(1)`.

### Configuración de rutas — [`src/config/paths.js`](src/config/paths.js)

Define `ROOT`, `DATA` y el objeto `PATHS` (ver tabla en §4). Helpers de nombres:
- `reqFolderName(codigo)` → `req_<codigo>` (prefijo `REQ_FOLDER_PREFIX = 'req_'`).
- `codigoFromReqFolder(folderName)` → quita el prefijo `req_`.

### Helpers

- [`fs.helper.js`](src/helpers/fs.helper.js): `ensureDir`, `pathExists`, `readFileText`,
  `readFileBuffer`, `writeFileText` (crea el directorio padre), `cleanDir` (borra y recrea),
  `listFiles` (usa `fast-glob`, rutas absolutas), `listDirs`, `extOf`.
- [`markdown.helper.js`](src/helpers/markdown.helper.js): `frontMatter`, `heading`,
  `paragraph`, `table`, `buildRequerimientoMd`, `buildLineamientoMd`. El Markdown generado
  incluye front-matter YAML con `tipo`, `codigo`/`id`, `fuente`, `generadoEn`.
- [`excel.helper.js`](src/helpers/excel.helper.js): `HALLAZGO_COLUMNS` (esquema de columnas),
  `HALLAZGO_KEYS`, `writeHallazgosExcel`, `readHallazgosExcel`. **Es el contrato compartido**
  entre Step 2 (escribe) y Step 5 (lee).
- [`logger.js`](src/helpers/logger.js): `logger.info/ok/warn/error/step`.

### Parsers — [`src/helpers/parsers/`](src/helpers/parsers/)

`parseAny(file)` despacha por extensión y devuelve siempre `{ text, meta }` (algunos también
`data`/`sheets`/`warnings`):

| Extensión | Parser | Notas |
|---|---|---|
| `.txt`, `.md` | `parseTxt` | Texto plano. |
| `.json` | `parseJson` | Si es objeto, lo expone también como `meta`. |
| `.docx` | `parseDocx` | `mammoth.convertToMarkdown`. |
| `.pdf` | `parsePdf` | `pdf-parse` (importado desde `pdf-parse/lib/pdf-parse.js`). `meta.pages`. |
| `.xlsx`, `.xlsm` | `parseXlsx` | `exceljs`; aplana hojas a líneas `celda | celda`. |

`SUPPORTED_EXTS = ['.txt', '.md', '.json', '.docx', '.pdf', '.xlsx', '.xlsm']`.

### LLM — [`src/llm/`](src/llm/)

- [`openai.client.js`](src/llm/openai.client.js): `callOpenAI({ system, user, model,
  temperature, maxOutputTokens, reasoningEffort })`. Usa la **Responses API** de OpenAI
  (`client.responses.create`). Detalles:
  - Cliente perezoso (singleton); lee `OPENAI_API_KEY` de `process.env`.
  - Para modelos `gpt-5*` / `o*` **no envía `temperature`** (regex `MODELS_SIN_TEMPERATURE`).
  - Para `gpt-5*` envía `reasoning.effort` (default `'minimal'`).
  - Devuelve `{ rawText, usage, raw }`, robusteciendo la extracción de `output_text`.
- [`parse-json.js`](src/llm/parse-json.js): limpia fences de markdown y extrae JSON.
  - `parseLlmJsonObject(text)` → objeto (si recibe array, toma el primer elemento).
  - `parseLlmJson(text)` → **siempre array** (envuelve objetos sueltos en `[obj]`).

### Prompts — [`src/prompt/`](src/prompt/)

- [`criterios/`](src/prompt/criterios/) — **los prompts de los 6 criterios** + el registro
  que el Step 2 recorre.
  - `_base.js`: `ROL_BASE`, `REGLAS_COMUNES` (reglas de negocio institucionales compartidas),
    bloques de entrada (`bloqueEntradas`, `bloqueConsideraciones`, `bloqueRelacionados`) y
    `formatoSalidaComun()` (contrato JSON común).
  - `c1-…` a `c6-…`: cada uno exporta `NOMBRE`, `SYSTEM_PROMPT` y `buildPrompt(args)`.
  - `index.js`: `CRITERIOS` (registro con `aplicaA` y `build`), `TIPOS`, `normalizeTipo()`,
    `planCriterios(tipo)` (devuelve los 6 con un flag `aplica`).
- `propmt-convertir-requerimientos-json`: `SYSTEM_PROMPT` de **extractor**; pide JSON
  `{ nombre_requerimiento, tipo, requerimientos_relacionados[], consideraciones[] }`.
- `propmt-analizar-requerimientos`: **LEGADO** — auditor de un solo criterio/lineamiento.
  Reemplazado por `criterios/`; se conserva como referencia de reglas. (Typo `propmt` histórico.)

---

## 4. Mapa de carpetas de datos (`PATHS`)

Todas relativas a la raíz del repo (`ROOT`), bajo `data/`.

| Clave `PATHS` | Ruta | Propósito |
|---|---|---|
| `sinProcesar.requerimientos` | `data/data-sin-procesar/requerimientos` | **Entrada:** requerimientos crudos (un archivo por requerimiento). |
| `sinProcesar.lineamientos` | `data/data-sin-procesar/lineamientos_requerimiento` | **Entrada:** subcarpetas por requerimiento, cada una con sus lineamientos crudos. |
| `mutable.requerimientos` | `data/mutable/requerimientos` | Salida Markdown de requerimientos (regenerable). |
| `mutable.lineamientos` | `data/mutable/lineamientos` | Salida Markdown de lineamientos, en `req_<codigo>/` (regenerable). |
| `mutable.requerimientosJson` | `data/mutable/requerimientos-json` | Fichas JSON `<codigo>.json` (generadas por LLM). |
| `inmutableHallazgos` | `data/inmutable/lineamiento-hallazgo` | Excel de hallazgos por requerimiento (`<codigo>/<codigo>.xlsx`). |
| `inmutableConsolidado` | `data/inmutable/consolidado` | `consolidado.xlsx` final. |
| `matriz` | `data/matriz-lineamientos` | Matrices de inventario de Steps 3 y 4. |
| `logs` | `logs/` | (Reservado.) |

> **Convención `mutable` vs `inmutable`:** lo `mutable` se **regenera** (Step 0 hace
> `cleanDir`, borrando lo anterior); lo `inmutable` son los entregables de auditoría que no se
> recrean desde cero por los conversores.

---

## 5. Los pasos en detalle

### Step 0 — Convertir a Markdown — [`src/steps/0-convertir-a-markdown/`](src/steps/0-convertir-a-markdown/index.js)

- **Entrada:** `data-sin-procesar/requerimientos` y `.../lineamientos_requerimiento`.
- **Salida:** Markdown en `mutable/requerimientos` y `mutable/lineamientos/req_<codigo>`.
- **Sin LLM.** Hace `cleanDir` de las carpetas de salida antes de generar.
- **Flag:** `--solo=requerimientos | lineamientos | plan`.
- Sub-conversores:
  - `convertir-requerimiento.js`: infiere el **código** del nombre de archivo con la regex
    `(\d+(?:\.\d+){0,5})`; construye el `.md` con `buildRequerimientoMd`.
  - `convertir-lineamiento.js`: recorre subcarpetas por requerimiento; usa
    `codigoFromReqFolder` / `reqFolderName`; el `id` del lineamiento es el nombre del archivo.
  - `convertir-plan.js`: **no-op** (placeholder; pendiente definir la fuente).

> ⚠️ **Quirk importante:** sin `--solo`, Step 0 ejecuta **lineamientos + plan pero NO
> requerimientos** (la condición de requerimientos es `solo === 'requerimientos'`). Para
> convertir requerimientos usa `npm run generar:requerimientos`
> (`step:0 --solo=requerimientos`). El comando `pipeline` llama `runStep0(flags)` sin `solo`,
> así que **no** reconvierte requerimientos por defecto.

### generate:formato_json_ficha_requerimientos — [`src/steps/generar-json-requerimientos/`](src/steps/generar-json-requerimientos/index.js)

- **Entrada:** requerimientos crudos (`sinProcesar.requerimientos`).
- **Salida:** `mutable/requerimientos-json/<codigo>.json` con `{ nombre_requerimiento, tipo,
  requerimientos_relacionados[], consideraciones[] }`.
- **LLM:** `gpt-5.4` con `reasoning_effort: high` (constantes `MODEL`/`REASONING_EFFORT`). Las
  fichas son PDF a 2 columnas con texto desordenado: reconstruir y extraer TODAS las
  consideraciones requiere el modelo full + razonamiento alto (nano/mini sub-extraen). Usa `buildPromptConvertirRequerimientosJson`
  + `parseLlmJsonObject`. `normalizeFicha` limpia y valida: **`tipo`** (default `lineamiento`
  vía `normalizeTipo`) y **`requerimientos_relacionados`** (array).
- **Flags:** `--dry-run` (no llama al LLM; produce ficha vacía con `tipo=lineamiento`) y `--solo=<codigo>`.

> ⚠️ `--dry-run` **sobrescribe** las fichas con consideraciones/relacionados vacíos. No lo
> ejecutes sobre fichas reales ya extraídas.

### Step 1 — Validar fichas JSON — [`src/steps/1-validar-requerimientos/`](src/steps/1-validar-requerimientos/index.js)

- **Sin LLM.** Recorre `mutable/requerimientos-json/*.json` y valida:
  - JSON parseable; `nombre_requerimiento` presente; `consideraciones` es array (warn si vacío).
  - `tipo` ∈ `TIPOS` (warn si falta o es inválido); `requerimientos_relacionados` es array (error si no).
  - Warn si el requerimiento no tiene carpeta de lineamientos o está vacía.
- Devuelve `{ ok, errores, warnings }`. Falla (`ok:false`) solo si hay **errores**.

### Step 2 — Procesar requerimiento (multi-criterio) — [`src/steps/2-procesar-requerimiento/`](src/steps/2-procesar-requerimiento/index.js)

**Núcleo del proyecto.** Por cada ficha JSON (en **serie**):
1. Lee `nombre_requerimiento`, `tipo`, `consideraciones` y `requerimientos_relacionados`.
2. **Concatena TODOS** los lineamientos `.md` de `mutable/lineamientos/req_<codigo>` en un solo
   texto (separados por `### LINEAMIENTO: <id>`). Avisa en log si excede `AVISO_CHARS`.
3. `planCriterios(tipo)` decide los criterios aplicables. Para el Criterio 6 carga las fichas
   de los relacionados (`cargarRelacionados`).
4. Evalúa **los 6 criterios EN PARALELO** (`Promise.all` sobre `evaluarCriterio`): los
   aplicables llaman a `callOpenAI` (**`gpt-5.4-mini`**, `reasoning_effort medium`, **sin
   `max_output_tokens`** para no acotar la respuesta); los no aplicables producen una fila
   `No aplica`; en error → fila `Observación` (no aborta el resto).
   - **C1** parsea con `parseLlmJsonObject` → `rowsFromC1`: una fila por **(consideración ×
     lineamiento)** con `cumple_consideracion` + `literal` por lineamiento.
   - **C2-C6** parsean con `parseLlmJson` → `rowsFromGenerico`: una fila por hallazgo, con
     `lineamiento` = `lineamiento_afectado`.
5. Aplana a filas (esquema de `HALLAZGO_COLUMNS`, con `cell()` anti-`[object Object]`) y escribe
   **un** Excel por requerimiento (`inmutable/lineamiento-hallazgo/<codigo>/<codigo>.xlsx`).
- **Flags:** `--dry-run`, `--solo=<codigo>`, `--criterio=<id>` (depurar un solo criterio).

<details><summary>(Histórico) Lógica anterior de Step 2</summary>

Antes evaluaba **un lineamiento a la vez** con `buildPromptAnalizarRequerimientos`
(`gpt-5-mini`), una fila por consideración. Cubría solo el Criterio 1.</details>
### Step 3 — Excel por requerimiento (inventario) — [`src/steps/3-generar-excel-por-requerimiento/`](src/steps/3-generar-excel-por-requerimiento/index.js)

- **Sin LLM.** Por cada ficha JSON, lista sus lineamientos con un **preview** de 300 caracteres.
- **Salida:** `data/matriz-lineamientos/req_<codigo>.xlsx`. Columnas: Requerimiento, ID
  Lineamiento, Fuente, Contenido (preview).

### Step 4 — Matriz total de lineamientos (inventario) — [`src/steps/4-generar-matriz-total-lineamientos/`](src/steps/4-generar-matriz-total-lineamientos/index.js)

- **Sin LLM.** Una sola hoja con **todos** los lineamientos de todos los requerimientos
  (preview 300 chars).
- **Salida:** `data/matriz-lineamientos/matriz-total-lineamientos.xlsx`.

### Step 5 — Consolidar hallazgos (matriz por lineamiento) — [`src/steps/5-consolidar-hallazgos/`](src/steps/5-consolidar-hallazgos/index.js)

- **Sin LLM.** Lee todos los Excel de `inmutable/lineamiento-hallazgo/*/*.xlsx`
  (`readHallazgosExcel`) y construye **una sola hoja `consolidado`** con escritor propio
  (`ExcelJS`, columnas dinámicas):
  - Columna **`literal`** (común): cita textual de dónde se cumple el criterio. En C1 concatena
    `"<lineamiento>: <cita>"` de los lineamientos que cumplen (`literalC1`); en 2-6 es la cita
    del hallazgo.
  - **Información completa** (filas con `consideracion_evaluada`): se **pivotea** en una matriz
    `consideración × lineamiento`. Por cada slot `k`: columnas `lineamiento_k` (id) y
    `resultado_k` (`"si"`/`"no"`, vía `cumpleCell`). `estado` = Cumple si **algún** lineamiento
    cumple. Nº de columnas = máximo de lineamientos de cualquier requerimiento.
  - **Criterios 2-6** (y hallazgos generales de C1): una **fila por hallazgo**, con
    `lineamiento_afectado` y las columnas de matriz vacías.
- Ordenado por `n_req` y orden de criterio (1→6, vía `CRITERIOS`).
- **Salida:** `data/inmutable/consolidado/consolidado.xlsx`.

---

## 6. Cómo ejecutarlo (operativo)

### Requisitos

- **Node.js ≥ 20** (usa `--env-file`, que requiere Node 20+).
- Una clave de API de OpenAI (solo para los pasos que usan LLM).

### Instalación

```bash
npm install         # o: pnpm install  (existe pnpm-lock.yaml)
```

### Configurar `.env`

Crea un `.env` en la raíz (ver `.env.example`):

```
OPENAI_API_KEY=sk-...
```

Los scripts que llaman al LLM ya pasan `--env-file=.env`. Solo **Step 2**, **generate** y
**pipeline** lo necesitan; Steps 0/1/3/4/5 **no** requieren clave.

### Preparar los datos de entrada

1. Coloca los **requerimientos** crudos en `data/data-sin-procesar/requerimientos/`
   (un archivo por requerimiento; el código se infiere del nombre, ej. `5.3.1.14 ....pdf`).
2. Coloca los **lineamientos** en subcarpetas por requerimiento dentro de
   `data/data-sin-procesar/lineamientos_requerimiento/` (ej. `req_5.3.1.14/` o `5.3.1.14/`;
   el prefijo `req_` se normaliza).

### Scripts disponibles ([`package.json`](package.json))

| Script | Comando | Usa LLM |
|---|---|---|
| `npm run generar:requerimientos` | `step:0 --solo=requerimientos` | No |
| `npm run generar:lineamientos` | `step:0 --solo=lineamientos` | No |
| `npm run step:0` | Step 0 (¡sin requerimientos! ver quirk §5) | No |
| `npm run generate:formato_json_ficha_requerimientos` | Genera fichas JSON | **Sí** |
| `npm run step:1` | Validación | No |
| `npm run step:2` / `npm run analizar:requerimiento` | Auditoría | **Sí** |
| `npm run step:3` | Excel por requerimiento | No |
| `npm run step:4` | Matriz total | No |
| `npm run step:5` | Consolidado | No |
| `npm run pipeline` | Todo en orden | **Sí** |

### Orden recomendado (manual)

```bash
npm run generar:requerimientos      # Markdown de requerimientos
npm run generar:lineamientos        # Markdown de lineamientos
npm run generate:formato_json_ficha_requerimientos   # fichas JSON (LLM)
npm run step:1                       # validar
npm run step:2                       # auditar (LLM)
npm run step:5                       # consolidar
# (step:3 y step:4 son inventarios opcionales)
```

### Flags útiles

- `--dry-run`: en `generate` y `step:2`, **no llama al LLM** (genera fichas/hallazgos de
  prueba). Ideal para validar el flujo sin gastar tokens.
- `--solo=<codigo>`: procesa un único requerimiento (ej.
  `node --env-file=.env src/index.js step:2 --solo=5.3.1.14`).

---

## 7. Contrato de los LLM

Llamadas LLM con su system prompt y su JSON esperado:

### a) Extractor de ficha — `generate` (`gpt-5.4`, `reasoning_effort high`)

```json
{
  "nombre_requerimiento": "5.3.1.14 La universidad cuenta con lineamientos para ...",
  "tipo": "lineamiento | plan | informe | reporte",
  "requerimientos_relacionados": ["2.5.3.4", "2.5.3.5"],
  "consideraciones": ["Texto de la consideración 1", "Texto de la consideración 2"]
}
```

Parseado con `parseLlmJsonObject` y saneado por `normalizeFicha` (`tipo` vía `normalizeTipo`).

### b) Criterios — `step:2` (`gpt-5.4-mini`, `reasoning_effort medium`, sin cap de tokens), **una llamada por criterio aplicable**

**Criterio 1 (Información completa)** devuelve un **objeto** (matriz consideración × lineamiento +
hallazgos generales), parseado con `parseLlmJsonObject`:

```json
{
  "consideraciones": [
    {
      "consideracion": "Texto de la consideración",
      "por_lineamiento": [
        { "lineamiento": "<id exacto>", "cumple": "si | no",
          "literal": "cita textual donde se cumple | N/A",
          "observacion": "motivo si no | N/A" }
      ]
    }
  ],
  "hallazgos_generales": [
    { "tipo_hallazgo": "Observación|…", "criterio_afectado": "Codificación/Versión|…",
      "lineamiento_afectado": "<id>|N/A", "razonamiento_previo": "…",
      "hallazgo": "…", "observacion": "…", "literal": "…" }
  ]
}
```

**Criterios 2-6** devuelven un **array de hallazgos** (atomicidad), parseado con `parseLlmJson`:

```json
[
  {
    "criterio": "Coherencia",
    "estado": "Cumple | No cumple",
    "tipo_hallazgo": "Observación | Oportunidad de mejora | Cumple",
    "criterio_afectado": "Subclasificación o N/A",
    "lineamiento_afectado": "<id del lineamiento que origina el hallazgo> | N/A",
    "razonamiento_previo": "análisis del CONJUNTO de lineamientos…",
    "hallazgo": "Título + descripción… | N/A",
    "observacion": "… | N/A",
    "literal": "cita textual de respaldo | N/A",
    "integracion": "(solo C6) Integrado | Parcial | No Integrado",
    "requerimientos_relacionados": ["(solo C6) códigos considerados"]
  }
]
```

> El Step 2 aplana ambas formas a la fila plana de `HALLAZGO_COLUMNS`
> ([`excel.helper.js`](src/helpers/excel.helper.js)): C1 produce **una fila por
> (consideración × lineamiento)** (campo `lineamiento` = el evaluado); 2-6 producen **una fila por
> hallazgo** (`lineamiento` = el afectado). La función `cell()` evita `[object Object]` si el
> modelo devuelve objetos anidados.

**Manejo de errores:** si un criterio falla o devuelve algo no parseable, Step 2 genera una
fila `Observación` con el detalle del error y continúa con los demás criterios (no aborta).

**Modelos (dónde cambiarlos):** constante `MODEL` en cada step
([`generar-json`](src/steps/generar-json-requerimientos/index.js), [`step:2`](src/steps/2-procesar-requerimiento/index.js))
y el default de `callOpenAI` ([`openai.client.js`](src/llm/openai.client.js)).

---

## 8. Guía para construir nuevas funcionalidades

> Patrón general del proyecto: cada step es un módulo que **exporta una función `async`** que
> recibe `flags`, usa `PATHS` para I/O, registra con `logger`, y devuelve un objeto resumen.
> Reutiliza los helpers existentes (`fs.helper`, `excel.helper`, `markdown.helper`, parsers,
> `callOpenAI`) antes de escribir código nuevo.

### (a) Añadir un nuevo paso al pipeline

1. Crea `src/steps/N-mi-paso/index.js` exportando `export async function runStepN(flags = {})`.
   Empieza con `logger.step('STEP N — ...')`, lee/escribe vía `PATHS` y helpers.
2. En [`src/index.js`](src/index.js):
   - Importa `runStepN`.
   - Regístralo en el mapa `STEPS` (`'step:N': runStepN`) o en `COMMANDS` si es un comando con
     nombre propio.
   - Añádelo a `runPipeline` en la posición correcta del orden.
3. En [`package.json`](package.json) agrega un script
   (`"step:N": "node src/index.js step:N"`; añade `--env-file=.env` solo si usa LLM).
4. Si necesita una carpeta de datos nueva, decláralala en `PATHS`
   ([`config/paths.js`](src/config/paths.js)).

### (b) Soportar un nuevo formato / parser

1. Crea `src/helpers/parsers/parseXxx.js` que exporte una función `async (file) => ({ text,
   meta })`. `text` es el contenido plano que verá el resto del pipeline; `meta` es opcional.
2. En [`parsers/index.js`](src/helpers/parsers/index.js):
   - Importa el parser y añade los `case` de extensión en `parseAny`.
   - Añade la(s) extensión(es) a `SUPPORTED_EXTS` (así Step 0, generate y los demás los
     detectan en sus globs `**/*<ext>`).
3. Reutiliza `readFileText` / `readFileBuffer` de `fs.helper` para leer el archivo.

### (c) Ajustar prompts, criterios o modelos del LLM

1. **Reglas/criterios de auditoría:** edita el `SYSTEM_PROMPT` del criterio en
   [`src/prompt/criterios/`](src/prompt/criterios/) (`c1-…` a `c6-…`). Las reglas de negocio
   comunes están en [`_base.js`](src/prompt/criterios/_base.js) (`REGLAS_COMUNES`).
2. **Extractor de ficha:** edita [`propmt-convertir-requerimientos-json/template.js`](src/prompt/propmt-convertir-requerimientos-json/template.js).
3. **Datos de entrada al prompt:** ajusta `buildPrompt(...)` del criterio (usa los `bloque*` de
   `_base.js`).
4. **Modelo:** cambia la constante `MODEL` del step correspondiente.
5. **Si cambias el JSON de salida:** mantén sincronizados ① el parser
   (`parseLlmJson`/`parseLlmJsonObject`), ② el mapeo a filas (`normalizeRow` en Step 2 /
   `normalizeFicha` en `generate`) y ③ las columnas Excel (§8e). Es el error más fácil de introducir.

### (d) Añadir o cambiar la aplicabilidad de un criterio

1. **Nuevo criterio:** crea `src/prompt/criterios/cN-mi-criterio.js` (exporta `NOMBRE`,
   `SYSTEM_PROMPT`, `buildPrompt`) reutilizando `_base.js`; regístralo en
   [`criterios/index.js`](src/prompt/criterios/index.js) (`CRITERIOS`) con su `aplicaA`.
2. **Cambiar qué tipos evalúa un criterio:** edita `aplicaA` del criterio en el registro.
3. **Nuevo tipo de requerimiento:** añádelo a `TIPOS` y a las reglas del extractor
   (`propmt-convertir-requerimientos-json/template.js`), y ajusta los `aplicaA`.
4. Si el criterio aporta campos nuevos a la salida, añádelos al esquema Excel (§8e) y a
   `normalizeRow` en [`step:2`](src/steps/2-procesar-requerimiento/index.js).

### (e) Cambiar columnas o salidas Excel

1. **Hallazgos (Steps 2 y 5):** edita `HALLAZGO_COLUMNS` en
   [`excel.helper.js`](src/helpers/excel.helper.js). Afecta a la **vez** a `writeHallazgosExcel`
   y `readHallazgosExcel` (comparten `HALLAZGO_KEYS`), así que Step 2 (escribe) y Step 5 (lee)
   quedan consistentes. Si la columna es de texto largo, añádela a `MULTILINE_KEYS`.
2. Actualiza `rowsFromC1` / `rowsFromGenerico` / `filaBase` (y las filas sintéticas
   `filaNoAplica`/`filaError`) en [`step:2`](src/steps/2-procesar-requerimiento/index.js) para
   rellenar la columna nueva.
3. **Consolidado (Step 5):** tiene escritor propio con columnas dinámicas
   (`buildColumns`, `matrizGroupToRow`, `hallazgoToRow`) en
   [`5-consolidar-hallazgos/index.js`](src/steps/5-consolidar-hallazgos/index.js); ajústalos si
   cambias la matriz o las columnas de hallazgo.
4. **Reportes nuevos:** para un Excel totalmente nuevo, crea un step (§8a) que use `ExcelJS`
   directamente (como Steps 3/4/5) o un helper análogo a `writeHallazgosExcel`.

---

## 9. Convenciones y "quirks" a tener en cuenta

- **Inferencia de código:** regex `(\d+(?:\.\d+){0,5})` sobre el nombre de archivo; si no hay
  match se usa el nombre base. Nombra los archivos de entrada con el código al inicio.
- **Prefijo `req_`:** las carpetas de lineamientos usan `req_<codigo>`; conviértelas con
  `reqFolderName` / `codigoFromReqFolder`, no a mano.
- **Step 0 regenera (`cleanDir`):** borra y recrea las carpetas `mutable/...` de salida. No
  guardes ahí nada editado a mano.
- **Step 0 sin `--solo` NO convierte requerimientos** (ver §5). Usa los scripts dedicados.
- **Step 2 analiza el CONJUNTO de lineamientos** por requerimiento (no uno por uno) y corre los
  6 criterios aplicables **en paralelo**; los requerimientos se procesan en **serie**.
- **Criterios condicionales:** la matriz `tipo → criterios` está en `CRITERIOS[].aplicaA`
  ([`criterios/index.js`](src/prompt/criterios/index.js)). El `tipo` lo pone el LLM en `generate`;
  si falta, `normalizeTipo` usa `lineamiento`.
- **Criterio 1 es matriz por lineamiento:** evalúa cada consideración contra CADA lineamiento;
  el consolidado lo muestra con columnas `lineamiento_k`/`resultado_k` lado a lado. La columna
  `literal` cita el texto exacto de la evidencia donde se cumple.
- **`[object Object]` viene del Excel fuente:** `parseXlsx.js` usa `cellToString` para manejar
  celdas richText/fórmula/hipervínculo/fecha; sin eso, los `.md` de lineamientos los mostraban
  como `[object Object]`. En el LLM, `cell()` ([step:2](src/steps/2-procesar-requerimiento/index.js))
  hace la misma defensa.
- **`pdf-parse`** se importa desde `pdf-parse/lib/pdf-parse.js` (evita el harness de debug del
  paquete). Mantén esa ruta de import.
- **Typo `propmt`:** la carpeta `propmt-convertir-requerimientos-json` conserva el typo; la nueva
  carpeta de criterios sí se llama `criterios/`. `propmt-analizar-requerimientos` es legado.
- **Modelos `gpt-5.x` (razonamiento):** NO aceptan `temperature` y usan `reasoning.effort`
  (`low|medium|high|xhigh`; **no** `minimal`). Lo maneja `callOpenAI` (default `medium`). Para
  "no acotar" la respuesta, **no** se pasa `max_output_tokens` (el modelo da hasta 128k).
  Modelos actuales: `gpt-5.4` (fichas, `high`), `gpt-5.4-mini` (análisis, `medium`).
- **Reintentos:** `callOpenAI` reintenta (hasta 3, backoff) ante errores transitorios
  (conexión, rate limit, 5xx); las llamadas largas de C1 (matriz) los provocan ocasionalmente.
- **Extracción de fichas:** el texto del PDF viene desordenado (2 columnas); el prompt indica
  reconstruir, extraer verbatim y **excluir la lista de EVIDENCIAS SUGERIDAS** (pero conservar
  condiciones obligatorias como aprobación y alcance).
- **Convención de retorno:** los steps devuelven objetos resumen (`{ ok, generados, ... }`)
  para encadenarse y para tests.

---

## 10. Verificación

Tras un cambio, valida el flujo de forma barata y luego completa:

1. **Smoke test sin tokens** (no ejecutes `generate --dry-run` si ya tienes fichas reales, las
   sobrescribe):
   ```bash
   npm run step:1                              # valida fichas (avisa si falta tipo)
   node src/index.js step:2 --dry-run          # genera Excel multi-criterio sin LLM
   npm run step:5                              # consolida en una hoja de detalle
   ```
   Revisa el Excel por requerimiento: una hoja con columna `criterio`, las 6 con `No aplica`
   donde corresponda. Para inspeccionar el consolidado por consola:
   ```bash
   node --input-type=module -e "import { readHallazgosExcel, HALLAZGO_KEYS } from './src/helpers/excel.helper.js'; const r = await readHallazgosExcel('data/inmutable/consolidado/consolidado.xlsx'); console.log(HALLAZGO_KEYS.join(' | ')); console.log('filas:', r.length);"
   ```

2. **Prueba real condicional (con `.env`):**
   ```bash
   node --env-file=.env src/index.js generate:formato_json_ficha_requerimientos --solo=<codigo>
   node --env-file=.env src/index.js step:2 --solo=<codigo>
   ```
   - Tipo `lineamiento` (ej. `5.3.1.14`) → criterios 1, 2, 3, **6** (verifica `integracion` +
     `requerimientos_relacionados`).
   - Tipo `plan` (ej. `5.4.2.8`) → criterios 1, 2, 3, **4**; criterios 5 y 6 deben salir `No aplica`.
   - Para depurar un solo criterio: `step:2 --solo=<codigo> --criterio=6`.

3. **Pipeline completo:** `npm run pipeline` (consume tokens de OpenAI).

4. Si tocaste columnas/JSON: verifica que **Step 2 escribe** y **Step 5 lee** las mismas
   claves (un desajuste se manifiesta como columnas vacías en el consolidado).
