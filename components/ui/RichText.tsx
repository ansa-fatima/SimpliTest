'use client';

import { cn } from '@/lib/utils';

interface RichTextProps {
  /** Raw plain text (typically from a CSV import or textarea). */
  text: string;
  /** Optional className for the outer wrapper. */
  className?: string;
  /** Smaller text variant for use inside tight cards. */
  size?: 'sm' | 'base';
}

/**
 * Lightweight formatter for fields like Description / Preconditions / Expected
 * result that come from CSV imports or free-text inputs.
 *
 * Two modes (auto-detected):
 *   1) If the input contains HTML tags (e.g. <ul><li>…</li></ul>) — common in
 *      TestRail exports — we sanitize and render the HTML directly through the
 *      existing .rich-editor CSS class so bullets / numbered lists look native.
 *   2) Otherwise we parse plain-text patterns into structured blocks:
 *        • "- xyz" / "* xyz"     → bulleted list (groups consecutive lines)
 *        • "1. xyz" / "2. xyz"   → numbered list (groups consecutive lines)
 *        • "Word:"  (short title-case line ending with colon)
 *                                 → bold sub-heading
 *        • blank line             → paragraph break
 *        • everything else        → plain paragraph
 *
 * No external Markdown / sanitizer deps — small inline allowlist sanitizer.
 */
export function RichText({ text, className, size = 'sm' }: RichTextProps) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return <p className={cn('text-text-3', sizeClass(size))}>—</p>;

  // Mode 1: input contains HTML — sanitize and render.
  if (containsHtml(trimmed)) {
    return (
      <div
        className={cn('rich-editor text-text-2', sizeClass(size), className)}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(trimmed) }}
      />
    );
  }

  // Split into raw lines first, then group consecutive list lines.
  const rawLines = trimmed.split(/\r?\n/);

  type Block =
    | { kind: 'p'; lines: string[] }
    | { kind: 'ul'; items: string[] }
    | { kind: 'ol'; items: string[] }
    | { kind: 'heading'; text: string };

  const blocks: Block[] = [];

  const isBullet = (l: string) => /^\s*[-*•]\s+/.test(l);
  const isNumbered = (l: string) => /^\s*\d+[.)]\s+/.test(l);
  // Sub-headings: short line ending with ":" that doesn't read like a sentence.
  const isHeading = (l: string) => /^[A-Z][A-Za-z][A-Za-z0-9 /&-]{1,40}:\s*$/.test(l.trim());

  const stripBullet = (l: string) => l.replace(/^\s*[-*•]\s+/, '').trim();
  const stripNumber = (l: string) => l.replace(/^\s*\d+[.)]\s+/, '').trim();

  let buffer: string[] = [];
  const flushParagraph = () => {
    if (buffer.length > 0) {
      blocks.push({ kind: 'p', lines: buffer });
      buffer = [];
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }
    if (isHeading(line)) {
      flushParagraph();
      blocks.push({ kind: 'heading', text: line.trim().replace(/:\s*$/, '') });
      continue;
    }
    if (isBullet(line)) {
      flushParagraph();
      const items: string[] = [stripBullet(line)];
      while (i + 1 < rawLines.length && isBullet(rawLines[i + 1])) {
        items.push(stripBullet(rawLines[++i]));
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }
    if (isNumbered(line)) {
      flushParagraph();
      const items: string[] = [stripNumber(line)];
      while (i + 1 < rawLines.length && isNumbered(rawLines[i + 1])) {
        items.push(stripNumber(rawLines[++i]));
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }
    buffer.push(line);
  }
  flushParagraph();

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {blocks.map((b, idx) => {
        if (b.kind === 'heading') {
          return (
            <p
              key={idx}
              className={cn(
                'font-semibold text-text',
                size === 'sm' ? 'text-[12.5px]' : 'text-[14px]',
              )}
            >
              {b.text}
            </p>
          );
        }
        if (b.kind === 'ul') {
          return (
            <ul
              key={idx}
              className={cn('list-disc space-y-1 pl-5 marker:text-text-3', sizeClass(size))}
            >
              {b.items.map((item, i) => (
                <li key={i} className="text-text-2">
                  {item}
                </li>
              ))}
            </ul>
          );
        }
        if (b.kind === 'ol') {
          return (
            <ol
              key={idx}
              className={cn('list-decimal space-y-1 pl-5 marker:text-text-3', sizeClass(size))}
            >
              {b.items.map((item, i) => (
                <li key={i} className="text-text-2">
                  {item}
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={idx} className={cn('whitespace-pre-line text-text-2', sizeClass(size))}>
            {b.lines.join('\n')}
          </p>
        );
      })}
    </div>
  );
}

function sizeClass(size: 'sm' | 'base'): string {
  return size === 'sm' ? 'text-[13px] leading-relaxed' : 'text-[14px] leading-relaxed';
}

// Quick test for "looks like HTML" — at least one balanced/self-closing tag.
function containsHtml(s: string): boolean {
  return /<\/?[a-z][a-z0-9]*[^<>]*>/i.test(s);
}

// Minimal inline sanitizer — strips the obviously dangerous bits and unsafe attributes.
// Good enough for content the user pasted into their own workspace (not user-generated
// content from untrusted parties). For higher-risk inputs, swap in DOMPurify.
function sanitizeHtml(html: string): string {
  let out = html;
  // 1. Drop dangerous element pairs entirely (including content).
  out = out.replace(/<(script|style|iframe|object|embed|noscript)[\s\S]*?<\/\1>/gi, '');
  // 2. Drop any remaining void/orphan dangerous tags.
  out = out.replace(/<(script|style|iframe|object|embed|noscript|link|meta)\b[^>]*>/gi, '');
  // 3. Strip inline event handlers (onclick="...", etc.) — both quote styles + unquoted.
  out = out.replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '');
  out = out.replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '');
  // 4. Neutralise dangerous URL schemes inside href / src attributes.
  out = out.replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"');
  out = out.replace(/(href|src)\s*=\s*'javascript:[^']*'/gi, "$1='#'");
  out = out.replace(/(href|src)\s*=\s*"data:[^"]*"/gi, '$1="#"');
  return out;
}
