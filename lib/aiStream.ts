// Incremental extraction of test cases from a streamed tool call.
//
// While the model writes its answer it streams the tool input as text
// fragments of ONE json document: {"cases":[{...},{...},...]}. The fragments
// split anywhere -- mid-word, mid-string, mid-escape. This pulls each case out
// the moment its closing brace arrives, so the UI can show cases one by one
// instead of waiting for the whole answer.
//
// Pure and dependency-free so it can be tested exhaustively on its own.

export class CaseStreamParser {
  private buf = '';
  private pos = 0;
  private inArray = false;
  private done = false;
  private depth = 0;
  private inStr = false;
  private esc = false;
  private objStart = -1;

  /** Feed the next fragment; returns every case object completed by it. */
  push(chunk: string): unknown[] {
    if (this.done) return [];
    this.buf += chunk;

    if (!this.inArray) {
      // Find the start of the "cases" array.
      const m = /"cases"\s*:\s*\[/.exec(this.buf);
      if (!m) return [];
      this.inArray = true;
      this.pos = m.index + m[0].length;
    }

    const out: unknown[] = [];
    for (; this.pos < this.buf.length; this.pos++) {
      const ch = this.buf[this.pos];
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (ch === '\\') this.esc = true;
        else if (ch === '"') this.inStr = false;
        continue;
      }
      if (ch === '"') {
        this.inStr = true;
      } else if (ch === '{') {
        if (this.depth === 0) this.objStart = this.pos;
        this.depth++;
      } else if (ch === '}') {
        this.depth--;
        if (this.depth === 0 && this.objStart >= 0) {
          try {
            out.push(JSON.parse(this.buf.slice(this.objStart, this.pos + 1)));
          } catch {
            // A malformed object is skipped; the rest of the stream is still usable.
          }
          this.objStart = -1;
          // Drop what has been consumed so the buffer stays small on long answers.
          this.buf = this.buf.slice(this.pos + 1);
          this.pos = -1;
        }
      } else if (ch === ']' && this.depth === 0) {
        this.done = true;
        break;
      }
    }
    return out;
  }
}
