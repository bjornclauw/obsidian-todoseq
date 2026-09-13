import { AbstractInputSuggest, getAllTags } from 'obsidian';
import type { App } from 'obsidian';

/** Characters allowed inside an Obsidian tag (after the `#`). */
const TAG_CHAR = /[\p{L}\p{N}_\-/]/u;

export interface TagToken {
  /** Index of the `#`. */
  start: number;
  /** Index just past the last character of the token. */
  end: number;
  /** Text typed after the `#` (used as the suggestion query). */
  query: string;
}

/**
 * Find the `#tag` token the cursor is currently in.
 *
 * Returns `null` when the cursor is not inside a tag. A tag must start at the
 * beginning of the text or after whitespace, so mid-word hashes like `a#b` are
 * ignored.
 */
export function getTagTokenAtCursor(
  value: string,
  cursor: number,
): TagToken | null {
  if (cursor < 0 || cursor > value.length) return null;

  let start = cursor;
  while (start > 0 && TAG_CHAR.test(value[start - 1])) start--;
  if (start > 0 && value[start - 1] === '#') {
    start -= 1;
  } else if (value[start] !== '#') {
    return null;
  }
  if (value[start] !== '#') return null;
  if (start > 0 && !/\s/.test(value[start - 1])) return null;

  let end = cursor;
  while (end < value.length && TAG_CHAR.test(value[end])) end++;

  const query = value.slice(start + 1, end);
  if (query.includes('#')) return null;
  return { start, end, query };
}

/**
 * Filter vault tags to those matching the typed query. Matching is a
 * case-insensitive prefix match on the tag name; an empty query returns all
 * tags up to `limit`.
 */
export function filterTagSuggestions(
  tags: readonly string[],
  query: string,
  limit = 50,
): string[] {
  const normalized = query.toLowerCase();
  const result: string[] = [];
  for (const tag of tags) {
    const name = tag.startsWith('#') ? tag.slice(1) : tag;
    if (name === '') continue;
    if (normalized === '' || name.toLowerCase().startsWith(normalized)) {
      result.push(`#${name}`);
      if (result.length >= limit) break;
    }
  }
  return result;
}

/** Collect every tag known to the metadata cache, deduped and sorted. */
export function collectVaultTags(app: App): string[] {
  const tags = new Set<string>();
  const files = app.vault?.getMarkdownFiles() ?? [];
  for (const file of files) {
    const cache = app.metadataCache?.getFileCache(file);
    if (!cache) continue;
    const fileTags = getAllTags(cache);
    if (!fileTags) continue;
    for (const tag of fileTags) tags.add(tag);
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

/**
 * Obsidian tag autocomplete for a text input.
 *
 * Typing `#` (or editing an existing tag) shows vault tag suggestions and
 * selecting one replaces the token under the cursor.
 */
export class TagInputSuggest extends AbstractInputSuggest<string> {
  private tagCache: string[] | null = null;
  private openState = false;

  constructor(
    app: App,
    private readonly inputEl: HTMLInputElement,
    private readonly tagsProvider?: () => string[],
  ) {
    super(app, inputEl);
  }

  /** Whether the suggestion popover is currently showing. */
  isOpen(): boolean {
    return this.openState;
  }

  override open(): void {
    this.openState = true;
    super.open();
  }

  override close(): void {
    this.openState = false;
    super.close();
  }

  protected getSuggestions(_query: string): string[] {
    const value = this.inputEl.value;
    const cursor = this.inputEl.selectionStart ?? value.length;
    const token = getTagTokenAtCursor(value, cursor);
    if (!token) {
      this.openState = false;
      return [];
    }
    if (this.tagCache === null) {
      this.tagCache = this.tagsProvider
        ? this.tagsProvider()
        : collectVaultTags(this.app);
    }
    const suggestions = filterTagSuggestions(this.tagCache, token.query);
    this.openState = suggestions.length > 0;
    return suggestions;
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    this.openState = true;
    el.setText(value);
  }

  selectSuggestion(value: string, _evt: MouseEvent | KeyboardEvent): void {
    const text = this.inputEl.value;
    const cursor = this.inputEl.selectionStart ?? text.length;
    const token = getTagTokenAtCursor(text, cursor);
    if (token) {
      const next = text.slice(0, token.start) + value + text.slice(token.end);
      this.setValue(next);
      const caret = token.start + value.length;
      this.inputEl.setSelectionRange(caret, caret);
    } else {
      this.setValue(value);
    }
    this.openState = false;
    this.close();
  }
}
