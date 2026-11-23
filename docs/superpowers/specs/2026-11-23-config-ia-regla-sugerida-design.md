# Config IA — regla sugerida por IA (diseño)

Fecha: 2026-11-23
Proyecto: `proyecto/` (plataforma "Análisis documental", DACI Lineamientos)
Extiende: [2026-11-12-config-ia-design.md](2026-11-12-config-ia-design.md)

## 1. Intención

Hoy, en Config IA, la persona que ve un hallazgo incorrecto crea una solicitud ("¿Qué está mal?", "¿Qué esperabas?") y luego **alguien tiene que redactar la regla a mano** en el borrador. Redactar una buena regla es la parte difícil: exige saber cómo se escribe una instrucción para la IA, qué hace cada criterio y qué reglas ya existen. Eso frena el flujo y produce reglas de calidad dispareja.

Esta mejora hace que **la IA redacte la regla a partir de lo que escribió el usuario**, con una estructura fija definida por nosotros, y que **revise si choca con reglas ya escritas**. Si choca, además de avisar, **propone cómo ajustar la regla existente**. El usuario solo revisa y aprueba. Lo aprobado entra al borrador y desde ahí se prueba y publica igual que hoy.

Es una **mejora del flujo, no un reemplazo**: borrador, Playground, veredicto, publicación, versiones e historial no cambian. Redactar la regla a mano sigue disponible.

## 2. Cambio respecto del diseño original

El diseño de Config IA decía "la IA no propone mejoras" (secciones 3 y 13). Queda así:

- **Sigue siendo no objetivo** que la IA proponga mejoras por iniciativa propia (por ejemplo, revisando resultados sin que nadie lo pida).
- **Nuevo:** la IA **redacta** la regla que una persona pidió en su solicitud. La persona decide si se usa.

Actualizar el diseño original con una nota que remita a este documento.

## 3. Objetivos, no objetivos y antiobjetivos

**Objetivos**
- Que el usuario no tenga que escribir la regla: la IA la sugiere a partir de la solicitud y el hallazgo.
- Reglas con estructura uniforme (*Cuando… → hacer… · Excepción…*), armadas por nuestro código.
- Detectar choques con reglas ya escritas (producción y otros borradores abiertos) y, cuando corresponda, proponer el ajuste de la regla de producción con la que choca.
- Que la sugerencia llegue en segundos, sin esperar detrás de un análisis.
- Saber qué reglas propuso la IA, con qué entrada, y quién las aprobó o editó.

**No objetivos**
- Que la IA ejecute pruebas, marque "Funcionó" o publique.
- Comparar automáticamente el resultado del Playground contra "¿Qué esperabas?".
- Que la IA proponga mejoras sin una solicitud.
- Modificar reglas de borradores de **otras** solicitudes (solo se avisa del choque).
- Editar el texto base del prompt (`src/prompt/**`).
- Cambiar el Playground, la publicación o las versiones.

**Antiobjetivos** (fracaso aunque el código funcione)
- Que una sugerencia entre al borrador o a producción sin que una persona la apruebe.
- Que una falla de la IA impida crear la solicitud o escribir la regla a mano.
- Que el usuario tenga que esperar detrás de un análisis para ver la sugerencia.
- Que no se pueda distinguir una regla sugerida por IA de una escrita a mano, ni saber quién la aprobó.
- Que una regla sugerida altere el formato de salida JSON del criterio.

## 4. Flujo

1. El usuario crea la solicitud como hoy: nombre, hallazgo (o "falta un hallazgo"), "¿Qué está mal?", "¿Qué esperabas?".
2. Al crearla, la API registra la solicitud, responde de inmediato y **arranca la sugerencia en segundo plano**. Se abre el detalle de la solicitud con "Generando sugerencia…".
3. La IA devuelve una propuesta estructurada (sección 6). Nuestro código la valida (sección 7) y arma el texto final de la regla.
4. El detalle muestra la **tarjeta de regla sugerida**: qué entendió la IA, la regla, sus criterios, el motivo, los choques y, por cada choque con una regla de producción o de esta misma solicitud, el **ajuste propuesto**. El ajuste es una **alternativa** a la regla nueva: es la regla existente reescrita para que cubra lo que pidió el usuario sin chocar, así que aprobarlo solo ya resuelve la solicitud. La IA indica cuál opción recomienda.
5. El usuario, por cada opción: **Aprobar**, **Editar y aprobar**, o la ignora. Puede **Pedir otra** (con una indicación opcional, por ejemplo "más específica") o **Descartar** la sugerencia.
6. Aprobar guarda el cambio **directamente en el borrador** (como "Guardar borrador") y la solicitud pasa a `en_prueba`, igual que hoy.
7. Desde aquí, sin cambios: Playground → Funcionó / No funcionó → Publicar.

