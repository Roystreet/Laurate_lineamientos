# Proyecto DACI — Lineamientos

## Plataforma documental

La plataforma permite cargar una ficha por archivo, asociar evidencias, preparar documentos con OCR y analizar hasta diez requerimientos por ejecución. Las cuatro pantallas del flujo son **Requerimientos**, **Evidencias**, **Análisis** y **Resultados**; la sección **Config IA** permite mejorar el análisis con reglas versionadas. El catálogo conserva versiones para reutilizar las fichas en nuevos análisis.

Utiliza React/Vite/TypeScript, Fastify, un worker Node.js y MySQL 8.4. No incorpora usuarios, roles, sesiones, instituciones, evaluaciones administrativas ni copias de seguridad.

### Iniciar con Docker

La configuración está en `proyecto/.env`. Conservar la `OPENAI_API_KEY` existente. Los parámetros y sus valores iniciales están en [.env.example](.env.example); no copiar ese archivo sobre un `.env` configurado. `MYSQL_PASSWORD` y `MYSQL_ROOT_PASSWORD` deben tener valores propios.

Desde esta carpeta:

```bash
docker compose -p laureate-docs up -d --build
```

Abrir **http://localhost:8008**. Las migraciones se ejecutan al iniciar. MySQL utiliza un volumen persistente; los originales, páginas renderizadas, Markdown y Excel se guardan en `storage/`, fuera de la imagen. `.env` también queda fuera de la imagen.

```bash
docker compose -p laureate-docs logs --tail=80 app
docker compose -p laureate-docs down
```

`down` conserva los datos. No se configura ninguna tarea de respaldo.

El despliegue remoto utiliza [compose.gcp.yaml](compose.gcp.yaml). La ubicación, el acceso HTTPS y los comandos de operación están documentados en [deploy/matriz-gcp.md](deploy/matriz-gcp.md).

Para importar el material existente del repositorio en un catálogo **vacío**, usar Node.js 24 y pnpm:

```bash
pnpm install --frozen-lockfile
pnpm data:import
```

La importación registra las tres fichas y nueve evidencias existentes, conserva los Excel entregados y no llama a OpenAI. Una ejecución histórica se identifica internamente como tal: los modelos y parámetros originales no se atribuyen si no están acreditados. No sobrescribe un catálogo que ya tiene datos.

### Desarrollo local

```bash
docker compose -p laureate-docs up -d mysql --wait
pnpm install --frozen-lockfile
pnpm dev
```

La interfaz de desarrollo abre en http://localhost:5173 y envía sus solicitudes a la API en el puerto 8008. Para OCR local se necesita Poppler (`brew install poppler` en macOS); Docker ya lo incluye. Para servir la interfaz compilada:

```bash
pnpm build
pnpm start
```

Detener la aplicación de Docker antes de iniciar la API local en el mismo puerto.

### Uso

1. **Requerimientos:** subir una ficha por archivo y confirmar el número que aparece en ella. La carga continúa directamente a las evidencias de ese requerimiento. El catálogo permite buscar, paginar y usar **Agregar evidencias** desde cada fila.
2. **Evidencias:** el número seleccionado queda visible junto a la ficha. Cargar documentos con su **ID del lineamiento**, o usar **Relacionar documento existente** para reutilizar una evidencia preparada. Cada relación es independiente: retirarla de un requerimiento no la retira de otro. Reemplazar un documento genera una nueva versión y conserva los análisis anteriores. **Continuar al análisis** preselecciona el requerimiento actual.
3. **Análisis:** buscar y filtrar por preparación, recorrer páginas de 5, 10 o 20 filas y seleccionar hasta diez requerimientos. La selección se conserva entre páginas; **Seleccionar esta página** agrega las filas preparadas sin superar el límite. **Ver análisis** abre el detalle del último análisis de ese requerimiento. La pantalla no incluye seguimiento general.
4. **Resultados:** abrir el detalle de un requerimiento para consultar sus seis criterios y descargar las versiones exactas de las evidencias analizadas. Consultar hallazgos y la matriz de consideraciones, filtrar y descargar los Excel. Una ejecución parcial se indica en pantalla; el reintento de los criterios fallidos está en el detalle correspondiente.

