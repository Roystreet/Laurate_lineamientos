# Config IA — Regla sugerida por IA — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que al crear una solicitud en Config IA la IA redacte la regla a partir de lo que escribió el usuario, revise choques con reglas existentes, proponga ajustes y que el usuario apruebe al borrador con un clic; el resto del flujo (Playground, veredicto, publicación) no cambia.

**Architecture:** Lógica pura en `src/config-ia/` (armado del texto de la regla, validación de la respuesta de la IA, conversión de una aprobación a cambios del borrador, prompt de sugerencia), con pruebas unitarias. Persistencia y orquestación en `src/platform/config-ia/suggestions.js` sobre una tabla nueva `ia_sugerencias`; la API llama a OpenAI **directamente, fuera de la cola**, en segundo plano, y la interfaz consulta el estado. La interfaz agrega una tarjeta en el detalle de la solicitud.

**Tech Stack:** Node.js 24 ESM, Fastify 5, mysql2, MySQL 8.4, `node:test`, React 19 + Vite + TypeScript, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-23-config-ia-regla-sugerida-design.md` (extiende `docs/superpowers/specs/2026-11-12-config-ia-design.md`)

## Global Constraints

- Directorio de trabajo: `proyecto/`. La ruta contiene `:`; ejecutar herramientas por ruta: `node node_modules/typescript/bin/tsc --project web/tsconfig.json`, `node node_modules/vite/bin/vite.js build --config web/vite.config.ts`, `node node_modules/@playwright/test/cli.js test`.
- Unitarias: `node --test tests/*.test.js`. Integración: `docker compose -p laureate-docs up -d mysql --wait` y luego `node scripts/test-integration.js`. Nunca llamar a OpenAI en pruebas: `llm` falso inyectado.
- No modificar ningún archivo de `src/prompt/**` (hashes en `tests/fixtures/prompt-hashes.json`). El prompt de sugerencia vive en `src/config-ia/`.
- La cola (`tareas_procesamiento`, `claim()`) no cambia. Generar una sugerencia **no** crea tareas.
- Una sugerencia nunca entra al borrador sin aprobación explícita (`POST /suggestions/:id/approve`).
- Una falla de la IA nunca impide crear la solicitud.
- Texto de regla: una línea, 1–2000 caracteres. Forma armada por nuestro código: `Cuando <cuando>, <hacer>.` + ` Excepción: <excepto>.` si hay excepción.
- `regla` es obligatoria en la respuesta: la IA no puede declinar; sus dudas van en `advertencias`.
- Valores: `SUGERENCIA_MODEL` = `gpt-5.4`, `SUGERENCIA_REASONING_EFFORT` = `medium`; tiempo límite por intento 120000 ms, 2 intentos; sugerencia `generando` con más de 300000 ms se muestra como error.
- Errores de validación: `Object.assign(new Error(msg),{statusCode})`, mensajes en español.
- Interfaz en español cotidiano; no mostrar "OCR", "prompt" ni "LLM" (decir "lectura del documento", "instrucciones de la IA").
- Rama `config-ia-regla-sugerida`. Commits por tarea con `git add` solo de los archivos de la tarea; mensajes estilo `feat(config-ia): …`.
- Falla conocida y ajena: `tests/browser/platform.spec.js` ("tbody tr" espera 3, recibe 10). No corregirla aquí.

## Review Focus

1. **La IA responde JSON envuelto en ```json o con texto antes/después.** Debe quedar `lista`, no `error`. Prueba en la Task 3.
2. **"Pedir otra" mientras la anterior sigue generando, o respuesta tardía de una sugerencia ya reemplazada.** La segunda petición responde 409 "Ya se está generando una sugerencia."; una respuesta tardía no revive una sugerencia `reemplazada`. Prueba en la Task 3.
3. **La API se reinicia con una sugerencia `generando`.** Pasados 300000 ms se muestra como `error` "Se interrumpió la sugerencia; pide otra." y se puede pedir otra. Prueba en la Task 3.
4. **Se publica otra solicitud entre sugerir y aprobar.** Aprobar responde 409 "Producción cambió; pide otra sugerencia." y el borrador no cambia. Prueba en la Task 4.
5. **Doble clic en Aprobar la misma opción.** La segunda responde 409 "Esta opción ya se aprobó." y el borrador tiene un solo cambio. Prueba en la Task 4.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/config-ia/suggestion.js` (nuevo) | Puro: `composeRuleText`, `validateSuggestion`, `optionOf`, `applyApproval`, constantes. |
| `src/config-ia/suggestion-prompt.js` (nuevo) | Puro: `SUGGESTION_SYSTEM`, `criterionFocus`, `buildSuggestionPrompt`. |
| `src/config-ia/draft.js` | `validateChanges` conserva `sugerencia_id`. |
| `src/platform/config-ia/suggestions.js` (nuevo) | DB + IA: `knownRules`, `startSuggestion`, `latestSuggestion`, `approveSuggestion`, `discardSuggestion`. |
| `src/platform/config-ia/requests.js` | `requestDetail` incluye `sugerencia`; `persistDraft` compartido; `publishRequest` pasa `sugerencia_id` al historial. |
| `src/platform/config-ia/versions.js` | `insertVersion` guarda `sugerencia_id`; `ruleHistory` lo devuelve. |
| `src/platform/config-ia/routes.js`, `src/platform/server.js` | Rutas nuevas; `llm` inyectable. |
| `src/platform/schema.sql`, `src/platform/db.js` | Tabla `ia_sugerencias`; columna `ia_reglas_historial.sugerencia_id`. |
| `src/config/runtime.js`, `.env.example`, `README.md` | `SUGERENCIA_MODEL`, `SUGERENCIA_REASONING_EFFORT`. |
| `web/src/configia/SuggestionCard.tsx` (nuevo) | Tarjeta "Regla sugerida por IA". |
| `web/src/configia/RequestsTab.tsx`, `DraftEditor.tsx`, `RulesTab.tsx`, `types.ts`, `configia.css`, `web/src/Tour.tsx` | Integración en pantalla. |

---

### Task 0: Rama

- [ ] **Step 1:** `git checkout -b config-ia-regla-sugerida`; `git branch --show-current` muestra `config-ia-regla-sugerida`.
- [ ] **Step 2:** Commit del diseño y este plan: `git add docs/superpowers/specs/2026-11-23-config-ia-regla-sugerida-design.md docs/superpowers/plans/2026-11-23-config-ia-regla-sugerida.md && git commit -m "docs(config-ia): diseño y plan de regla sugerida por IA"`.

---

### Task 1: Lógica pura de la sugerencia

**Files:**
- Create: `src/config-ia/suggestion.js`
- Modify: `src/config-ia/draft.js` (`validateChanges`)
- Test: `tests/config-ia-suggestion.test.js` (nuevo), `tests/config-ia-draft.test.js`

**Interfaces:**
- Produces:
  - `INVALID_SUGGESTION = 'La IA no devolvió una sugerencia válida. Pide otra o escribe la regla a mano.'`
  - `TIPOS_CHOQUE = ['contradice','duplica','se_solapa']`, `TIPOS_ADVERTENCIA = ['contradice_texto_base','hallazgo_parece_correcto','problema_de_entrada','otra']`
  - `KnownRule = {codigo, texto, criterios:number[], activa:boolean, origen:'produccion'|'esta_solicitud'|'otra_solicitud', solicitud_numero:number|null}`
  - `Propuesta = {entendimiento:string, regla:{cuando,hacer,excepto:string|null,texto,criterios:number[],motivo}, choques:[{codigo,origen,solicitud_numero:number|null,tipo,explicacion,ajuste:{texto,criterios,motivo}|null}], recomendacion:'regla_nueva'|string, advertencias:[{tipo,explicacion}]}` (en `advertencias`, `tipo` puede ser también `'criterio_distinto'`)
  - `composeRuleText({cuando,hacer,excepto}): string`
  - `validateSuggestion(raw:object, {known:KnownRule[], criterioId:number}): Propuesta`. Lanza `Error(INVALID_SUGGESTION)`.
  - `optionOf(propuesta, opcion:string): {texto,criterios,motivo}`. Lanza 400 `'Opción no reconocida.'`.
  - `applyApproval(cambios:Change[], baseReglas:Rule[], {opcion,texto,criterios,motivo,autor,sugerenciaId}): Change[]` (devuelve arreglo nuevo, no muta).

- [ ] **Step 1: Pruebas que fallan** en `tests/config-ia-suggestion.test.js`:

```js
test('composeRuleText arma una sola línea con la estructura fija', () => {
  assert.equal(composeRuleText({ cuando: 'el plan no tenga firma física', hacer: 'valida su vigencia por el código y la versión del pie de página', excepto: null }),
    'Cuando el plan no tenga firma física, valida su vigencia por el código y la versión del pie de página.');
  assert.equal(composeRuleText({ cuando: 'Cuando el plan\nno tenga firma.', hacer: 'no lo marques "No cumple".', excepto: 'el documento exija firma.' }),
    'Cuando el plan no tenga firma, no lo marques "No cumple". Excepción: el documento exija firma.');
  assert.throws(() => composeRuleText({ cuando: ' ', hacer: 'x' }));
});
test('validateSuggestion: forma mínima, criterios y advertencia criterio_distinto', () => { /* raw con regla {cuando,hacer,criterios:[1]} y criterioId 2:
  regla.texto armado; motivo vacío → 'Sugerida por IA'; advertencias contiene {tipo:'criterio_distinto'} con 'Coherencia' en la explicación;
  raw sin hacer, sin criterios válidos, o con criterios [7] → lanza INVALID_SUGGESTION; texto > 2000 → INVALID_SUGGESTION */ });
