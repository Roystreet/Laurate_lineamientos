# Step 5 — Consolidar Hallazgos

## Objetivo
Unificar todos los Excel de hallazgos generados por el Step 2 (uno por requerimiento) en un único Excel global.

## Entrada
- `data/inmutable/lineamiento-hallazgo/<codigo>/<codigo>.xlsx`

## Salida
- `data/inmutable/consolidado/consolidado.xlsx`

## Estructura
Las mismas 9 columnas canónicas del Step 2 (`n_req`, `requerimiento`, `lineamiento_1`, `lineamiento_2`, `lineamiento_3`, `razonamiento_previo`, `tipo_hallazgo`, `criterio_afectado`, `hallazgo`). No se modifican; solo se concatenan filas.

## Comando
```bash
npm run step:5
```

## Notas
- El step **no llama al LLM**; solo lee y consolida.
- Si una carpeta no tiene Excel, se omite silenciosamente.
- El archivo destino se sobrescribe en cada corrida.