También se puede pedir una sugerencia en solicitudes ya existentes no cerradas (botón **Sugerir regla con IA** en el borrador).

Si la IA falla, la tarjeta muestra el error con **Pedir otra**, y el usuario sigue pudiendo usar "Agregar regla" a mano.

```
┌ Regla sugerida por IA ─────────────────────── Recomendada ┐
│ Entendí: no debe exigirse firma física en planes.         │
│ Cuando el plan no tenga firma física, valida su vigencia   │
│ por el código y la versión del pie de página.   [C1]      │
│ Motivo: el hallazgo exigía firma aunque el pie es válido.  │
│ [Aprobar] [Editar y aprobar]                               │
├ Choques ───────────────────────────────────────────────────┤
│ ⚠ Se solapa con R-3 (producción): …                        │
│   Ajuste propuesto de R-3: “…”     [Aprobar ajuste] [Editar]│
│ ⚠ Se solapa con regla nueva del borrador #14: …  (aviso)   │
├────────────────────────────────────────────────────────────┤
│ [Pedir otra]  [Descartar]                                  │
└────────────────────────────────────────────────────────────┘
```

## 5. Qué recibe la IA (instrucción estructurada)

El prompt de sugerencia es **nuestro** y tiene estructura fija. Vive fuera de `src/prompt/` (por ejemplo `src/config-ia/suggestion-prompt.js`) para no tocar los hashes protegidos.

**Sistema** (fijo):
- Rol: redactor de reglas para un auditor IA de lineamientos institucionales.
- Cómo se usan las reglas: se agregan al final del prompt del criterio, bajo `REGLAS ADICIONALES (OBLIGATORIAS)`, en **una sola línea**; no pueden cambiar el formato de salida JSON.
- **Siempre se propone una regla.** Si la IA duda de que una regla sea la solución, igual la escribe y lo explica en `advertencias` con uno de estos tipos: `contradice_texto_base` (lo pedido choca con `REGLAS_COMUNES` de `_base.js` o con el texto base del criterio), `hallazgo_parece_correcto` (el resultado original parece bien fundado), `problema_de_entrada` (parece un problema de lectura del documento u OCR, o de una evidencia faltante), `otra`.
- Pautas de redacción: una regla = una conducta; general y reutilizable (no menciona el código del requerimiento, nombres de archivos ni el caso puntual salvo que sea indispensable); lenguaje imperativo; sin inventar normativa.
- Qué es un choque: `contradice` (piden conductas opuestas), `duplica` (dicen lo mismo), `se_solapa` (cubren parte del mismo caso con distinto alcance).
- Cuándo proponer ajuste: para reglas de **producción** y para reglas del **borrador de esta misma solicitud**; nunca para reglas de borradores de otras solicitudes. El ajuste es el texto completo nuevo de esa regla, reescrito para que **incluya la conducta que pidió el usuario** y deje de chocar. Es una alternativa a la regla nueva: aprobar solo el ajuste debe bastar.
- Recomendación: si hay un choque `contradice` o `duplica` con ajuste posible, recomendar el ajuste (evita dos reglas que se contradicen o se repiten); si no, recomendar la regla nueva.
- Formato de salida JSON estricto (sección 6).

**Usuario** (datos de la solicitud, en bloques etiquetados):
- Criterio de la solicitud: nombre y su prompt base completo (`SYSTEM_PROMPT` del criterio).
- Los seis criterios: nombre y su sección "CRITERIO A EVALUAR", para que elija a cuáles aplica la regla.
- Requerimiento: código y tipo.
- Hallazgo copiado (`fila_copia`) o la indicación "falta un hallazgo en este criterio".
- "Qué está mal" y "Qué esperaba".
- Reglas existentes, cada una con código, texto, criterios, estado y origen:
  - producción (activas e inactivas);
  - reglas nuevas y cambios del borrador de **esta** solicitud (marcadas como tales; incluye reglas aprobadas de sugerencias anteriores);
  - reglas nuevas o editadas en borradores de **otras** solicitudes abiertas (con su número).
- Si es "Pedir otra": la indicación del usuario y la sugerencia anterior.

No se envían las evidencias completas: el hallazgo copiado ya trae la cita literal.