El tour aparece en la primera visita y explica las cuatro pantallas. **Reiniciar tour** lo vuelve a abrir desde el principio; puede omitirse o cerrarse con Escape. Solo se guarda una marca de finalización en el navegador. La interfaz usa el nombre **Análisis documental** y describe la lectura automática en lenguaje cotidiano.

Se admiten PDF, DOCX, TXT, Markdown, JSON, XLSX/XLSM, PNG y JPG/JPEG. El piloto no separa varias fichas dentro de un archivo, no clasifica documentos automáticamente y no permite editar hallazgos.

### Config IA

Config IA ajusta cómo analiza la IA sin tocar código. El texto base de los prompts (`src/prompt/**`) no cambia; las **reglas** activas de cada criterio se agregan al final de su prompt bajo el encabezado `REGLAS ADICIONALES (OBLIGATORIAS)`. Sin reglas aplicables, el prompt es idéntico al original.

- **Versiones:** cada conjunto de reglas publicado es una versión inmutable (`v1` = sin reglas). Producción es la versión de mayor número. Cada análisis registra la versión con la que se hizo; Resultados muestra "Analizado con vN" o "Anterior a Config IA".
- **Solicitudes:** quien ve un resultado incorrecto crea una solicitud ligada a ese hallazgo (o a "falta un hallazgo" en un criterio). Se guarda una copia de la fila. Cada solicitud tiene su borrador de cambios sobre producción.
- **Playground:** compara producción (o una versión anterior) contra el borrador, en el caso de origen y en requerimientos de control elegidos. Usa las entradas congeladas del análisis original y reutiliza el resultado guardado solo si coinciden reglas, código del motor y modelo. Las pruebas se encolan con prioridad 40 y esperan su turno: se procesan cuando no hay lotes en curso y no bloquean nuevos análisis. No generan Excel ni aparecen en Resultados.
- **Publicar:** requiere que la última prueba no exploratoria esté marcada "Funcionó", se haya hecho sobre la producción vigente y con exactamente las reglas a publicar. Al publicar, los demás borradores pasan a la nueva base y deben volver a probarse. **Volver a una versión** la republica como versión nueva, con nombre y motivo.
- Sin usuarios: el nombre se escribe a mano y se recuerda en el navegador.

Diseño y plan: [docs/superpowers/specs/2026-11-12-config-ia-design.md](docs/superpowers/specs/2026-11-12-config-ia-design.md), [docs/superpowers/plans/2026-11-12-config-ia.md](docs/superpowers/plans/2026-11-12-config-ia.md).

### Configuración y OCR

[src/config/runtime.js](src/config/runtime.js) centraliza y valida los parámetros para API, worker y CLI. Cambiar `.env` requiere reiniciar los procesos; en Docker ejecutar `docker compose -p laureate-docs up -d --force-recreate app`.

| Parámetros | Valores iniciales |
|---|---|
| `FICHA_MODEL`, `FICHA_REASONING_EFFORT` | `gpt-5.4`, `high` |
| `ANALISIS_MODEL`, `ANALISIS_REASONING_EFFORT` | `gpt-5.4-mini`, `medium` |
| `OCR_MODEL`, `OCR_REASONING_EFFORT` | `gpt-5.4-mini`, `medium` |
| `SUGERENCIA_MODEL`, `SUGERENCIA_REASONING_EFFORT` | `gpt-5.4`, `medium` (regla sugerida por IA en Config IA) |
| `OCR_MODE`, `OCR_IMAGE_DETAIL` | `auto`, `original` |
| `OCR_DPI`, `OCR_MIN_TEXT_CHARS` | `200`, `40` |
| `OPENAI_TIMEOUT_MS`, `OPENAI_MAX_ATTEMPTS` | `900000`, `3` |
| `UPLOAD_MAX_FILE_MB`, `UPLOAD_MAX_FILES` | `50`, `20` |
| `MYSQL_HOST`, `MYSQL_PORT` | `127.0.0.1`, `3307` para desarrollo; `mysql`, `3306` dentro de Docker |
| `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` | Conexión a MySQL definida en `.env` |
| `API_HOST`, `API_PORT`, `STORAGE_DIR` | `127.0.0.1`, `8008`, `storage` para desarrollo |

