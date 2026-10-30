// Turns a file the user drops into the AI panels into something the model can read:
// plain text for anything text-like (.md, .txt, .csv, .json, .html, .docx, .pptx,
// .xlsx, ...), or a base64 attachment for PDFs and images, which the model reads
// natively. Browser-only (File, DecompressionStream).
import * as XLSX from 'xlsx';
import { MAX_REQUIREMENT_CHARS } from '@/lib/aiLimits';

export type ReferenceFile =
  | { kind: 'text'; name: string; text: string }
  | { kind: 'attach'; name: string; mediaType: string; data: string; size: number };

export const MAX_ATTACH_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
const ATTACH_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('could not be read'));
    r.readAsDataURL(file);
  });
}

function stripMarkup(s: string): string {
  return s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

// ─── Minimal .zip reader (Word / PowerPoint files are zips of XML) ─────────

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntries(
  buf: ArrayBuffer,
  want: (name: string) => boolean,
): Promise<{ name: string; text: string }[]> {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  // End of central directory record.
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('is not a valid document');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: { name: string; text: string }[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = u8.subarray(start, start + csize);
    const bytes = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
    if (bytes) out.push({ name, text: dec.decode(bytes) });
  }
  return out;
}

async function docxText(file: File): Promise<string> {
  const [doc] = await readZipEntries(await file.arrayBuffer(), n => n === 'word/document.xml');
  if (!doc) throw new Error('has no readable text');
  return doc.text
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function pptxText(file: File): Promise<string> {
  const slides = await readZipEntries(await file.arrayBuffer(), n =>
    /^ppt\/slides\/slide\d+\.xml$/.test(n),
  );
  slides.sort((a, b) => Number(a.name.match(/\d+/)![0]) - Number(b.name.match(/\d+/)![0]));
  return slides
    .map((s, i) => {
      const parts = Array.from(s.text.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map(m => m[1]);
      return `Slide ${i + 1}\n${parts.join('\n')}`
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
    })
    .join('\n\n')
    .trim();
}

async function sheetText(file: File): Promise<string> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return wb.SheetNames.map(n => `Sheet: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`)
    .join('\n\n')
    .trim();
}

/**
 * Reads any file the user gives as a reference document. Anything that is not text,
 * PDF, an image, Word, PowerPoint or a spreadsheet is tried as text and refused only
 * if it turns out to be binary.
 */
export async function readReferenceFile(file: File): Promise<ReferenceFile> {
  const ext = extOf(file.name);
  const fail = (why: string) => new Error(`${file.name} ${why}.`);

  if (ATTACH_TYPES.includes(file.type)) {
    if (file.size > MAX_ATTACH_BYTES) throw fail('is too large (5 MB max)');
    return {
      kind: 'attach',
      name: file.name,
      mediaType: file.type,
      data: await readAsBase64(file),
      size: file.size,
    };
  }
  if (file.size > MAX_TEXT_FILE_BYTES) throw fail('is too large (5 MB max)');

  let text: string;
  try {
    if (ext === 'docx') text = await docxText(file);
    else if (ext === 'pptx') text = await pptxText(file);
    else if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) text = await sheetText(file);
    else if (ext === 'doc' || ext === 'ppt' || ext === 'pages' || ext === 'key')
      throw fail('is an old binary format; save it as .docx / .pptx / PDF and try again');
    else {
      text = await file.text();
      // Binary files decode to NULs / replacement characters.
      const sample = text.slice(0, 4000);
      if (sample.includes('\u0000') || (sample.match(/�/g)?.length ?? 0) > 20)
        throw fail('is not a text document the AI can read');
      if (['html', 'htm', 'xml', 'svg'].includes(ext)) text = stripMarkup(text);
    }
  } catch (e) {
    throw e instanceof Error && e.message.startsWith(file.name) ? e : fail('could not be read');
  }
  text = text.trim();
  if (!text) throw fail('has no text in it');
  return { kind: 'text', name: file.name, text };
}

/** Joins the text parts of several reference files, labelled by file name. */
export function joinReferenceText(parts: { name: string; text: string }[]): string {
  return parts.map(p => (parts.length > 1 ? `### ${p.name}\n${p.text}` : p.text)).join('\n\n');
}

export { MAX_REQUIREMENT_CHARS };