test('validateSuggestion: choques con origen corregido, inventados descartados y ajuste solo propio o de producción', () => { /*
  known = [R-3 produccion, R-20 esta_solicitud, R-5 otra_solicitud #14];
  choque R-3 con origen 'otra_solicitud' declarado → queda 'produccion' (no existe R-3 en otra solicitud);
  choque R-99 → descartado; choque R-5 con ajuste → origen 'otra_solicitud', solicitud_numero 14, ajuste null;
  choque R-20 con ajuste texto 'a\nb' → ajuste.texto 'a b'; tipo desconocido → 'se_solapa' */ });
test('validateSuggestion: recomendación y advertencias', () => { /*
  recomendacion 'R-3' con ajuste válido → 'R-3'; 'R-5' (sin ajuste) → 'regla_nueva'; ausente → 'regla_nueva';
  advertencias ['texto suelto', {tipo:'raro',explicacion:'x'}, {tipo:'problema_de_entrada',explicacion:''}] →
  [{tipo:'otra',explicacion:'texto suelto'},{tipo:'otra',explicacion:'x'}] */ });
test('applyApproval: regla nueva agrega crear con sugerencia_id', () => { /*
  applyApproval([], base, {opcion:'regla_nueva',texto:'T',criterios:[2],motivo:'m',autor:'Ana',sugerenciaId:ID})
  → [{op:'crear',codigo:null,texto:'T',criterios:[2],motivo:'m',autor:'Ana',sugerencia_id:ID}] */ });
