/**
 * TABLE card content encoding + clipboard parsing (Excel / Google Sheets / TSV).
 * Ported from the PouetPouet reference (`lib/table-clipboard.ts`).
 *
 * A TABLE card's `content` is JSON `{ rows: string[][], colW?: number[] }`; the
 * first row is rendered as a header.
 */

export interface TableData {
  rows: string[][];
  /** Column widths as fractions summing to 1 (length = column count). Absent ⇒ equal. */
  colW?: number[];
}

const DEFAULT_ROWS: string[][] = [
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
];

/** Serializes a table to its card content string. */
export function serializeTable(rows: string[][], colW?: number[]): string {
  const data: TableData = { rows };
  if (colW) {
    data.colW = colW;
  }
  return JSON.stringify(data);
}

/** Normalizes a fractions array to `cols` entries summing to 1 (equal by default). */
export function normalizeColW(colW: number[] | undefined, cols: number): number[] {
  if (!colW || colW.length !== cols || colW.some((w) => !(w > 0))) {
    return new Array(cols).fill(1 / cols);
  }
  const sum = colW.reduce((a, b) => a + b, 0);
  return colW.map((w) => w / sum);
}

/** Pads every row to the widest column count (widest row wins). */
export function normalizeRows(rows: string[][]): string[][] {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  return rows.map((r) => {
    const copy = [...r];
    while (copy.length < cols) {
      copy.push('');
    }
    return copy;
  });
}

/** Parses a TABLE card's content into normalized rows + column widths. */
export function parseTableContent(content: string): { rows: string[][]; colW: number[] } {
  try {
    const data = JSON.parse(content) as Partial<TableData>;
    if (Array.isArray(data.rows) && data.rows.length > 0 && data.rows.every((r) => Array.isArray(r))) {
      const rows = normalizeRows(data.rows.map((r) => r.map((c) => String(c ?? ''))));
      return { rows, colW: normalizeColW(data.colW, rows[0].length) };
    }
  } catch {
    /* invalid content → default grid */
  }
  const rows = DEFAULT_ROWS.map((r) => [...r]);
  return { rows, colW: normalizeColW(undefined, rows[0].length) };
}

/** Parses an HTML table (Excel / Google Sheets / web-page paste). */
function parseHtmlTable(html: string): string[][] | null {
  if (!html || typeof DOMParser === 'undefined') {
    return null;
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) {
    return null;
  }
  const rows: string[][] = [];
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const cells = Array.from(tr.querySelectorAll('th,td')).map((c) =>
      (c.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    if (cells.length > 0) {
      rows.push(cells);
    }
  }
  return rows.length > 0 ? normalizeRows(rows) : null;
}

/** Parses TSV (rows `\n`, cells `\t`); only returns a table if a tab is present. */
function parseTsv(text: string): string[][] | null {
  if (!text || !text.includes('\t')) {
    return null;
  }
  const lines = text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const rows = lines.map((l) => l.split('\t'));
  return rows.length > 0 ? normalizeRows(rows) : null;
}

/** Detects a table in the clipboard: HTML first, then TSV. */
export function parseClipboardTable(
  html: string | undefined,
  text: string | undefined,
): string[][] | null {
  return parseHtmlTable(html ?? '') ?? parseTsv(text ?? '');
}
