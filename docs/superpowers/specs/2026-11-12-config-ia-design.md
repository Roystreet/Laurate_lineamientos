# Config IA — diseño

Fecha: 2026-11-12
Proyecto: `proyecto/` (plataforma "Análisis documental", DACI Lineamientos)

## 1. Intención

Hoy el prompt con el que la IA analiza los requerimientos está escrito en el código (`src/prompt/criterios/`). Cada vez que un hallazgo sale mal, corregirlo significa editar código, volver a desplegar y no tener forma ordenada de comprobar si la corrección empeora otros casos.

**Config IA** es una nueva sección de la plataforma para mejorar el análisis de forma rápida, controlada y trazable:

- Las personas de lineamientos registran **solicitudes de mejora** cuando un hallazgo no les parece correcto.
- Cada solicitud se convierte en **reglas o restricciones** que se suman al prompt del criterio correspondiente.
- Antes de pasar a producción, los cambios se prueban en un **playground** que compara producción contra el borrador, sobre el caso de origen y sobre otros casos de control.
- Lo que se publica queda como una **versión numerada** del análisis, con historial completo. Cada análisis registra con qué versión se hizo.

Esto cambia cómo se analiza la data: el análisis deja de depender solo del código desplegado y pasa a depender de **texto base fijo + versión de reglas publicada**.

## 2. Usuarios y roles

Usan la sección tres grupos: el responsable del producto, el equipo técnico y el personal de lineamientos, que no programa.

- **Lineamientos:** escribe solicitudes, revisa las comparaciones del playground, marca si el cambio "funcionó" o "no funcionó" y **puede publicar**.
- **Técnico:** convierte la solicitud en reglas, arma y ejecuta las pruebas, y **puede publicar**.

No hay usuarios, sesiones ni permisos (decisión explícita: "de momento sin usuarios"). Quien realiza una acción escribe su nombre a mano en un campo de texto. Ese nombre se guarda en todo registro de historial. Cualquiera con acceso a la URL puede publicar; es un riesgo aceptado por ahora.

## 3. Objetivos, no objetivos y antiobjetivos

**Objetivos**
- Editar reglas por criterio sin tocar código ni redesplegar.
- Probar cualquier cambio en vivo y compararlo lado a lado con producción antes de publicarlo.
- Activar y desactivar reglas para medir el efecto de cada una.
- Mantener el historial de reglas, solicitudes y versiones, y saber qué versión produjo cada análisis.

**No objetivos**
- Editar el texto base del prompt (rol, reglas comunes existentes, instrucción del criterio, formato de salida). Sigue en código.
- Usuarios, roles, autenticación.
- Volver a analizar automáticamente los análisis anteriores al publicar una versión nueva.
- Cambiar modelo, esfuerzo de razonamiento u otros parámetros de `.env` desde la interfaz.
- Cambiar el formato de los Excel ni de las filas de resultado.
- Que la IA proponga mejoras por sí misma.

**Antiobjetivos** (situaciones que serían un fracaso aunque el código funcione)
- Que una regla rompa el formato JSON de salida y deje de generarse un Excel.
- Que el playground altere Resultados, los Excel oficiales o el catálogo.
- Que no se pueda saber con qué reglas exactas se generó un análisis.
- Que un borrador en prueba afecte un análisis de producción.

## 4. Conceptos

| Concepto | Definición |
|---|---|
| **Texto base** | El prompt actual de cada criterio, en `src/prompt/criterios/`. Es inmutable desde la interfaz. Sus hashes siguen protegidos por `tests/fixtures/prompt-hashes.json`. |
| **Regla** | Texto breve (restricción o instrucción) que se aplica a **uno o varios criterios** (C1–C6). Tiene identificador visible (`R-12`) e historial de cambios. |
| **Versión** | Conjunto inmutable de reglas, cada una con su texto, sus criterios y su estado activo/inactivo, numerado `v1`, `v2`, … Solo una está **en producción**. |
| **v1** | La versión inicial, **sin reglas adicionales**: equivale exactamente a cómo se analiza hoy. Las "reglas de negocio" de `_base.js` siguen siendo parte del texto base. |
| **Solicitud** | Pedido de mejora escrito por una persona, ligado al hallazgo que estuvo mal. Tiene su propio **borrador**. |
| **Borrador** | Copia de trabajo de las reglas, basada en la versión de producción, con los cambios de **una sola solicitud**. Hay un borrador por solicitud. |
| **Prueba** | Ejecución en el playground de producción contra el borrador sobre los casos elegidos. Sus resultados son aislados. |