test('applyApproval: ajuste de producción usa antes de la regla base; reemplaza un cambio previo conservando antes y activa', () => { /*
  sin cambio previo sobre R-1 → {op:'modificar',codigo:'R-1',texto,criterios,antes:{texto:'Regla 1',criterios:[2],activa:true},motivo,autor,sugerencia_id};
  con cambio previo {op:'modificar',codigo:'R-1',activa:false,antes:A} → un solo cambio sobre R-1 con antes A y activa false;
  con cambio previo crear R-20 → sigue siendo op 'crear', codigo 'R-20', con texto/criterios/motivo/sugerencia_id nuevos;
  opcion 'R-77' inexistente → lanza statusCode 409 'La regla R-77 ya no está disponible; pide otra sugerencia.' */ });
```

En `tests/config-ia-draft.test.js` agregar: `validateChanges` conserva `sugerencia_id` en `crear` y `modificar`; `sugerencia_id: 'x'` lanza 400 `'Sugerencia no válida.'`; `rulesFingerprint(applyChanges(base, conId).rules) === rulesFingerprint(applyChanges(base, sinId).rules)`.

- [ ] **Step 2:** `node --test tests/config-ia-suggestion.test.js tests/config-ia-draft.test.js` → FAIL (módulo inexistente / campo descartado).
- [ ] **Step 3: Implementar** `src/config-ia/suggestion.js` y el cambio en `validateChanges`.
  - `composeRuleText`: recortar, colapsar `\s+` a un espacio, quitar un `Cuando ` inicial (sin distinguir mayúsculas) de `cuando` y los puntos finales de cada parte; vacío en `cuando` o `hacer` → `Error(INVALID_SUGGESTION)`.
  - Validación de texto y criterios: reutilizar `normalizeCriteria` de `draft.js` (capturar su error y relanzar `INVALID_SUGGESTION` para la regla; para un ajuste inválido, `ajuste = null`). Nombre del criterio desde `CRITERIOS` de `src/prompt/criterios/index.js`; explicación de `criterio_distinto`: `` `La regla no incluye el criterio de la solicitud (${nombre}).` ``.
  - Resolución de `origen`: si la IA dijo `otra_solicitud` y el código existe entre las reglas `otra_solicitud` → esa (con su `solicitud_numero` si coincide, si no el primero); si no, si existe entre `produccion`/`esta_solicitud` → ese origen; si no, si existe en otra solicitud → `otra_solicitud`; si no, descartar. Deduplicar por `codigo`+`origen`+`solicitud_numero`.
  - `validateChanges`: `sugerencia_id` opcional; si viene, debe cumplir `/^[0-9a-f-]{36}$/i`, si no 400 `'Sugerencia no válida.'`.
- [ ] **Step 4:** `node --test tests/*.test.js` → PASS (incluye `compatibility.test.js`: hashes intactos).
- [ ] **Step 5:** `git add src/config-ia/suggestion.js src/config-ia/draft.js tests/config-ia-suggestion.test.js tests/config-ia-draft.test.js && git commit -m "feat(config-ia): validación de sugerencias y aprobación al borrador"`.

---

### Task 2: Prompt de sugerencia

**Files:**
- Create: `src/config-ia/suggestion-prompt.js`
- Test: `tests/config-ia-suggestion-prompt.test.js`

**Interfaces:**
- Consumes: `KnownRule`, `Propuesta` (Task 1).
- Produces:
  - `SUGGESTION_SYSTEM: string`
  - `criterionFocus(criterioId:number): string` — de `SYSTEM_PROMPT` del criterio (importar los seis módulos `src/prompt/criterios/c*.js`), el tramo desde `CRITERIO A EVALUAR` hasta antes de `REGLAS DE NEGOCIO INSTITUCIONALES`, recortado.
  - `buildSuggestionPrompt({solicitud:{criterio_id,requerimiento_codigo,descripcion,esperado,fila_copia}, tipo:string, known:KnownRule[], previa:Propuesta|null, indicacion:string}): {system, user}`

- [ ] **Step 1: Pruebas que fallan:**

```js
test('criterionFocus extrae la sección del criterio sin reglas comunes ni formato', () => {
  for (const c of CRITERIOS) {
    const f = criterionFocus(c.id);
    assert.ok(f.startsWith(`CRITERIO A EVALUAR: ${c.nombre}`));
    assert.ok(!f.includes('REGLAS DE NEGOCIO INSTITUCIONALES') && !f.includes('FORMATO DE SALIDA'));
  }
});
test('SUGGESTION_SYSTEM fija reglas de redacción, choques, advertencias y formato', () => {
  for (const s of ['REGLAS ADICIONALES (OBLIGATORIAS)', 'una sola línea', 'Siempre', '"recomendacion"', 'contradice', 'duplica', 'se_solapa',
    'contradice_texto_base', 'hallazgo_parece_correcto', 'problema_de_entrada', 'esta_solicitud', 'otra_solicitud']) assert.ok(SUGGESTION_SYSTEM.includes(s), s);
});
test('buildSuggestionPrompt incluye la solicitud, el hallazgo y las reglas con su origen', () => { /*
  user contiene: '<criterio_de_la_solicitud id="2" nombre="Coherencia">' seguido del SYSTEM_PROMPT de C2;
  '<criterios_disponibles>' con '[6] Integración'; '<requerimiento codigo="5.1" tipo="plan"/>';
  JSON de fila_copia dentro de '<hallazgo_reportado>'; '<que_esta_mal>', '<que_esperaba>(no indicado)</que_esperaba>' si esperado vacío;
  '- [R-3] (produccion, activa) criterios 1, 3: texto', '- [R-5] (otra_solicitud #14)'; sin '<sugerencia_anterior>' ni '<indicacion_del_usuario>'.
  fila_copia null → '<hallazgo_reportado>' contiene 'Falta un hallazgo en este criterio'.
  Con previa e indicacion 'más específica' → '<sugerencia_anterior>' con previa.regla.texto y '<indicacion_del_usuario>más específica'.
  known vacío → '<reglas_existentes>\n(ninguna)' */ });
