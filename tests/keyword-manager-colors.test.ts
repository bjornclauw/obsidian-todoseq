import { KeywordManager } from '../src/utils/keyword-manager';

describe('KeywordManager.getKeywordColor', () => {
  test('returns null when no colours are configured', () => {
    const manager = new KeywordManager({});
    expect(manager.getKeywordColor('TODO')).toBeNull();
  });

  test('falls back to the group colour', () => {
    const manager = new KeywordManager({
      keywordGroupColors: {
        inactiveKeywords: '#4c8dff',
        activeKeywords: '#ff9f43',
      },
    });
    expect(manager.getKeywordColor('TODO')).toBe('#4c8dff');
    expect(manager.getKeywordColor('DOING')).toBe('#ff9f43');
    // A keyword with no matching group/colour resolves to null.
    expect(manager.getKeywordColor('NOT-A-KEYWORD')).toBeNull();
  });

  test('an explicit per-keyword colour overrides the group colour', () => {
    const manager = new KeywordManager({
      keywordColors: { TODO: '#000000' },
      keywordGroupColors: { inactiveKeywords: '#4c8dff' },
    });
    expect(manager.getKeywordColor('TODO')).toBe('#000000');
    // Other inactive keywords still use the group colour.
    expect(manager.getKeywordColor('LATER')).toBe('#4c8dff');
  });

  test('ignores invalid configured colours', () => {
    const manager = new KeywordManager({
      keywordColors: { TODO: 'not a colour;' },
      keywordGroupColors: { inactiveKeywords: 'also bad;' },
    });
    expect(manager.getKeywordColor('TODO')).toBeNull();
  });

  test('static wrapper resolves via the supplied settings', () => {
    expect(
      KeywordManager.getKeywordColor('DONE', {
        keywordGroupColors: { completedKeywords: '#2ecc71' },
      }),
    ).toBe('#2ecc71');
  });
});
