import { App, TFile } from 'obsidian';
import {
  collectVaultTags,
  filterTagSuggestions,
  getTagTokenAtCursor,
} from '../src/view/components/tag-input-suggest';

describe('getTagTokenAtCursor', () => {
  test('returns the tag token under the cursor', () => {
    expect(getTagTokenAtCursor('hello #wo', 9)).toEqual({
      start: 6,
      end: 9,
      query: 'wo',
    });
  });

  test('returns the token when the cursor is inside it', () => {
    expect(getTagTokenAtCursor('ab #tagg cd', 7)).toEqual({
      start: 3,
      end: 8,
      query: 'tagg',
    });
  });

  test('returns an empty query for a lone hash', () => {
    expect(getTagTokenAtCursor('#', 1)).toEqual({
      start: 0,
      end: 1,
      query: '',
    });
    expect(getTagTokenAtCursor('#ta', 3)).toEqual({
      start: 0,
      end: 3,
      query: 'ta',
    });
  });

  test('stops at punctuation after the tag', () => {
    expect(getTagTokenAtCursor('see #tag, next', 8)).toEqual({
      start: 4,
      end: 8,
      query: 'tag',
    });
  });

  test('supports nested and dashed tag characters', () => {
    expect(getTagTokenAtCursor('x #ctx/bureau-y', 15)).toEqual({
      start: 2,
      end: 15,
      query: 'ctx/bureau-y',
    });
  });

  test('does not treat a mid-word hash as a tag', () => {
    expect(getTagTokenAtCursor('a#b', 3)).toBeNull();
  });

  test('returns null when no tag is under the cursor', () => {
    expect(getTagTokenAtCursor('hello world', 5)).toBeNull();
    expect(getTagTokenAtCursor('', 0)).toBeNull();
    expect(getTagTokenAtCursor('hello world', -1)).toBeNull();
    expect(getTagTokenAtCursor('hello', 99)).toBeNull();
  });
});

describe('filterTagSuggestions', () => {
  const tags = ['#work', '#home', '#workout', '#weekend'];

  test('prefix matches case-insensitively', () => {
    expect(filterTagSuggestions(tags, 'wo')).toEqual(['#work', '#workout']);
    expect(filterTagSuggestions(tags, 'WORK')).toEqual(['#work', '#workout']);
  });

  test('an empty query returns all tags up to the limit', () => {
    expect(filterTagSuggestions(tags, '')).toEqual(tags);
    expect(filterTagSuggestions(tags, '', 2)).toEqual(['#work', '#home']);
  });

  test('returns nothing when there is no match', () => {
    expect(filterTagSuggestions(tags, 'zzz')).toEqual([]);
  });

  test('normalises tags without a leading hash', () => {
    expect(filterTagSuggestions(['work'], 'wo')).toEqual(['#work']);
  });
});

describe('collectVaultTags', () => {
  function makeApp(caches: Record<string, { tags?: string[] }>): App {
    const files = Object.keys(caches).map((path) => {
      const file = new TFile();
      file.path = path;
      file.name = path;
      file.extension = 'md';
      return file;
    });
    return {
      vault: { getMarkdownFiles: () => files },
      metadataCache: {
        getFileCache: (file: TFile) => caches[file.path] ?? null,
      },
    } as unknown as App;
  }

  test('collects, dedupes and sorts tags from file caches', () => {
    const app = makeApp({
      'a.md': { tags: ['#work', '#home'] },
      'b.md': { tags: ['#work', '#zz'] },
      'c.md': {},
    });
    expect(collectVaultTags(app)).toEqual(['#home', '#work', '#zz']);
  });

  test('is defensive when the app has no vault or cache', () => {
    expect(collectVaultTags({} as App)).toEqual([]);
  });
});