```

- [ ] **Step 2:** `node --test tests/config-ia-suggestion-prompt.test.js` → FAIL.
- [ ] **Step 3: Implementar.** `SUGGESTION_SYSTEM` (texto fijo, puede pulirse sin perder los términos probados):

```
ROL
Eres el redactor de reglas de un auditor IA de lineamientos institucionales. Una persona reportó que un resultado del auditor está mal. Tu trabajo es redactar UNA regla que corrija ese comportamiento.

CÓMO SE USAN LAS REGLAS
- Cada regla se agrega al final de las instrucciones del criterio, bajo "REGLAS ADICIONALES (OBLIGATORIAS)", en una sola línea.
- Una regla no puede cambiar el formato de salida JSON del criterio.

CÓMO REDACTAR
- Siempre propones una regla, aunque dudes. Tus dudas van en "advertencias".
- Una regla = una conducta. General y reutilizable: no menciones el código del requerimiento, nombres de archivos ni el caso puntual salvo que sea indispensable.
- Lenguaje imperativo y directo. No inventes normativa.
- "criterios": los criterios (1 a 6) donde la regla debe aplicarse.

CHOQUES con reglas existentes (<reglas_existentes>)
- "contradice": piden conductas opuestas. "duplica": dicen lo mismo. "se_solapa": cubren parte del mismo caso con distinto alcance.
- "ajuste": solo para reglas con origen "produccion" o "esta_solicitud", nunca "otra_solicitud". Es el texto completo nuevo de esa regla, reescrito para que incluya la conducta pedida y deje de chocar; aprobar solo el ajuste debe bastar.
- "recomendacion": el código de la regla a ajustar si hay un choque "contradice" o "duplica" con ajuste; si no, "regla_nueva".

ADVERTENCIAS (tipos)
- "contradice_texto_base": lo pedido choca con las reglas de negocio o el texto base del criterio.
- "hallazgo_parece_correcto": el resultado original parece bien fundado.
- "problema_de_entrada": parece un problema de lectura del documento o de una evidencia faltante, no de las instrucciones.
- "otra".

FORMATO DE SALIDA ESTRICTO
Devuelve ÚNICAMENTE un objeto JSON, sin markdown:
{"entendimiento":"…","regla":{"cuando":"…","hacer":"…","excepto":null,"criterios":[1],"motivo":"…"},
 "choques":[{"codigo":"R-3","origen":"produccion | esta_solicitud | otra_solicitud","solicitud_numero":null,"tipo":"contradice | duplica | se_solapa","explicacion":"…","ajuste":{"texto":"…","criterios":[1],"motivo":"…"}}],
 "recomendacion":"regla_nueva","advertencias":[{"tipo":"…","explicacion":"…"}]}
