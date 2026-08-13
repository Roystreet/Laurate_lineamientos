import ExcelJS from 'exceljs';

/**
 * Convierte un valor de celda de ExcelJS a string legible, manejando los tipos
 * "ricos" (richText, fórmulas, hipervínculos, fechas, errores) para evitar que
 * terminen como "[object Object]" en el texto/markdown resultante.
 */
function cellToString(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t?.text ?? '').join('');
    if (v.text != null) return cellToString(v.text);
    if ('result' in v) return cellToString(v.result); // celda con fórmula → su resultado
    if (v.hyperlink != null) return String(v.hyperlink);
    if (v.error != null) return String(v.error);
    return ''; // objeto desconocido: preferible vacío a "[object Object]"
  }
  return String(v);
}

export async function parseXlsx(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheets = [];
  const lines = [];
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values.slice(1).map(cellToString);
      rows.push(values);
    });
    sheets.push({ name: ws.name, rows });
    lines.push(`# ${ws.name}`);
    for (const r of rows) lines.push(r.join(' | '));
    lines.push('');
  });
  return { text: lines.join('\n'), meta: { sheets: sheets.map((s) => s.name) }, sheets };
}
