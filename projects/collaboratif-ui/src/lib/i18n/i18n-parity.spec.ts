import fr from './fr.json';
import en from './en.json';

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' ? flatten(v as Record<string, unknown>, key) : [key];
  });
}

describe('scope whiteboard i18n', () => {
  it('a exactement les mêmes clés en fr et en', () => {
    const frKeys = new Set(flatten(fr as Record<string, unknown>));
    const enKeys = new Set(flatten(en as Record<string, unknown>));
    const onlyFr = [...frKeys].filter(k => !enKeys.has(k));
    const onlyEn = [...enKeys].filter(k => !frKeys.has(k));
    expect(onlyFr, `clés seulement en fr: ${onlyFr.join(', ')}`).toEqual([]);
    expect(onlyEn, `clés seulement en en: ${onlyEn.join(', ')}`).toEqual([]);
  });

  it('contient la clé signalée whiteboard.board.untitled (via board.untitled)', () => {
    expect((fr as { board: { untitled?: string } }).board.untitled).toBeTruthy();
  });
});