## 6. Qué devuelve la IA

```json
{
  "entendimiento": "Qué hay que corregir, en 1-2 frases.",
  "regla": {
    "cuando": "condición en la que aplica",
    "hacer": "conducta que debe seguir el auditor",
    "excepto": "excepción, o null",
    "criterios": [1],
    "motivo": "por qué esta regla corrige el caso"
  },
  "choques": [
    {
      "codigo": "R-3",
      "origen": "produccion | esta_solicitud | otra_solicitud",
      "solicitud_numero": 14,
      "tipo": "contradice | duplica | se_solapa",
      "explicacion": "…",
      "ajuste": { "texto": "…", "criterios": [1, 3], "motivo": "…" }
    }
  ],
  "recomendacion": "regla_nueva | R-3",
  "advertencias": [
    { "tipo": "contradice_texto_base | hallazgo_parece_correcto | problema_de_entrada | otra", "explicacion": "…" }
  ]
}
```

`regla` es siempre obligatoria: la IA no puede declinar. Las dudas van en `advertencias`.

Nuestro código arma el texto de la regla nueva: `Cuando <cuando>, <hacer>. Excepción: <excepto>.` (sin la parte de excepción si es null), en una línea.

## 7. Validación de la sugerencia

Determinista, después de la respuesta de la IA:
- JSON parseable (`parseLlmJsonObject`) y con la forma de la sección 6.
- Texto armado y textos de ajuste: una línea, 1–2000 caracteres (mismas reglas que `normalizeText` de `draft.js`).
- Criterios válidos (`normalizeCriteria`).
- Choques: se descartan los que citan un código inexistente en la lista enviada. El `origen` se corrige con nuestros datos (no se confía en el de la IA). `ajuste` solo se acepta si el origen real es `produccion` o `esta_solicitud`; en choques con otras solicitudes se ignora.
- Si el criterio de la solicitud no está entre los criterios de la regla, se agrega una advertencia visible (no se fuerza).
- `recomendacion` debe ser `regla_nueva` o el código de un choque con ajuste válido; si no, se toma `regla_nueva`.
- Si algo esencial falla (sin JSON, sin `cuando`/`hacer`, sin criterios válidos): la sugerencia queda en `error` con "La IA no devolvió una sugerencia válida. Pide otra o escribe la regla a mano." La respuesta cruda queda guardada.

La revisión de choques es la de la IA; no hay comparación de texto adicional.

## 8. Aprobar: cómo entra al borrador

- **Regla nueva:** agrega al borrador un cambio `{ op: 'crear', texto, criterios, motivo, autor, sugerencia_id }`. El servidor asigna el código `R-n` como hoy.
- **Ajuste de R-x:** agrega `{ op: 'modificar', codigo: 'R-x', texto, criterios, antes, motivo, autor, sugerencia_id }`, con `antes` tomado de la regla de producción. Si el borrador ya tenía un cambio sobre R-x, **lo reemplaza** conservando su `antes` original (mismo criterio que hoy usa `DraftEditor`).
- **Ajuste de una regla de esta solicitud** (por ejemplo, R-20 creada desde una sugerencia anterior): reemplaza ese cambio del borrador (texto, criterios, motivo, `sugerencia_id`) conservando su código; se muestra como "Reemplaza R-20 en el borrador".
- **"Pedir otra" después de haber aprobado una regla:** el caso típico es aprobar R-20, probar, obtener "No funcionó" y pedir otra. La nueva sugerencia recibe R-20 como regla de esta solicitud y propone su reemplazo como ajuste de R-20 (recomendado), en lugar de acumular una segunda regla. La regla nueva sigue disponible como opción aparte.
- **Editar y aprobar:** igual, con el texto, los criterios o el motivo que el usuario corrigió; se registra que fue editado.
- Cada opción se aprueba por separado; aprobar una no bloquea las demás. Es decisión del usuario; el Playground mostrará el efecto. Si el usuario aprueba la regla nueva habiendo un choque `contradice` sin resolver, la tarjeta lo advierte ("R-3 ordena lo contrario; considera aprobar el ajuste") sin bloquear.
- `validateChanges` debe conservar `sugerencia_id` (hoy reconstruye el objeto y lo descartaría). No entra en la huella de reglas (`rulesFingerprint`), así que no altera la lógica de publicación.
- Aprobar se hace en el servidor y en una transacción (bloqueo de la solicitud como en `saveDraft`). Si el editor del borrador tiene cambios sin guardar, los botones de aprobar se deshabilitan con "Guarda o descarta los cambios del borrador antes de aprobar".
- **Sugerencia desactualizada:** si la versión de producción cambió desde que se generó (otra publicación), no se puede aprobar; se muestra "Producción cambió; pide otra sugerencia".
- Al publicar, el historial de la regla (`ia_reglas_historial`) muestra que provino de una sugerencia de IA y quién la aprobó.