## 5. Cómo entran las reglas al prompt

Decisión del usuario: el texto base queda fijo y las reglas se agregan **al final**.

- Para cada criterio, el prompt de sistema es: `texto base del criterio` + un bloque final de reglas adicionales con **solo las reglas activas que aplican a ese criterio** en la versión usada.
- Si ninguna regla activa aplica al criterio, el prompt queda **idéntico byte a byte** al actual (esto garantiza que v1 = comportamiento actual).
- El bloque lleva un encabezado fijo, por ejemplo:
  `REGLAS ADICIONALES (OBLIGATORIAS) — Aplica estas reglas al evaluar. No modifican el FORMATO DE SALIDA ESTRICTO definido arriba.`
  seguido de las reglas en orden por identificador, con el formato `- [R-12] <texto>`.
- La inyección se hace **fuera** de los archivos de `src/prompt/`, en el punto donde se llama a `criterio.build(buildArgs)` (`evaluarCriterio` en `src/steps/2-procesar-requerimiento/index.js`), así no cambian los hashes protegidos ni la CLI existente.
- Aplica igual a C1, cuya salida es un objeto, y a C2–C6, que devuelven arreglos.
- Las reglas se limitan a criterios; no hay reglas por tipo de requerimiento. La aplicabilidad de criterios por tipo (`CRITERIOS[].aplicaA`) no cambia.

## 6. Pantallas

Se agrega **Config IA** como quinta sección de la navegación, junto a Requerimientos, Evidencias, Análisis y Resultados. Está organizada **por pestañas** (opción A elegida).

### 6.1 Pestaña Reglas
- Arriba: versión en producción (`v7 · publicada <fecha> por <nombre>`).
- Lista de todas las reglas: identificador, texto, criterios, estado en producción (activa, inactiva o solo en borradores) y versión desde la que existe.
- Filtros por criterio y por estado; búsqueda por texto.
- Al abrir una regla se ve su **historial**: creación, ediciones de texto, cambio de criterios, activación y desactivación, cada una con nombre, fecha, motivo y solicitud de origen.
- Crear, editar o desactivar una regla **no cambia producción**. Siempre ocurre dentro del borrador de una solicitud (ver 7.3).

### 6.2 Pestaña Solicitudes
- Lista de solicitudes con estado, autor, fecha, criterio y requerimiento ligados.
- **Crear solicitud:** nombre de quien escribe, descripción de qué está mal y qué se esperaba, y la **liga al hallazgo**: buscar requerimiento → elegir análisis → criterio → hallazgo. Si el problema es que *falta* un hallazgo, se liga al criterio de ese requerimiento en ese análisis, sin hallazgo específico.
- Al abrir una solicitud se ve: el hallazgo original completo, su borrador (reglas nuevas, editadas, activadas o desactivadas respecto de producción), las pruebas realizadas y sus veredictos.
- Estados: `pendiente` → `en prueba` → `funcionó` / `no funcionó` → `publicada` o `rechazada` (con motivo). Una solicitud marcada "no funcionó" puede volver a `en prueba` tras ajustar su borrador.

### 6.3 Pestaña Playground
Mockup de referencia (aprobado en la conversación):