`OCR_MODE` admite `auto`, `always` y `off`. En automático, los PDF conservan su extracción nativa y solo se transcriben las páginas con menos de 40 caracteres útiles. PNG/JPG pasan por OCR. En la interfaz, **Volver a leer documento** fuerza una nueva versión de extracción; no modifica transcripciones anteriores.

El OCR tiene un prompt separado, limitado a transcribir texto, numerales, tablas y pies de página, marcando `[ILEGIBLE]` cuando corresponde. Las páginas vacías, ilegibles y con fallos técnicos tienen estados distintos. Un fallo deja el documento pendiente de reintento y bloquea su uso en un análisis. Reintentar reutiliza las páginas de esa versión ya completadas.

La skill `laureate-configuracion` está instalada en el directorio de skills de Codex. Guía los cambios permitidos en `.env`, sus verificaciones y la conservación de prompts y reportes. La aplicación utiliza el módulo de configuración directamente y no depende de la skill para funcionar. No hay pantalla de configuración ni se muestran claves.

### Motor, persistencia y reportes

Los archivos existentes de `src/prompt/` permanecen intactos. La CLI sigue disponible con la misma lógica de extracción y los seis criterios. Los exportadores originales reciben las filas guardadas del motor; SQL no reconstruye las reglas de los reportes.

Se conservan los archivos `<codigo>.xlsx` (hoja `hallazgos`), `consolidado.xlsx` (hoja `consolidado`), `req_<codigo>.xlsx` y `matriz-total-lineamientos.xlsx`: campos, orden, formatos, valores por defecto, preview de 300 caracteres y rutas lógicas de `Fuente`. El consolidado mantiene la agrupación C1 por consideración, el orden y tratamiento de repeticiones, cumplimiento cuando alguna evidencia responde `si`, citas y observaciones por documento, filas individuales de C2–C6, pares dinámicos y normalización a `NO APLICA`. Los datos técnicos no se agregan a los Excel.

[src/platform/schema.sql](src/platform/schema.sql) define las tablas MySQL con InnoDB, `utf8mb4` y JSON:

| Grupo | Tablas |
|---|---|
| Fichas y catálogo | `requerimientos`, `versiones_requerimiento`, `consideraciones`, `relaciones_requerimiento` |
| Documentos | `documentos`, `versiones_documento`, `paginas_documento`, `requerimiento_evidencias` |
| Ejecución y cola | `versiones_motor`, `ejecuciones`, `entradas_ejecucion`, `tareas_procesamiento`, `coordinacion` |
| Resultados y trazas | `llamadas_llm`, `resultados_criterio`, `evaluaciones_consideracion`, `hallazgos`, `reportes` |
| Config IA | `ia_versiones`, `ia_reglas`, `ia_reglas_historial`, `ia_solicitudes`, `ia_solicitud_eventos`, `ia_pruebas`, `ia_pruebas_resultados`; `ejecuciones.reglas_version_id` |

Cada ejecución congela fichas, evidencias, catálogo relacionado, fuentes del motor y parámetros efectivos sin secretos. Las versiones originales siguen disponibles tras reemplazos. La cola reclama trabajos mediante transacciones y `FOR UPDATE SKIP LOCKED`, libera la transacción antes de llamar a OpenAI y renueva reservas de 60 segundos. Una reserva expirada permite recuperar el trabajo; el propietario anterior no puede confirmar resultados ni sustituir el archivo de un reporte vigente.

### API

Las operaciones de carga, análisis, OCR y reintento responden `202 Accepted` con identificadores. El progreso se consulta mediante las rutas de ejecución y documento.

