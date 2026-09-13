import { isTaskMetadataLine } from '../src/utils/task-metadata';

describe('task-metadata utils', () => {
  describe('isTaskMetadataLine', () => {
    it('recognises bare keyword lines', () => {
      expect(isTaskMetadataLine('SCHEDULED: <2026-03-01 Sun>')).toBe(true);
      expect(isTaskMetadataLine('DEADLINE: <2026-03-01 Sun>')).toBe(true);
      expect(isTaskMetadataLine('CLOSED: [2026-03-01 Sun 09:12]')).toBe(true);
      expect(isTaskMetadataLine('STARTED: [2026-03-01 Sun 09:12]')).toBe(true);
      expect(isTaskMetadataLine('DESCRIPTION: notes')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isTaskMetadataLine('scheduled: <2026-03-01 Sun>')).toBe(true);
    });

    it('tolerates indentation and quote prefixes', () => {
      expect(isTaskMetadataLine('  SCHEDULED: <2026-03-01 Sun>')).toBe(true);
      expect(isTaskMetadataLine('  > SCHEDULED: <2026-03-01 Sun>')).toBe(true);
      expect(isTaskMetadataLine('> > DEADLINE: <2026-03-01 Sun>')).toBe(true);
    });

    it('recognises the repeat log title and entry lines', () => {
      expect(isTaskMetadataLine('  > [!repeats]- Repeats: 5 (latest 50)')).toBe(
        true,
      );
      expect(isTaskMetadataLine('  > - #5 · closed 2026-03-01 Sun 09:12')).toBe(
        true,
      );
    });

    it('rejects unrelated lines', () => {
      expect(isTaskMetadataLine('')).toBe(false);
      expect(isTaskMetadataLine('   ')).toBe(false);
      expect(isTaskMetadataLine('- [ ] a task')).toBe(false);
      expect(isTaskMetadataLine('Some paragraph text')).toBe(false);
      expect(isTaskMetadataLine('> [!note]- not the repeat log')).toBe(false);
    });
  });
});