- **Armar la prueba**
  - Comparar: producción `vN` contra el borrador de una solicitud. También se puede comparar contra cualquier versión publicada anterior.
  - Reglas del borrador con casillas: se pueden **apagar o encender solo para esta prueba** sin modificar el borrador.
  - Casos: el **caso de origen** de la solicitud (preseleccionado y marcado) más los **requerimientos de control que elija quien prueba** en ese momento (no existe un grupo fijo). Solo requerimientos que ya tengan un análisis.
  - Criterios a ejecutar: por defecto, los criterios que tocan las reglas cambiadas o apagadas; se pueden agregar otros manualmente.
  - Botón **Ejecutar prueba**, con progreso en vivo como el análisis actual.
- **Resultado: lado a lado** (opción A elegida). Por cada caso y criterio, dos columnas completas: producción a la izquierda y borrador a la derecha, con estado (Cumple / No cumple) y todos los hallazgos o evaluaciones de consideración. El caso de origen va primero.
- **Decisión** (al pie): nombre de quien revisa, **Funcionó** / **No funcionó**, comentario. Con "Funcionó" se habilita **Publicar como vN+1**.

### 6.4 Pestaña Historial
- Lista de versiones publicadas: número, fecha, quién publicó, solicitud de origen, diferencias con la versión anterior (reglas agregadas, editadas, activadas o desactivadas) y cantidad de análisis hechos con ella.
- Ver las reglas exactas de cualquier versión.
- **Volver atrás:** "Republicar como versión nueva" crea `vN+1` con las mismas reglas que una versión anterior. El historial nunca se borra. Es una **acción directa de emergencia**: no exige borrador, prueba ni veredicto, pero pide nombre y motivo, y la versión queda con origen "reversión a vK" en lugar de una solicitud. Igual que una publicación normal, los borradores abiertos pasan a la nueva base y quedan "requiere volver a probar".

### 6.5 Cambios en pantallas existentes
- **Resultados** (detalle de análisis): muestra "Analizado con vN". Los análisis anteriores a esta función muestran "Anterior a Config IA" (o `v1`, ver 12).
- **Análisis:** muestra qué versión se usará ("Se analizará con v7").

## 7. Flujos

### 7.1 Flujo principal
1. Una persona de lineamientos ve un hallazgo incorrecto en Resultados.
2. En **Config IA › Solicitudes** crea la solicitud y la liga al hallazgo.
3. Una persona técnica abre la solicitud y edita su borrador (agrega, edita, activa o desactiva reglas).
4. Ejecuta una prueba en el **Playground** con el caso de origen y los controles que elija.
5. La persona de lineamientos revisa la comparación lado a lado y marca **Funcionó** o **No funcionó**.
6. Con "Funcionó", alguien de cualquiera de los dos grupos **publica**. Se crea `vN+1`, pasa a producción y la solicitud queda `publicada`.
7. Los análisis que se inicien desde ese momento usan la nueva versión.

### 7.2 Publicación
- Publicar exige que la última prueba del borrador esté marcada "Funcionó" y que **se haya ejecutado sobre la versión de producción actual** (si producción cambió después, hay que volver a probar).
- El veredicto solo habilita la publicación si la prueba usó **exactamente las reglas que se van a publicar**: cada prueba guarda una huella del conjunto de reglas usado. Una prueba con reglas apagadas solo para esa prueba es **exploratoria** y no habilita publicar. Cualquier edición del borrador después de la prueba invalida el veredicto. La prueba válida debe incluir todos los criterios que toca el cambio.
- Publicar es atómico: crea la versión inmutable, la marca como producción y registra quién, cuándo y la solicitud de origen.
- Un análisis en curso termina con la versión con la que empezó.

### 7.3 Borradores concurrentes
- Hay un borrador por solicitud y varios pueden estar abiertos a la vez.
- El borrador guarda **los cambios** respecto de su base, no una copia completa.
- Al publicar una versión nueva, los demás borradores abiertos pasan a basarse en la nueva producción conservando sus propios cambios, y se marcan "**requiere volver a probar**" (su veredicto anterior deja de habilitar la publicación).
- Si un cambio del borrador ya no tiene sentido sobre la nueva base (por ejemplo, edita una regla que la otra publicación desactivó), se muestra como conflicto para resolver a mano en el borrador.

