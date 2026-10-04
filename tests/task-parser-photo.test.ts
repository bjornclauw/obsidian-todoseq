import { TaskParser } from '../src/parser/task-parser';
import { createTestKeywordManager } from './helpers/test-helper';

/**
 * Tests for PHOTO line parsing (task image embeds).
 */
describe('TaskParser - PHOTO line parsing', () => {
  const keywordManager = createTestKeywordManager();
  const parser = TaskParser.create(keywordManager, null);

  describe('parseFile', () => {
    it('parses the photo embed from a PHOTO: line after the task', () => {
      const content =
        '- [ ] TODO Fix the leak\nPHOTO: ![[attachments/leak.webp]]';
      const tasks = parser.parseFile(content, 'test.md');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].photo).toBe('![[attachments/leak.webp]]');
    });

    it('keeps parsing date lines below a PHOTO line', () => {
      const content = [
        '- [ ] TODO With photo',
        'PHOTO: ![[img.webp]]',
        'SCHEDULED: <2026-01-10 Sat>',
        'DEADLINE: <2026-01-25 Sun>',
      ].join('\n');
      const tasks = parser.parseFile(content, 'test.md');
      expect(tasks[0].photo).toBe('![[img.webp]]');
      expect(tasks[0].scheduledDate!.getDate()).toBe(10);
      expect(tasks[0].deadlineDate!.getDate()).toBe(25);
    });

    it('is undefined when no PHOTO line exists', () => {
      const content = '- [ ] TODO No photo\nSCHEDULED: <2026-01-20 Tue>';
      const tasks = parser.parseFile(content, 'test.md');
      expect(tasks[0].photo).toBeUndefined();
    });

    it('parses a quoted (callout) PHOTO line', () => {
      const content = '> - [ ] TODO Quoted\n> PHOTO: ![[q.webp]]';
      const tasks = parser.parseFile(content, 'test.md');
      expect(tasks[0].photo).toBe('![[q.webp]]');
    });

    it('accepts a plain path (no wikilink) too', () => {
      const content = '- [ ] TODO Plain\nPHOTO: attachments/plain.png';
      const tasks = parser.parseFile(content, 'test.md');
      expect(tasks[0].photo).toBe('attachments/plain.png');
    });
  });
});