| Método y ruta | Función |
|---|---|
| `GET /api/health`, `GET /api/config` | Estado y parámetros públicos |
| `GET /api/requirements` | Catálogo con fichas y estado de preparación |
| `GET /api/requirements/:id/documents` | Documentos asociados |
| `GET /api/evidence-library` | Evidencias preparadas disponibles para reutilizar |
| `POST /api/requirements/:id/evidences` | Relacionar evidencia existente con `{ "documentId": "id", "lineamiento": "ID" }`; responde `201` |
| `POST /api/uploads` | Multipart: `kind=ficha` y `code`, o `kind=evidencia` y `reqId`; archivos en `files`; `replaceId` opcional |
| `GET /api/documents/:id` | Texto, páginas, versiones y tareas |
| `GET /api/versions/:id` | Transcripción de una versión anterior |
| `GET /api/versions/:id/original` | Descargar el original de una versión anterior |
| `GET /api/documents/:id/original` | Descargar original |
| `POST /api/documents/:id/ocr` | Nueva versión con OCR forzado |
| `PATCH /api/documents/:id/association` | Activar/retirar asociación con `{ "active": true/false, "reqId": "id" }` |
| `POST /api/runs` | Iniciar con `{ "requirementIds": ["id"] }` |
| `GET /api/runs`, `GET /api/runs/:id` | Historial, progreso y filas originales |
| `GET /api/preparation` | Estado de preparación de documentos |
| `POST /api/tasks/:id/retry` | Reintentar una tarea fallida |
| `GET /api/reports/:id/download` | Descargar Excel |
| `GET /api/config-ia/versions`, `GET /api/config-ia/versions/:numero` | Versiones publicadas y sus reglas |
| `POST /api/config-ia/versions/:numero/republish` | Volver a una versión con `{ autor, motivo }`; responde `201` |
| `GET /api/config-ia/rules`, `GET /api/config-ia/rules/:codigo/history` | Reglas (`criterio`, `estado`, `q`) e historial |
| `GET /api/config-ia/cases?requirementId=` | Análisis de un requerimiento con sus filas por criterio |
| `GET`/`POST /api/config-ia/requests`, `GET /api/config-ia/requests/:id` | Solicitudes de mejora |
| `PUT /api/config-ia/requests/:id/draft` | Guardar borrador `{ autor, cambios }` |
| `POST /api/config-ia/requests/:id/reject`, `.../publish` | Rechazar o publicar |
| `POST /api/config-ia/tests`, `GET /api/config-ia/tests/:id` | Prueba del playground (`202`) y resultado lado a lado |
| `POST /api/config-ia/tests/:id/verdict` | Veredicto `funciono` / `no_funciono` |

### Verificación

```bash
pnpm config:check
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

`test` verifica hashes de prompts, contratos y contenido/formato de los Excel existentes (20, 18 y 61 filas; consolidado de 48), seis criterios, configuración, PDF digital y OCR mixto, vacíos, ilegibles y reintentos. Los inventarios usan el preview congelado del entregable como referencia, porque los Markdown locales fueron convertidos nuevamente después de su entrega.

`test:integration` crea y elimina una base MySQL aislada usando `MYSQL_ROOT_PASSWORD`; cubre cargas, fallos, versiones, insumos congelados, descargas, recuperación de reservas y relaciones compartidas independientes. No modifica el catálogo de la aplicación. `test:e2e` requiere la aplicación en el puerto 8008 con el material histórico importado y Chromium (`pnpm exec playwright install chromium`); verifica el flujo de las cuatro pantallas, detalle por requerimiento, tour y reinicio, selección entre páginas, carga vinculada a su número y vista móvil. Las cargas de sus pruebas de interfaz se simulan para no ejecutar análisis con OpenAI ni alterar el catálogo real.

```bash
pnpm test:openai
```

Esta prueba opcional hace llamadas reales con la clave existente: extrae una ficha, transcribe un PDF escaneado con cifras, tabla y pie de página, analiza los criterios aplicables y genera cuatro Excel. Utiliza otra base temporal y elimina sus datos al terminar. Fue ejecutada satisfactoriamente durante la implementación.

## Referencia de la CLI existente

Pipeline en Node.js (JavaScript puro, ESM) para procesar requerimientos y lineamientos crudos: convertirlos a Markdown estructurado, validarlos, analizarlos con LLM (OpenAI) y generar matrices Excel consolidadas.

## Requisitos
- Node.js >= 24
- npm (o pnpm)
- `OPENAI_API_KEY` en `.env` (requerida para `step:2` y `pipeline`).

## Instalación
```bash
npm install
# Configurar .env conservando la OPENAI_API_KEY existente
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
    2-procesar-requerimiento/              Análisis LLM (ANALISIS_MODEL) → hallazgos.xlsx por req
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
- [Config IA — diseño](docs/superpowers/specs/2026-11-12-config-ia-design.md) y [plan](docs/superpowers/plans/2026-11-12-config-ia.md)
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
