/**
 * Keyword colour support.
 *
 * Colours are resolved in three tiers:
 *   1. an explicit per-keyword colour (`keywordColors`),
 *   2. otherwise the default for the keyword's group (`keywordGroupColors`),
 *   3. otherwise the theme accent (handled by `styles.css`).
 *
 * The resolved colour is applied as the `--todoseq-keyword-color` CSS custom
 * property on the keyword element itself. `styles.css` maps that property onto
 * the actual `color` declaration, so no stylesheet has to be created at
 * runtime.
 */

/** Name of the CSS custom property carrying the keyword colour. */
export const KEYWORD_COLOR_PROPERTY = '--todoseq-keyword-color';

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNCTION_COLOR_RE = /^(?:rgb|rgba|hsl|hsla)\([0-9a-zA-Z.,%\s/+-]+\)$/;
const NAMED_COLOR_RE = /^[a-zA-Z]+$/;
const CSS_VAR_RE = /^var\(--[a-zA-Z0-9-]+\)$/;

/**
 * Normalise and validate a user-supplied colour.
 *
 * Only a conservative allow-list is accepted (hex, rgb/rgba, hsl/hsla, CSS
 * named colours and a single `var(--name)` reference). Anything containing
 * braces, semicolons, comments or quotes is rejected so a stored value can
 * never break out of the declaration.
 *
 * @returns The trimmed colour, or `null` when it is empty or unsafe.
 */
export function sanitizeKeywordColor(
  color: string | null | undefined,
): string | null {
  if (typeof color !== 'string') {
    return null;
  }
  const trimmed = color.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (
    HEX_COLOR_RE.test(trimmed) ||
    FUNCTION_COLOR_RE.test(trimmed) ||
    NAMED_COLOR_RE.test(trimmed) ||
    CSS_VAR_RE.test(trimmed)
  ) {
    return trimmed;
  }
  return null;
}

/**
 * Resolve the configured per-keyword colour, or `null` when the keyword has no
 * valid keyword-level colour configured.
 */
export function resolveKeywordColor(
  colors: Record<string, string> | null | undefined,
  keyword: string,
): string | null {
  if (!colors) {
    return null;
  }
  const normalized = keyword.trim().toUpperCase();
  return sanitizeKeywordColor(colors[normalized] ?? colors[keyword]);
}

/**
 * Resolve the configured group colour, or `null` when the group has no valid
 * colour configured.
 */
export function resolveGroupColor(
  groupColors: Partial<Record<string, string>> | null | undefined,
  group: string | null | undefined,
): string | null {
  if (!groupColors || !group) {
    return null;
  }
  return sanitizeKeywordColor(groupColors[group]);
}

/**
 * Apply the colour to a keyword element via the shared CSS custom property.
 * Passing `null` removes any previously set colour so the fallback applies.
 */
export function applyKeywordColor(el: HTMLElement, color: string | null): void {
  if (color) {
    el.setCssProps({ [KEYWORD_COLOR_PROPERTY]: color });
  } else {
    el.style.removeProperty(KEYWORD_COLOR_PROPERTY);
  }
}

/**
 * Style-attribute payload for CodeMirror decorations, which cannot call
 * `setCssProps`. Returns `undefined` when no colour is configured.
 */
export function keywordColorStyleAttribute(
  color: string | null | undefined,
): string | undefined {
  const safe = sanitizeKeywordColor(color);
  return safe ? `${KEYWORD_COLOR_PROPERTY}: ${safe}` : undefined;
}
