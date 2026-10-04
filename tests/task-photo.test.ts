import {
  extractPhotoTarget,
  imageMatchesQuery,
  isImagePath,
} from '../src/utils/task-photo';

describe('extractPhotoTarget', () => {
  test('extracts the target from a wikilink embed', () => {
    expect(extractPhotoTarget('![[attachments/leak.webp]]')).toBe(
      'attachments/leak.webp',
    );
    expect(extractPhotoTarget('![[leak.webp|400]]')).toBe('leak.webp');
    expect(extractPhotoTarget('[[leak.webp]]')).toBe('leak.webp');
  });

  test('extracts the target from a markdown embed', () => {
    expect(extractPhotoTarget('![](attachments/leak.png)')).toBe(
      'attachments/leak.png',
    );
    expect(extractPhotoTarget('![alt](leak.jpg)')).toBe('leak.jpg');
  });

  test('accepts a bare path', () => {
    expect(extractPhotoTarget('attachments/plain.png')).toBe(
      'attachments/plain.png',
    );
  });

  test('returns null for empty input', () => {
    expect(extractPhotoTarget('')).toBeNull();
    expect(extractPhotoTarget('   ')).toBeNull();
  });
});

describe('isImagePath', () => {
  test('matches common image extensions (case-insensitive)', () => {
    expect(isImagePath('a/b/photo.PNG')).toBe(true);
    expect(isImagePath('photo.webp')).toBe(true);
    expect(isImagePath('photo.jpeg')).toBe(true);
    expect(isImagePath('notes.md')).toBe(false);
  });
});

describe('imageMatchesQuery', () => {
  test('empty query matches everything', () => {
    expect(imageMatchesQuery('a/b/photo.png', '')).toBe(true);
    expect(imageMatchesQuery('a/b/photo.png', '   ')).toBe(true);
  });

  test('matches case-insensitively on the full path', () => {
    expect(imageMatchesQuery('Attachments/Leak-2026.PNG', 'leak')).toBe(true);
    expect(imageMatchesQuery('Attachments/Leak-2026.PNG', 'attachments')).toBe(
      true,
    );
    expect(imageMatchesQuery('Attachments/Leak-2026.PNG', 'holiday')).toBe(
      false,
    );
  });
});