```

  Bloques del `user` en este orden: `<criterio_de_la_solicitud>`, `<criterios_disponibles>` (por criterio: `[id] nombre — aplica a: <aplicaA>` + `criterionFocus`), `<requerimiento/>`, `<hallazgo_reportado>`, `<que_esta_mal>`, `<que_esperaba>`, `<reglas_existentes>` (activa/inactiva solo para producción y esta solicitud), opcionales `<sugerencia_anterior>` e `<indicacion_del_usuario>`.
- [ ] **Step 4:** `node --test tests/*.test.js` → PASS.
- [ ] **Step 5:** `git add src/config-ia/suggestion-prompt.js tests/config-ia-suggestion-prompt.test.js && git commit -m "feat(config-ia): instrucción estructurada para sugerir reglas"`.

---

### Task 3: Generar y consultar sugerencias (tabla, servicio, rutas, configuración)

**Files:**
- Modify: `src/platform/schema.sql`, `src/platform/db.js` (`migrate`), `src/config/runtime.js`, `.env.example`, `README.md` (tabla de parámetros), `src/platform/config-ia/requests.js`, `src/platform/config-ia/routes.js`, `src/platform/server.js`
- Create: `src/platform/config-ia/suggestions.js`
- Test: `tests/config.test.js`, `tests/integration/config-ia.test.js`

**Interfaces:**
- Consumes: Task 1 y Task 2; `loadRequest`, `addEvent`, `requestDetail` de `requests.js` (exportar `loadRequest`); `versionById` de `versions.js`; `parseLlmJsonObject`; `callOpenAI` (`{system,user,model,reasoningEffort,timeoutMs,maxAttempts}` → `{rawText,usage}`).
- Produces:
  - Tabla `ia_sugerencias(id CHAR(36) PK, solicitud_id CHAR(36) NOT NULL FK, autor VARCHAR(100) NOT NULL, indicacion TEXT, base_version_id CHAR(36) NOT NULL FK ia_versiones, estado VARCHAR(16) NOT NULL, modelo VARCHAR(128) NOT NULL, esfuerzo VARCHAR(16), mensajes JSON NOT NULL, respuesta LONGTEXT, uso JSON, duracion_ms BIGINT, error TEXT, propuesta JSON, aprobaciones JSON NOT NULL, created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3), finished_at TIMESTAMP(3) NULL, INDEX(solicitud_id, created_at))`. Estados: `generando|lista|error|aprobada|descartada|reemplazada`.
  - `config.suggestionModel` (`SUGERENCIA_MODEL`, `'gpt-5.4'`), `config.suggestionEffort` (`SUGERENCIA_REASONING_EFFORT`, `'medium'`, mismos valores que los demás esfuerzos).
  - `SUGGESTION_TIMEOUT_MS = 120000`, `SUGGESTION_ATTEMPTS = 2`, `SUGGESTION_STALE_MS = 300000`.
  - `knownRules(solicitud, c): Promise<KnownRule[]>` — reglas efectivas del borrador (`applyChanges` sobre la base): `esta_solicitud` si el borrador las toca, si no `produccion`; más reglas con texto de los cambios de **otras** solicitudes abiertas (`otra_solicitud`, con su `numero`; criterios del cambio o, si no trae, de la regla base).
  - `startSuggestion(solicitudId, {autor, indicacion}, llm): Promise<{id, done:Promise<void>}>` — `done` nunca rechaza.
  - `latestSuggestion(solicitudId, c?): Promise<SuggestionView|null>` con `SuggestionView = {id, estado, desactualizada:boolean, error:string|null, autor, indicacion, created_at, propuesta:Propuesta|null, aprobaciones:Aprobacion[]}`; `Aprobacion = {opcion, codigo, editada, texto, criterios, motivo, autor, fecha}`.
  - `requestDetail(id)` agrega `sugerencia: SuggestionView|null`.
  - Rutas: `POST /api/config-ia/requests` → 201 `{id, numero, sugerenciaId}` (`sugerenciaId` null si no se pudo iniciar); `POST /api/config-ia/requests/:id/suggestions` `{autor, indicacion?}` → 202 `{id}`; `GET /api/config-ia/requests/:id/suggestion` → `{sugerencia: SuggestionView|null}`.
  - `registerConfigIaRoutes(app, {llm = callOpenAI} = {})`, `buildServer({llm} = {})`.

- [ ] **Step 1: Pruebas que fallan.** `tests/config.test.js`: `loadConfig({})` da `suggestionModel 'gpt-5.4'` y `suggestionEffort 'medium'`; `{SUGERENCIA_REASONING_EFFORT:'x'}` lanza. En `tests/integration/config-ia.test.js` (con `fakeSuggest(raw, calls)` local que devuelve `{rawText, usage:{total_tokens:1}}` y registra `args`):

```js
test('sugerencias: generar, consultar y trazabilidad', async () => { /*
  solicitud nueva sobre seedAnalyzed('7.6.1'); const {id, done} = await startSuggestion(s.id, {autor:'Ana'}, fakeSuggest(validRaw, calls)); await done;
  latestSuggestion → estado 'lista', propuesta.regla.texto armado, desactualizada false;
  calls[0].model === 'gpt-5.4', calls[0].timeoutMs === 120000, calls[0].maxAttempts === 2, calls[0].user incluye '<que_esta_mal>';
  fila de ia_sugerencias con mensajes, respuesta y uso guardados; evento 'sugerencia_creada';
  COUNT(*) de tareas_procesamiento no cambia */ });
test('sugerencias: JSON envuelto en markdown queda lista', /* rawText = '```json\n' + JSON.stringify(validRaw) + '\n```' → 'lista' */);
test('sugerencias: respuesta inválida o IA caída → error, la solicitud existe', /*
  rawText 'no es json' → estado 'error', error === INVALID_SUGGESTION, respuesta guardada;
  llm que lanza → estado 'error', error 'No fue posible generar la sugerencia. Pide otra o escribe la regla a mano.' */);
test('sugerencias: pedir otra reemplaza, no hay dos a la vez y una respuesta tardía no revive', /*
  llm controlado por una promesa pendiente: startSuggestion A (generando); startSuggestion B → 409 'Ya se está generando una sugerencia.';
  forzar A a 'lista'; startSuggestion B con indicacion 'más específica' → A 'reemplazada', B.user incluye '<sugerencia_anterior>' y 'más específica';
  sugerencia C generando, reemplazarla por UPDATE directo, resolver su llm → C sigue 'reemplazada' */);
test('sugerencias: generando vieja se muestra como interrumpida', /*
  UPDATE ia_sugerencias SET created_at = NOW(3) - INTERVAL 301 SECOND → latestSuggestion estado 'error', error 'Se interrumpió la sugerencia; pide otra.'; startSuggestion nueva permitida */);
