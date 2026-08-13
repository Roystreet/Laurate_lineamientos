import mammoth from 'mammoth';

export async function parseDocx(file) {
  const result = await mammoth.convertToMarkdown({ path: file });
  return { text: result.value, meta: {}, warnings: result.messages };
}