## 9. Ejecución (enfoque A)

- La llamada a OpenAI la hace **la API directamente, fuera de la cola** (`tareas_procesamiento`). La cola y su regla de una tarea a la vez no cambian.
- `POST /api/config-ia/requests` crea la solicitud, inserta la sugerencia en `generando`, responde `201` sin esperar y lanza la generación en segundo plano. Cualquier error queda guardado en la sugerencia, nunca rompe la creación.
- La pantalla consulta el detalle cada pocos segundos mientras la sugerencia está `generando` (polling como el resto de la app).
- Una sola sugerencia `generando` por solicitud. "Pedir otra" marca la anterior como `reemplazada`.
- Tiempo límite propio, más corto que el de análisis. Una sugerencia `generando` más vieja que ese límite (por ejemplo, si la API se reinició) se muestra como error "Se interrumpió; pide otra".
- Modelo y esfuerzo configurables en `.env`: `SUGERENCIA_MODEL` y `SUGERENCIA_REASONING_EFFORT` (valores iniciales `gpt-5.4` y `medium`), validados en `src/config/runtime.js`, en `.env.example`, `scripts/check-config.js` y la tabla del README.
- Para poder probarlo, la función que llama al modelo se inyecta (como `llm` en el worker); `buildServer` acepta una implementación simulada.

## 10. Datos y trazabilidad

Tabla nueva `ia_sugerencias` en `src/platform/schema.sql` (InnoDB, utf8mb4, JSON, `CHAR(36)`). Contenido mínimo:
- solicitud, quién la pidió, indicación opcional ("Pedir otra"), versión de producción base;
- estado: `generando`, `lista`, `error`, `aprobada`, `descartada`, `reemplazada`;
- modelo, esfuerzo, mensajes enviados (sistema y usuario), respuesta cruda, uso, duración, error;
- propuesta validada (sección 6, con el texto armado);
- aprobaciones: qué opción, si fue editada, texto final, autor, fecha.

No se usa `llamadas_llm` porque exige una tarea de la cola (`tarea_id NOT NULL`).

Eventos nuevos en `ia_solicitud_eventos`: `sugerencia_creada`, `sugerencia_aprobada`, `sugerencia_descartada` (con el detalle de qué se aprobó).

## 11. API

Bajo `/api/config-ia/…`:
- `POST /requests`: además de crear la solicitud, arranca la sugerencia; responde también su id.
- `POST /requests/:id/suggestions`: pedir una sugerencia (o "otra") con `{ autor, indicacion? }`; responde `202`.
- `GET /requests/:id`: incluye la última sugerencia no reemplazada y su estado.
- `POST /suggestions/:id/approve`: `{ autor, opcion: 'regla_nueva' | 'R-x', texto?, criterios?, motivo? }`; devuelve el detalle de la solicitud.
- `POST /suggestions/:id/discard`: `{ autor }`.

Los nombres exactos quedan a criterio de quien construye.

## 12. Pantallas

- **Nueva solicitud:** sin cambios de campos. Debajo de "¿Qué esperabas?" una línea: "La IA usará esto para sugerir la regla". El botón sigue siendo "Crear solicitud".
- **Detalle de la solicitud:** la tarjeta "Regla sugerida por IA" va entre "Resultado original" y el borrador (mockup de la sección 4). Estados: generando, lista, error, desactualizada, aprobada (resumen de lo aprobado).
- **Advertencias de la IA:** se muestran destacadas arriba de la regla, en lenguaje cotidiano (por ejemplo "Ojo: esto contradice una regla fija del análisis: …" o "Parece un problema de lectura del documento, no de las instrucciones: …"). No bloquean la aprobación.
- **Borrador:** las reglas que vienen de una sugerencia llevan la marca "Sugerida por IA". Se agrega el botón **Sugerir regla con IA** junto a "Agregar regla".
- **Tour y README/documentación:** actualizar el paso de Config IA y la sección del README.

Lenguaje cotidiano, como el resto de la sección.

## 13. Pruebas automáticas

