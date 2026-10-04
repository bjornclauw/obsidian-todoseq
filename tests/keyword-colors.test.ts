/**
 * @jest-environment jsdom
 */

import {
  KEYWORD_COLOR_PROPERTY,
  applyKeywordColor,
  keywordColorStyleAttribute,
  resolveGroupColor,
  resolveKeywordColor,
  sanitizeKeywordColor,
} from '../src/utils/keyword-colors';
import { installObsidianDomMocks } from './helpers/obsidian-dom-mock';

describe('sanitizeKeywordColor', () => {
  test('accepts hex, rgb/hsl, named colours and theme variables', () => {
    expect(sanitizeKeywordColor('#fff')).toBe('#fff');
    expect(sanitizeKeywordColor('  #A1B2C3  ')).toBe('#A1B2C3');
    expect(sanitizeKeywordColor('#11223344')).toBe('#11223344');
    expect(sanitizeKeywordColor('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
    expect(sanitizeKeywordColor('hsl(120 50% 50%)')).toBe('hsl(120 50% 50%)');
    expect(sanitizeKeywordColor('tomato')).toBe('tomato');
    expect(sanitizeKeywordColor('var(--color-blue)')).toBe('var(--color-blue)');
  });

  test('rejects empty, unsafe and malformed values', () => {
    expect(sanitizeKeywordColor(undefined)).toBeNull();
    expect(sanitizeKeywordColor(null)).toBeNull();
    expect(sanitizeKeywordColor('')).toBeNull();
    expect(sanitizeKeywordColor('   ')).toBeNull();
    expect(sanitizeKeywordColor('red; } body { background: black')).toBeNull();
    expect(sanitizeKeywordColor('url(evil.png)')).toBeNull();
    expect(sanitizeKeywordColor('var(--x); color: red')).toBeNull();
    expect(sanitizeKeywordColor('#12')).toBeNull();
  });
});

describe('resolveKeywordColor', () => {
  test('returns null when no map is provided', () => {
    expect(resolveKeywordColor(undefined, 'TODO')).toBeNull();
    expect(resolveKeywordColor(null, 'TODO')).toBeNull();
    expect(resolveKeywordColor({}, 'TODO')).toBeNull();
  });

  test('looks up keywords case-insensitively and validates the value', () => {
    expect(resolveKeywordColor({ TODO: '#ff0000' }, 'todo')).toBe('#ff0000');
    expect(resolveKeywordColor({ TEAM: '#0f0' }, 'TEAM')).toBe('#0f0');
    expect(resolveKeywordColor({ TEAM: 'nope;' }, 'TEAM')).toBeNull();
  });
});

describe('resolveGroupColor', () => {
  test('returns null for missing group or map', () => {
    expect(resolveGroupColor(undefined, 'activeKeywords')).toBeNull();
    expect(resolveGroupColor({}, 'activeKeywords')).toBeNull();
    expect(resolveGroupColor({ activeKeywords: '#fff' }, null)).toBeNull();
  });

  test('returns the validated group colour', () => {
    expect(
      resolveGroupColor({ activeKeywords: '#ff9f43' }, 'activeKeywords'),
    ).toBe('#ff9f43');
    expect(
      resolveGroupColor({ activeKeywords: 'bad;' }, 'activeKeywords'),
    ).toBeNull();
  });
});

describe('applyKeywordColor', () => {
  beforeAll(() => {
    installObsidianDomMocks();
  });

  test('sets the shared CSS custom property', () => {
    const el = document.createElement('span');
    applyKeywordColor(el, '#ff0000');
    expect(el.style.getPropertyValue(KEYWORD_COLOR_PROPERTY)).toBe('#ff0000');
  });

  test('removes the property when cleared so the fallback applies', () => {
    const el = document.createElement('span');
    applyKeywordColor(el, '#ff0000');
    applyKeywordColor(el, null);
    expect(el.style.getPropertyValue(KEYWORD_COLOR_PROPERTY)).toBe('');
  });
});

describe('keywordColorStyleAttribute', () => {
  test('returns a style payload only for a valid colour', () => {
    expect(keywordColorStyleAttribute('#123456')).toBe(
      '--todoseq-keyword-color: #123456',
    );
    expect(keywordColorStyleAttribute('var(--color-green)')).toBe(
      '--todoseq-keyword-color: var(--color-green)',
    );
    expect(keywordColorStyleAttribute(null)).toBeUndefined();
    expect(keywordColorStyleAttribute('bad;')).toBeUndefined();
  });
});