test('sugerencias: solicitud cerrada o indicación larga', /* rechazada → 409 'La solicitud ya está cerrada.'; indicacion de 501 caracteres → 400 'La indicación admite hasta 500 caracteres.' */);
test('API: crear solicitud arranca la sugerencia', /*
  const app2 = await buildServer({llm: fakeSuggest(validRaw)}); POST /api/config-ia/requests → 201 con sugerenciaId;
  esperar con un bucle corto sobre GET /requests/:id/suggestion hasta 'lista'; GET /requests/:id incluye sugerencia;
  con buildServer({llm: async()=>{throw new Error('caída')}}) la creación sigue respondiendo 201 */);
```

  `validRaw` cita una regla de producción existente en el test (publicar antes una versión con una regla vía `publishRules`) para cubrir `origen`.
- [ ] **Step 2:** `node --test tests/config.test.js` → FAIL; integración → FAIL.
- [ ] **Step 3: Implementar.**
  - `schema.sql`: tabla `ia_sugerencias`; en `ia_reglas_historial` agregar `sugerencia_id CHAR(36)` al `CREATE`. `migrate()`: si falta `ia_reglas_historial.sugerencia_id`, `ALTER TABLE ia_reglas_historial ADD COLUMN sugerencia_id CHAR(36) NULL` (mismo patrón que `reglas_version_id`).
  - `runtime.js`, `.env.example` (`SUGERENCIA_MODEL=gpt-5.4`, `SUGERENCIA_REASONING_EFFORT=medium`), fila nueva en la tabla de parámetros de `README.md`.
  - `startSuggestion`: `normalizeAuthor`; indicación recortada ≤ 500. En transacción: `loadRequest(id, c, true)`; cerrada → 409; existe `generando` no vieja → 409; `previa` = propuesta de la última sugerencia con propuesta; `UPDATE … SET estado='reemplazada' WHERE solicitud_id=? AND estado IN ('generando','lista','error','aprobada')`; armar `known` y prompt; insertar `generando` con `base_version_id = solicitud.base_version_id`, `aprobaciones '[]'`; evento `sugerencia_creada` con `{sugerencia:id}`. Tras el commit, lanzar la generación sin `await` y devolver `{id, done}`.
  - Generación: llamar `llm({system,user,model:config.suggestionModel,reasoningEffort:config.suggestionEffort,timeoutMs:SUGGESTION_TIMEOUT_MS,maxAttempts:SUGGESTION_ATTEMPTS})`; guardar `respuesta`, `uso`, `duracion_ms`; `validateSuggestion(parseLlmJsonObject(rawText), {known, criterioId})`. Toda escritura de resultado con `WHERE id=? AND estado='generando'`. Falla de la llamada → mensaje genérico (detalle a `console.error`, sin secretos); falla de parseo o validación → `INVALID_SUGGESTION`.
  - `latestSuggestion`: última fila con `estado <> 'reemplazada'`; `generando` con antigüedad > `SUGGESTION_STALE_MS` → vista `error` con `'Se interrumpió la sugerencia; pide otra.'`; `desactualizada = base_version_id !== solicitud.base_version_id` para `lista`/`aprobada`. `startSuggestion` trata una `generando` vieja como no bloqueante.
  - Ruta `POST /requests`: `createRequest` y luego `startSuggestion` dentro de `try/catch` (si falla, `sugerenciaId: null` y `console.error`).
- [ ] **Step 4:** `node --test tests/*.test.js` y `node scripts/test-integration.js` → PASS.
- [ ] **Step 5:** `git add` de los archivos de la tarea y `git commit -m "feat(config-ia): generar sugerencias de reglas fuera de la cola"`.

---

### Task 4: Aprobar y descartar; trazabilidad al publicar

**Files:**
- Modify: `src/platform/config-ia/suggestions.js`, `src/platform/config-ia/requests.js`, `src/platform/config-ia/versions.js`, `src/platform/config-ia/routes.js`
- Test: `tests/integration/config-ia.test.js`

**Interfaces:**
- Consumes: `applyApproval`, `optionOf` (Task 1); `latestSuggestion` (Task 3).
- Produces:
  - `persistDraft(solicitud, validated:Change[], who, c)` en `requests.js` — asigna códigos a `crear` sin código, exige `antes` en `modificar`, actualiza `cambios` y `estado='en_prueba'`. `saveDraft` la usa (sin cambio de comportamiento).
  - `approveSuggestion(id, {autor, opcion, texto?, criterios?, motivo?}): Promise<RequestDetail>`
  - `discardSuggestion(id, {autor}): Promise<RequestDetail>`
  - Rutas: `POST /api/config-ia/suggestions/:id/approve`, `POST /api/config-ia/suggestions/:id/discard` → 200 `RequestDetail`.
  - `ruleHistory` devuelve `sugerencia_id` por entrada.

- [ ] **Step 1: Pruebas que fallan:**

```js
test('aprobar: regla nueva y ajuste de producción entran al borrador con sugerencia_id', async () => { /*
  sugerencia lista con choque R-x (producción) y ajuste; approve regla_nueva → borrador con crear R-n, sugerencia_id, estado solicitud 'en_prueba',
  sugerencia 'aprobada', aprobaciones[0] {opcion:'regla_nueva', codigo:'R-n', editada:false}; evento 'sugerencia_aprobada';
  approve 'R-x' con texto editado → modificar R-x con antes = regla de producción y aprobaciones[1].editada true;
  createTest + drain sobre ese borrador funciona como hoy */ });
