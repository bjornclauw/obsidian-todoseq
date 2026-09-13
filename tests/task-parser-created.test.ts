import { TaskParser } from '../src/parser/task-parser';
import { createTestKeywordManager } from './helpers/test-helper';

/**
 * Tests for CREATED line parsing.
 * Pattern: tests/task-parser-started.test.ts (parseFile-based).
 */
describe('TaskParser - CREATED date parsing', () => {
  const keywordManager = createTestKeywordManager();
  const parser = TaskParser.create(keywordManager, null);

  describe('parseFile', () => {
    it('parses createdDate from a CREATED: line after the task', () => {
      const content = `- [ ] TODO Buy groceries\nCREATED: [2026-01-15 Thu 09:00]`;
      const tasks = parser.parseFile(content, 'test.md');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].createdDate).toBeTruthy();
      expect(tasks[0].createdDate!.getFullYear()).toBe(2026);
      expect(tasks[0].createdDate!.getMonth()).toBe(0);
      expect(tasks[0].createdDate!.getDate()).toBe(15);
      expect(tasks[0].createdDate!.getHours()).toBe(9);
      expect(tasks[0].createdDate!.getMinutes()).toBe(0);
    });

    it('keeps parsing the date lines below a CREATED line (CREATED is first)', () => {
      const content = [
        '- [ ] TODO Full lifecycle',
        'CREATED: [2026-01-01 Wed 08:00]',
        'STARTED: [2026-01-15 Thu 09:00]',
        'SCHEDULED: <2026-01-10 Sat>',
        'DEADLINE: <2026-01-25 Sun>',
        'CLOSED: [2026-01-18 Sun 17:30]',
      ].join('\n');
      const tasks = parser.parseFile(content, 'test.md');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].createdDate!.getDate()).toBe(1);
      expect(tasks[0].startedDate!.getDate()).toBe(15);
      expect(tasks[0].scheduledDate!.getDate()).toBe(10);
      expect(tasks[0].deadlineDate!.getDate()).toBe(25);
      expect(tasks[0].closedDate!.getDate()).toBe(18);
    });

    it('has createdDate null when no CREATED line exists', () => {
      const content = `- [ ] TODO No created date\nSCHEDULED: <2026-01-20 Tue>`;
      const tasks = parser.parseFile(content, 'test.md');
      expect(tasks[0].createdDate ?? null).toBeNull();
      expect(tasks[0].scheduledDate).toBeTruthy();
    });

    it('ignores CREATED line with incorrect (shallower) indent', () => {
      const content = `    - [ ] TODO Nested task\nCREATED: [2026-01-15 Thu 09:00]`;
      const tasks = parser.parseFile(content, 'test.md');
      expect(tasks[0].createdDate ?? null).toBeNull();
    });

    it('first CREATED line wins when multiple present', () => {
      const content = `- [ ] TODO Multiple creates\nCREATED: [2026-01-10 Sat 08:00]\nCREATED: [2026-01-15 Thu 12:00]`;
      const tasks = parser.parseFile(content, 'test.md');
      expect(tasks[0].createdDate!.getDate()).toBe(10);
      expect(tasks[0].createdDate!.getHours()).toBe(8);
    });

    it('parses quoted (callout) CREATED line', () => {
      const content = `> - [ ] TODO Quoted task\n> CREATED: [2026-01-15 Thu 09:00]`;
      const tasks = parser.parseFile(content, 'test.md');
      expect(tasks[0].createdDate).toBeTruthy();
      expect(tasks[0].createdDate!.getDate()).toBe(15);
    });
  });
});
