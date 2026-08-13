# Step 2 — Procesar Requerimiento (LLM)

## Objetivo
Por cada requerimiento y cada uno de sus lineamientos asociados, invocar al modelo `gpt-5-mini` de OpenAI con el prompt de auditoría y consolidar los hallazgos en un Excel.

## Modelo y credenciales
- Modelo: `gpt-5-mini` (Responses API).
- API key: `OPENAI_API_KEY` (ver `.env.example`).
- Carga del `.env`: vía flag nativo de Node 20 `--env-file=.env` (ya configurado en `package.json`).

## Entrada
- `data/mutable/requerimientos/<codigo>/<codigo>.md`
- `data/mutable/lineamientos/req_<codigo>/*.md`

## Estrategia de llamadas
- **1 llamada por par (requerimiento × lineamiento).** Si un requerimiento tiene N lineamientos, se realizan N llamadas.
- En cada llamada se envía `lineamiento_1` = lineamiento actual. Los campos `lineamiento_2` y `lineamiento_3` quedan en `null` por convención de esta estrategia.

## Prompt
Encapsulado en `src/prompt/propmt-analizar-requerimientos/`. El caller solo provee:
```js
buildPromptAnalizarRequerimientos({ n_req, requerimiento, lineamiento })
```
y recibe `{ system, user }` listos para `callOpenAI`.

## Salida
`data/inmutable/lineamiento-hallazgo/<codigo>/<codigo>.xlsx` con las 9 columnas canónicas del JSON del prompt:

| Columna | Descripción |
| --- | --- |
| `n_req` | Código del requerimiento |
| `requerimiento` | Texto del requerimiento |
| `lineamiento_1` | Texto del lineamiento analizado |
| `lineamiento_2` | `null` |
| `lineamiento_3` | `null` |
| `razonamiento_previo` | Análisis del LLM |
| `tipo_hallazgo` | `Observación` \| `Oportunidad de mejora` \| `Cumple` |
| `criterio_afectado` | Inconsistencia Lógica \| Coherencia Literal \| Validación Matemática \| Completitud \| Vigencia Terminológica \| N/A |
| `hallazgo` | Título + descripción detallada |

## Flags
- `--solo=<codigo>` — procesa un único requerimiento (ej. `--solo=5.3.1.14`).
- `--dry-run` — no llama al LLM; genera filas placeholder para validar el pipeline.

## Manejo de errores
Si una llamada al LLM falla (timeout, JSON inválido, etc.), se registra el error y se inserta una fila con `tipo_hallazgo: Observación` indicando el error, **sin abortar** el resto del batch.

## Comando
```bash
npm run step:2
npm run step:2 -- --solo=5.3.1.14
npm run step:2 -- --dry-run
```
