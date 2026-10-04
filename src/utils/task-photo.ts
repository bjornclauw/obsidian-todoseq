/**
 * Helpers for the `PHOTO:` task metadata line, whose value is an image embed
 * (`![[file.webp]]`, `![[file.webp|400]]`, `![](path)` or a bare path).
 */

/** Extract the link target (file path/name) from a stored photo value. */
export function extractPhotoTarget(link: string): string | null {
  const trimmed = link.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const wiki = /^!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(trimmed);
  if (wiki) {
    return wiki[1].trim() || null;
  }

  const md = /^!?\[[^\]]*\]\(([^)]+)\)$/.exec(trimmed);
  if (md) {
    return md[1].trim() || null;
  }

  // Bare path (no embed syntax).
  return trimmed;
}

/** Whether a file name/path looks like a renderable image. */
const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|heif)$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSION_RE.test(path);
}

/**
 * Case-insensitive match of an image's vault path against a free-text query.
 * An empty query matches everything.
 */
export function imageMatchesQuery(path: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return true;
  }
  return path.toLowerCase().includes(q);
}
