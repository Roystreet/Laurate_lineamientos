# Step 3 — Generar Excel por Requerimiento

## Objetivo
Generar un archivo `.xlsx` por cada requerimiento con sus lineamientos asociados.

## Entrada
- `data/mutable/requerimientos/<codigo>/`
- `data/mutable/lineamientos/req_<codigo>/*.md`

## Salida
- `data/matriz-lineamientos/req_<codigo>.xlsx`

## Columnas
| Requerimiento | ID Lineamiento | Fuente | Contenido (preview) |

## Comando
- `npm run step:3`