- **Unitarias:** armado del texto de la regla (una línea, sin excepción vacía, límite de largo); validación de la respuesta de la IA (JSON roto, códigos inexistentes descartados, `origen` corregido con nuestros datos, ajuste solo en producción o en esta solicitud, criterios inválidos, advertencias con tipo válido, advertencia si falta el criterio de la solicitud, recomendación inválida → `regla_nueva`); conversión de una aprobación a cambio del borrador (crear, modificar con `antes`, reemplazo de un cambio previo sobre la misma regla conservando `antes`); `validateChanges` conserva `sugerencia_id` y la huella no cambia.
- `tests/fixtures/prompt-hashes.json` se mantiene sin cambios.
- **Integración** (MySQL aislado, IA simulada): crear solicitud → sugerencia lista; aprobar regla nueva y ajuste → borrador correcto y solicitud `en_prueba`; respuesta inválida → `error` y la solicitud existe; IA que falla no afecta la creación; producción cambia → aprobación bloqueada; "Pedir otra" reemplaza la anterior; una prueba del Playground con la regla aprobada funciona como hoy; la sugerencia no crea tareas en la cola.
- **E2E** (Playwright, API simulada): crear solicitud → ver "Generando…" → ver la sugerencia con un choque → aprobar el ajuste → verlo en el borrador con la marca "Sugerida por IA".

## 14. Enfoques considerados

| Enfoque | Qué es | Por qué sí / por qué no |
|---|---|---|
| **A. Llamada directa, guardada en la solicitud** (elegido) | La API llama a OpenAI fuera de la cola; la sugerencia se guarda en una tabla propia y la pantalla consulta su estado. | No espera detrás de un análisis, sobrevive a cerrar la ventana, sirve para solicitudes existentes y deja traza de qué propuso la IA y qué se aprobó. Costo: traza en tabla propia (no en `llamadas_llm`) y una sugerencia interrumpida por reinicio queda en error. |
| B. Por la cola con prioridad alta | Tarea nueva en `tareas_procesamiento`. | Reutiliza la traza actual, pero la cola atiende una tarea a la vez: la sugerencia esperaría minutos si hay un criterio en curso. Va contra el objetivo de avanzar rápido. |
| C. En el formulario, antes de crear | Sugerencia generada en el modal, sin guardar. | La más simple, pero se pierde al cerrar, no deja traza y no sirve para solicitudes existentes. |

## 15. Decisiones tomadas

**Del usuario**
- La IA toma lo que dice el usuario y redacta la regla; el usuario la aprueba y con eso se prueba.
- Mejora del flujo, no reemplazo.
- La IA revisa si la regla choca con otra ya escrita.
- Si choca, la IA avisa **y propone el ajuste** de la regla existente; el usuario elige qué aprobar.
- Enfoque A: llamada directa, guardada en la solicitud.
- La IA **siempre** propone una regla; si duda (contradice el texto base, el hallazgo parece correcto, problema de lectura), lo advierte de forma visible sin bloquear.
- La instrucción a la IA es nuestra y estructurada.

**Decisiones mías** (revisar)
- La sugerencia se genera automáticamente al crear la solicitud; también se puede pedir en solicitudes existentes.
- Estructura de la regla: *Cuando… , hacer… . Excepción: …*, armada por nuestro código en una línea.
- Choques revisados contra producción y contra el borrador de esta solicitud (con ajuste propuesto), y contra otros borradores abiertos (solo aviso).
- El ajuste es una alternativa que incorpora lo pedido; la IA lo recomienda ante `contradice` o `duplica`.
- "Pedir otra" tras aprobar una regla propone reemplazarla (ajuste de la propia regla) en vez de acumular otra.
- Aprobar guarda directo en el borrador; cada opción se aprueba por separado.
- "Pedir otra" acepta una indicación opcional.
- Sugerencia bloqueada si producción cambió desde que se generó.
- Modelo propio configurable (`SUGERENCIA_MODEL`, inicial `gpt-5.4` / `medium`).
- No se envían las evidencias completas a la IA de sugerencias.
- "¿Qué esperabas?" sigue siendo opcional, con una pista de que mejora la sugerencia.

## 16. A criterio de quien construye
- Esquema exacto de la tabla y nombres de rutas.
- Cómo extraer la sección "CRITERIO A EVALUAR" de cada criterio para el prompt.
- Valor exacto del tiempo límite de la sugerencia y del intervalo de consulta.
- Componentes y estilos de la tarjeta, siguiendo `configia.css` y `ui.tsx`.