## 8. Ejecución de pruebas

- Una prueba usa las **mismas entradas congeladas** que el análisis original de cada caso: ficha, evidencias (versiones exactas) y catálogo relacionado, tomados del `snapshot` de esa ejecución. Así la comparación es justa.
- Del lado "producción" **se reutiliza el resultado guardado** del análisis original solo si coinciden la versión de reglas, el código del motor (`motor_id`) y el modelo y esfuerzo (`configuracion`); si algo difiere, se ejecuta también, para que la comparación solo refleje el efecto de las reglas. Para esta reutilización, un análisis anterior a Config IA cuenta como `v1` (no tenía reglas); en pantalla sigue mostrándose como "Anterior a Config IA".
- Del lado "borrador" se ejecutan solo los criterios seleccionados.
- Mismo modelo y esfuerzo que el análisis (`ANALISIS_MODEL`, `ANALISIS_REASONING_EFFORT`), mismo parseo de filas (`rowsFromC1` / `rowsFromGenerico`).
- **Aislamiento:** los resultados de pruebas se guardan aparte. No aparecen en Resultados, no generan Excel y no cuentan como análisis de la versión.
- Las llamadas a OpenAI de las pruebas se registran igual que hoy (trazabilidad de prompts, respuestas, uso y tiempos).
- **Las pruebas esperan su turno** (decisión del usuario). La plataforma procesa una sola tarea a la vez (`claim()` en `src/platform/queue.js`) y eso **no cambia**. Una prueba siempre se puede lanzar: queda en la misma cola con **menor prioridad** que la preparación de documentos y los análisis, y se procesa cuando no hay lotes en proceso. Lanzar una prueba no bloquea iniciar un análisis (las pruebas quedan fuera de la regla de "un análisis a la vez" de `startRun`); si llega un análisis, pasa por delante de las tareas de prueba que aún no empezaron.
- Para que un análisis no espere mucho detrás de una prueba, la prueba se divide en tareas pequeñas (por ejemplo, una por caso, criterio y lado). La pantalla muestra "En espera: hay un análisis en curso" cuando corresponda.
- Límite por prueba: hasta 10 casos, igual que el análisis.

## 9. Trazabilidad y datos

- Cada análisis guarda el identificador de la **versión de reglas** usada, además de la `versiones_motor` actual (que sigue registrando el código).
- Cada llamada a OpenAI ya guarda los mensajes enviados (`llamadas_llm.mensajes`), así que el prompt efectivo con reglas queda registrado.
- Registros con historial (append-only, sin borrado): cambios de reglas, versiones publicadas, solicitudes y sus cambios de estado, pruebas y veredictos. Cada registro guarda nombre, fecha y motivo o comentario cuando aplica.
- Liga solicitud → hallazgo: referencia al resultado de criterio y a la posición de la fila (`hallazgos.resultado_id` + `orden`, o `evaluaciones_consideracion`), más una **copia del contenido de la fila** al momento de crear la solicitud, por si el resultado se reintenta y se reescribe (`saveResult` borra y reinserta filas).
- Tablas nuevas en `src/platform/schema.sql`, mismas convenciones (InnoDB, utf8mb4, JSON, `CHAR(36)`). Los nombres y la forma exacta quedan a criterio de quien construye.

## 10. API

Rutas nuevas bajo `/api/config-ia/…`, mismas convenciones que la API actual: Fastify, ejecución asíncrona con `202 Accepted` y progreso por consulta. Mínimo necesario:

- Versiones: listar, ver una, versión en producción, publicar desde un borrador, republicar una anterior.
- Reglas: listar con filtros, historial de una regla.
- Solicitudes: crear, listar, ver, cambiar estado (rechazar), editar borrador.
- Búsqueda para ligar hallazgos: requerimiento → análisis → criterio → filas.
- Pruebas: crear y ejecutar, consultar progreso y resultado lado a lado, registrar veredicto.

`GET /api/config` y `GET /api/runs/:id` incluyen la versión de reglas (producción y la usada, respectivamente).

