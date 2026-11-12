export function frontMatter(meta = {}) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${escapeYaml(item)}`);
    } else {
      lines.push(`${k}: ${escapeYaml(v)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

function escapeYaml(v) {
  const s = String(v);
  if (/[:#\n"']/.test(s)) return JSON.stringify(s);
  return s;
}

export function heading(level, text) {
  return `${'#'.repeat(Math.max(1, Math.min(6, level)))} ${text}\n\n`;
}

export function paragraph(text) {
  return `${String(text).trim()}\n\n`;
}

export function bulletList(items) {
  return items.map((i) => `- ${i}`).join('\n') + '\n\n';
}

export function table(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map((c) => String(c ?? '').replace(/\|/g, '\\|')).join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n') + '\n\n';
}

export function codeBlock(content, lang = '') {
  return '```' + lang + '\n' + content + '\n```\n\n';
}

export function buildRequerimientoMd({ codigo, titulo, descripcion, contenido, fuente }) {
  return (
    frontMatter({
      tipo: 'requerimiento',
      codigo,
      titulo: titulo ?? '',
      fuente: fuente ?? '',
      generadoEn: new Date().toISOString(),
    }) +
    heading(1, `Requerimiento ${codigo}${titulo ? ` — ${titulo}` : ''}`) +
    (descripcion ? heading(2, 'Descripción') + paragraph(descripcion) : '') +
    heading(2, 'Contenido') +
    paragraph(contenido ?? '')
  );
}

export function buildLineamientoMd({ codigoReq, idLineamiento, titulo, contenido, fuente }) {
  return (
    frontMatter({
      tipo: 'lineamiento',
      requerimiento: codigoReq,
      id: idLineamiento,
      titulo: titulo ?? '',
      fuente: fuente ?? '',
      generadoEn: new Date().toISOString(),
    }) +
    heading(1, `Lineamiento ${idLineamiento} (req ${codigoReq})${titulo ? ` — ${titulo}` : ''}`) +
    heading(2, 'Contenido') +
    paragraph(contenido ?? '')
  );
}
