import { describe, expect, it } from 'vitest';
import {
  clampTableHeight,
  clampTableWidth,
  computeTableCardSize,
  decideTablePaste,
} from './table-clipboard';
import { MIN_H } from './board-constants';

const HTML_TABLE_2X2 = '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>';
const TSV_2X2 = 'a\tb\nc\td';
const PLAIN_NO_TAB = 'just a single line of text';

describe('table-clipboard: clamp dimensioning (§4.8)', () => {
  it('clamps width to the 180 floor for a single column', () => {
    expect(clampTableWidth(1)).toBe(180);
  });

  it('scales width linearly for a mid-range column count', () => {
    expect(clampTableWidth(3)).toBe(360);
  });

  it('clamps width to the 720 ceiling for a large column count', () => {
    expect(clampTableWidth(10)).toBe(720);
  });

  it('clamps height to the MIN_H floor for a single row', () => {
    expect(clampTableHeight(1)).toBe(MIN_H);
  });

  it('scales height linearly for a mid-range row count', () => {
    expect(clampTableHeight(10)).toBe(16 + 10 * 30);
  });

  it('clamps height to the 600 ceiling for a large row count', () => {
    expect(clampTableHeight(100)).toBe(600);
  });

  it('computeTableCardSize combines both clamps', () => {
    expect(computeTableCardSize(1, 1)).toEqual({ width: 180, height: MIN_H });
    expect(computeTableCardSize(50, 50)).toEqual({ width: 720, height: 600 });
  });
});

describe('table-clipboard: detection priority — HTML over TSV', () => {
  it('prefers an HTML <table> over a text/plain TSV payload when both are present', () => {
    const action = decideTablePaste({
      html: HTML_TABLE_2X2,
      text: 'ignored\tirrelevant',
      focusedTableCardId: null,
      singleSelectedTableCardId: null,
      isEditableFieldFocus: false,
    });
    expect(action.kind).toBe('create');
    if (action.kind === 'create') {
      expect(action.rows).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    }
  });

  it('falls back to TSV when no HTML table is present', () => {
    const action = decideTablePaste({
      text: TSV_2X2,
      focusedTableCardId: null,
      singleSelectedTableCardId: null,
      isEditableFieldFocus: false,
    });
    expect(action.kind).toBe('create');
    if (action.kind === 'create') {
      expect(action.rows).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    }
  });

  it('AC7 — text/plain with no tabulation is not recognized as a table: falls back to text', () => {
    const action = decideTablePaste({
      text: PLAIN_NO_TAB,
      focusedTableCardId: null,
      singleSelectedTableCardId: null,
      isEditableFieldFocus: false,
    });
    expect(action).toEqual({ kind: 'fallback-text', text: PLAIN_NO_TAB });
  });

  it('a 1x1 HTML table (single cell) is not tabular either — falls back to text via TSV/plain', () => {
    const action = decideTablePaste({
      html: '<table><tr><td>solo</td></tr></table>',
      text: 'solo',
      focusedTableCardId: null,
      singleSelectedTableCardId: null,
      isEditableFieldFocus: false,
    });
    expect(action).toEqual({ kind: 'fallback-text', text: 'solo' });
  });
});

describe('table-clipboard: fill vs create resolution (rank 4)', () => {
  it('fills the single selected TABLE card when exactly one is selected', () => {
    const action = decideTablePaste({
      text: TSV_2X2,
      focusedTableCardId: null,
      singleSelectedTableCardId: 'table-card-1',
      isEditableFieldFocus: false,
    });
    expect(action.kind).toBe('fill');
    if (action.kind === 'fill') {
      expect(action.cardId).toBe('table-card-1');
    }
  });

  it('creates a new dimensioned TABLE card when no TABLE card is selected', () => {
    const action = decideTablePaste({
      text: 'a\tb\tc\nd\te\tf',
      focusedTableCardId: null,
      singleSelectedTableCardId: null,
      isEditableFieldFocus: false,
    });
    expect(action.kind).toBe('create');
    if (action.kind === 'create') {
      expect(action.width).toBe(clampTableWidth(3));
      expect(action.height).toBe(clampTableHeight(2));
    }
  });
});

describe('table-clipboard: rank 1 (focused TABLE cell) vs rank 2 (editable field guard)', () => {
  it('rank 1 — a focused TABLE cell fills that card even though a plain field would no-op', () => {
    const action = decideTablePaste({
      text: TSV_2X2,
      focusedTableCardId: 'focused-card',
      singleSelectedTableCardId: null,
      isEditableFieldFocus: true,
    });
    expect(action).toEqual({
      kind: 'fill',
      cardId: 'focused-card',
      rows: [
        ['a', 'b'],
        ['c', 'd'],
      ],
    });
  });

  it('rank 2 — a non-table editable field focused with tabular content is a no-op (native paste)', () => {
    const action = decideTablePaste({
      text: TSV_2X2,
      focusedTableCardId: null,
      singleSelectedTableCardId: 'some-table',
      isEditableFieldFocus: true,
    });
    expect(action).toEqual({ kind: 'none' });
  });

  it('non-tabular paste while a TABLE cell is focused is a no-op (native single-cell edit)', () => {
    const action = decideTablePaste({
      text: PLAIN_NO_TAB,
      focusedTableCardId: 'focused-card',
      singleSelectedTableCardId: null,
      isEditableFieldFocus: false,
    });
    expect(action).toEqual({ kind: 'none' });
  });

  it('no clipboard content at all is a no-op', () => {
    const action = decideTablePaste({
      focusedTableCardId: null,
      singleSelectedTableCardId: null,
      isEditableFieldFocus: false,
    });
    expect(action).toEqual({ kind: 'none' });
  });
});