## 11. Pruebas automáticas

- `tests/fixtures/prompt-hashes.json` **se mantiene**: el texto base no cambia.
- Nuevas pruebas unitarias: armado del prompt con reglas (sin reglas = idéntico al actual; solo reglas activas del criterio; orden estable).
- Integración (MySQL aislado, como hoy): publicar, versión inmutable, análisis registra versión, borradores concurrentes que se actualizan y quedan "requiere volver a probar", publicación bloqueada sin veredicto "Funcionó" vigente, aislamiento de pruebas (no tocan Resultados ni reportes), una prueba se puede lanzar con un análisis activo y espera su turno, y un análisis nuevo pasa por delante de las tareas de prueba pendientes.
- E2E (Playwright, llamadas a OpenAI simuladas como hoy): crear solicitud ligada a un hallazgo, editar borrador, ejecutar prueba, ver lado a lado, marcar Funcionó, publicar, ver la versión en Resultados.

## 12. Migración

- Al iniciar con la nueva versión se crea `v1` vacía y se marca como producción.
- Los análisis existentes quedan sin versión de reglas. Se muestran como "Anterior a Config IA". Su comportamiento fue equivalente a v1, pero no se les atribuye retroactivamente, igual que la plataforma ya hace con las ejecuciones históricas importadas.

## 13. Decisiones tomadas

**Del usuario**
- Sección llamada **Config IA**, organizada por pestañas: Reglas, Solicitudes, Playground, Historial.
- Las mejoras las escribe una persona que ve un resultado incorrecto; la IA no propone mejoras.
- Texto base fijo; las reglas se suman **al final** del prompt.
- Cada regla indica **a qué criterio(s)** aplica.
- Un **borrador por solicitud**, para configurar progresivamente.
- La solicitud se crea en **Solicitudes** y se **liga al hallazgo** que estuvo mal.
- Probar en el **caso de origen y en otros** para comprobar que no se afectaron. Los controles **los elige quien prueba** en cada ocasión.
- La comparación se ve **lado a lado**.
- **Lineamientos marca si funcionó o no**. Tanto técnico como lineamientos **pueden publicar**.
- **Sin usuarios** por ahora; el nombre se escribe a mano.
- Las pruebas **esperan su turno**: se procesan cuando no hay lotes en proceso; no se cambia el procesamiento de una tarea a la vez.

**Decisiones mías** (revisar)
- v1 = sin reglas = comportamiento actual; las reglas comunes de `_base.js` siguen siendo texto base.
- Encabezado fijo del bloque de reglas que recuerda no alterar el formato de salida.
- Cambiar producción siempre pasa por borrador → prueba → publicar, incluso para desactivar una regla.
- Volver atrás = republicar una versión anterior como versión nueva, como acción directa de emergencia sin prueba, con nombre y motivo.
- Publicar exige veredicto "Funcionó" sobre la producción vigente y con exactamente las reglas a publicar (las pruebas con reglas apagadas son exploratorias); editar el borrador invalida el veredicto; al publicar, los otros borradores se actualizan y requieren volver a probarse.
- Las pruebas usan las entradas congeladas del análisis original, reutilizan el resultado de producción solo si coinciden reglas, motor y modelo (lo anterior a Config IA cuenta como v1 para esto), y quedan aisladas.
- Por defecto solo se ejecutan los criterios que toca el cambio.
- Una solicitud por "hallazgo faltante" se liga al criterio del requerimiento.
- Copia del hallazgo al crear la solicitud.
- Análisis previos quedan como "Anterior a Config IA".

## 14. A criterio de quien construye
- Esquema exacto de tablas y nombres de rutas.
- Componentes de la interfaz, siguiendo el estilo actual (`web/src/style.css`, `experience.css`, `ui.tsx`) y su lenguaje cotidiano para el personal de lineamientos; actualizar el tour con la nueva sección.
- Cómo mostrar el progreso de una prueba (polling como el resto de la app).
- Paginación de listas.
- Actualizar `README.md` y `documentacion/`.