test('aprobar: ajuste de una regla de esta solicitud la reemplaza en el borrador', /*
  tras aprobar R-n, pedir otra con un choque esta_solicitud R-n con ajuste → approve 'R-n' → sigue un solo cambio crear R-n con el texto nuevo */);
test('aprobar: misma opción dos veces → 409 y un solo cambio', /* 'Esta opción ya se aprobó.' */);
test('aprobar: producción cambió → 409 y borrador intacto', /* publicar otra versión con publishRules; approve → 409 'Producción cambió; pide otra sugerencia.'; latestSuggestion.desactualizada true */);
test('aprobar/descartar: estados no válidos', /*
  opción inexistente → 400 'Opción no reconocida.'; solicitud rechazada → 409 'La solicitud ya está cerrada.';
  discard de lista → 'descartada' y evento 'sugerencia_descartada'; approve de descartada → 409 'Esta sugerencia ya no se puede aprobar.';
  discard de aprobada → 409 'Esta sugerencia ya no se puede descartar.' */);
test('publicar: el historial de la regla guarda la sugerencia de origen', /* tras prueba Funcionó y publishRequest → ruleHistory('R-n')[0].sugerencia_id === id */);
```

- [ ] **Step 2:** `node scripts/test-integration.js` → FAIL.
- [ ] **Step 3: Implementar.**
  - `approveSuggestion` en una transacción: `SELECT … FOR UPDATE` de la sugerencia (404 `'Sugerencia no encontrada.'`); estado fuera de `lista`/`aprobada` → 409; `loadRequest(…, true)` cerrada → 409; base distinta → 409; opción ya en `aprobaciones` → 409; contenido = `optionOf` con `texto`/`criterios`/`motivo` del cuerpo encima; `editada` si alguno difiere; `applyApproval` → `validateChanges` → `persistDraft`; registrar en `aprobaciones` el código final (para `regla_nueva`, el `crear` con ese `sugerencia_id` recién asignado); `estado='aprobada'`; evento `sugerencia_aprobada` con `{sugerencia, opcion, editada}`. Devolver `requestDetail` después del commit.
  - `discardSuggestion`: solo desde `generando|lista|error`.
  - `publishRequest`: `autores[codigo]` incluye `sugerencia_id`; `insertVersion` lo escribe en `ia_reglas_historial`; `ruleHistory` lo selecciona.
- [ ] **Step 4:** `node --test tests/*.test.js` y `node scripts/test-integration.js` → PASS.
- [ ] **Step 5:** `git add` de los archivos de la tarea y `git commit -m "feat(config-ia): aprobar sugerencias al borrador con trazabilidad"`.

---

### Task 5: Interfaz

**Files:**
- Create: `web/src/configia/SuggestionCard.tsx`
- Modify: `web/src/configia/types.ts`, `RequestsTab.tsx`, `DraftEditor.tsx`, `RulesTab.tsx`, `configia.css`, `web/src/Tour.tsx`, `README.md` (sección Config IA), `docs/superpowers/specs/2026-11-12-config-ia-design.md` (nota)
- Test: `tests/browser/config-ia.spec.js`

**Interfaces:**
- Consumes: rutas de Tasks 3–4.
- Produces:
  - `types.ts`: `Suggestion`, `Proposal`, `Clash`, `SuggestionWarning`, `Approval` (espejo de `SuggestionView`/`Propuesta`); `RequestDetail.sugerencia?: Suggestion|null`; `Change.sugerencia_id?: string`; `HistoryEntry.sugerencia_id?: string|null`; `ApproveBody = {autor:string; opcion:string; texto?:string; criterios?:number[]; motivo?:string}`.
  - `SuggestionCard({value, closed, draftDirty, autor, onRequest, onApprove, onDiscard}: {value:Suggestion; closed:boolean; draftDirty:boolean; autor:string; onRequest:(indicacion:string)=>Promise<void>; onApprove:(body:ApproveBody)=>Promise<void>; onDiscard:()=>Promise<void>})`
  - `DraftEditor` nuevas props opcionales: `onSuggest?:()=>void`, `suggesting?:boolean`, `onDirtyChange?:(dirty:boolean)=>void`.

- [ ] **Step 1: Prueba E2E que falla** — nuevo test en `tests/browser/config-ia.spec.js`, `'Config IA: regla sugerida por IA con choque y aprobación del ajuste'`, con su propio mock: `POST /api/config-ia/requests` deja la sugerencia `generando`; la primera consulta de `GET /api/config-ia/requests/s1/suggestion` la devuelve `lista` con regla nueva, choque `se_solapa` con `R-9` (producción) con ajuste, `recomendacion:'R-9'` y advertencia `problema_de_entrada`; `POST /api/config-ia/suggestions/g1/approve` guarda el cuerpo y devuelve el detalle con `cambios:[{op:'modificar',codigo:'R-9',…,sugerencia_id:'g1'}]`; `POST /api/config-ia/requests/s1/suggestions` guarda el cuerpo. Aserciones:
  - el detalle muestra `Generando sugerencia…` y luego `Regla sugerida por IA`;
  - se ve `Parece un problema de lectura del documento` y `Recomendada` junto al ajuste de R-9;
  - clic en el botón `Aprobar ajuste de R-9` → cuerpo `{autor:'Ana', opcion:'R-9'}`; la fila R-9 del borrador muestra `Sugerida por IA`;
  - llenar `Indicación para la IA (opcional)` con `más específica` y clic en `Pedir otra` → cuerpo `{autor:'Ana', indicacion:'más específica'}`;
  - sin errores de página; a 390 px sin desplazamiento horizontal.

  El test existente debe seguir pasando sin cambios (su detalle no trae `sugerencia`).
- [ ] **Step 2:** Compilar y servir (`node node_modules/vite/bin/vite.js build --config web/vite.config.ts`; `node src/platform/server.js` en segundo plano) y correr `node node_modules/@playwright/test/cli.js test tests/browser/config-ia.spec.js` → el test nuevo FALLA.
- [ ] **Step 3: Implementar.**
  - `RequestDetailModal`: estado `sugerencia`, tomado de `detail.sugerencia ?? null` al cargar y tras aprobar o descartar; mientras `estado==='generando'`, consultar `GET …/suggestion` cada 2500 ms con limpieza al desmontar. **No** volver a cargar el detalle en ese ciclo, porque `DraftEditor` reinicia sus cambios locales. Mostrar `SuggestionCard` entre "Resultado original" y el borrador si hay sugerencia y no está `descartada`.
  - `SuggestionCard` con estos textos exactos:
    - estados: `Generando sugerencia…` · error con su mensaje · desactualizada `Producción cambió; pide otra sugerencia.`;
    - contenido: `Entendí: <entendimiento>`; badge `Recomendada`; criterios con `CriteriaChips`;
    - choques: `Contradice a` / `Repite a` / `Se solapa con` + `R-x` + `(producción)`, `(este borrador)` o `(borrador #N)`; en un ajuste propio, `Reemplaza R-x en el borrador`;
    - advertencias: `contradice_texto_base` → `Ojo: esto contradice una regla fija del análisis`, `hallazgo_parece_correcto` → `Ojo: el resultado original parece correcto`, `problema_de_entrada` → `Parece un problema de lectura del documento, no de las instrucciones`, `criterio_distinto` → `Revisa los criterios`, `otra` → `Ojo`, cada una seguida de su explicación;
    - botones: `Aprobar` y `Editar y aprobar` (regla nueva), `Aprobar ajuste` con `aria-label="Aprobar ajuste de R-x"`, `Pedir otra`, `Descartar`; formulario de edición con `Texto sugerido`, criterios, `Motivo sugerido` y `Confirmar aprobación`;
    - opciones ya aprobadas: tag `Aprobada` y sin botón;
    - `draftDirty`: botones de aprobar deshabilitados y `Guarda o descarta los cambios del borrador antes de aprobar.`;
    - tras aprobar la regla nueva con un choque `contradice` cuyo ajuste no se aprobó: `R-x ordena lo contrario; considera aprobar el ajuste.`
  - `DraftEditor`: botón `Sugerir regla con IA` junto a "Agregar regla" (deshabilitado si `suggesting`); badge `Sugerida por IA` (clase `cia-badge ia`) en los cambios con `sugerencia_id`; al editar un `modificar`, conservar `sugerencia_id` del cambio previo; informar `dirty` con `onDirtyChange`.
  - `NewRequest`: bajo "¿Qué esperabas?", `<p className="muted">La IA usará esto para sugerir la regla.</p>`.
  - `RulesTab` (historial): tag `Sugerida por IA` si `sugerencia_id`.
  - `Tour.tsx` paso 5: `'Si un hallazgo no es correcto, regístralo en Config IA. La IA sugiere la regla, tú la apruebas, se prueba y se publica una nueva versión.'`
  - `README.md` (sección Config IA): viñeta **Regla sugerida por IA** que resuma el flujo, los choques y ajustes, las advertencias y que la sugerencia no espera en la cola. En `2026-11-12-config-ia-design.md`, bajo los no objetivos de la sección 3 y bajo las decisiones de la sección 13: `> Actualización 2026-11-23: la IA redacta la regla que una persona pide en su solicitud; ver [2026-11-23-config-ia-regla-sugerida-design.md](2026-11-23-config-ia-regla-sugerida-design.md). Sigue sin proponer mejoras por iniciativa propia.`
- [ ] **Step 4:** `node node_modules/typescript/bin/tsc --project web/tsconfig.json` sin errores; build; `node node_modules/@playwright/test/cli.js test tests/browser/config-ia.spec.js` → PASS (ambos tests).
- [ ] **Step 5:** `git add` de los archivos de la tarea y `git commit -m "feat(config-ia): tarjeta de regla sugerida por IA en la solicitud"`.

---

### Task 6: Verificación final

- [ ] **Step 1:** `node --test tests/*.test.js` → PASS.
- [ ] **Step 2:** `node scripts/test-integration.js` → PASS.
- [ ] **Step 3:** `node node_modules/typescript/bin/tsc --project web/tsconfig.json` y el build → sin errores.
- [ ] **Step 4:** `node node_modules/@playwright/test/cli.js test` → solo falla la conocida de `platform.spec.js` ("tbody tr"); cualquier otra falla se corrige.
- [ ] **Step 5:** `git status` limpio salvo archivos ajenos; `git log --oneline main..` muestra los commits de las Tasks 0–5.
