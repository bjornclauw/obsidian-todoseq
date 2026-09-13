import { Search } from '../src/search/search';
import { Task } from '../src/types/task';
import { createBaseTask } from './helpers/test-helper';

describe('description: and heading: search prefixes', () => {
  const task = (overrides: Partial<Task>): Task =>
    createBaseTask({
      path: 'notes/meeting.md',
      rawText: 'TODO task',
      text: 'task',
      ...overrides,
    });

  const matches = async (
    query: string,
    candidate: Task,
    caseSensitive = false,
  ): Promise<boolean> => Search.evaluate(query, candidate, caseSensitive);

  describe('description:', () => {
    it('matches a substring of the DESCRIPTION field', async () => {
      const candidate = task({ description: 'Call the bank about the loan' });
      expect(await matches('description:bank', candidate)).toBe(true);
      expect(await matches('description:loans', candidate)).toBe(false);
    });

    it('is case-insensitive by default and case-sensitive when asked', async () => {
      const candidate = task({ description: 'Call the Bank' });
      expect(await matches('description:bank', candidate, false)).toBe(true);
      expect(await matches('description:bank', candidate, true)).toBe(false);
    });

    it('does not match when the task has no description', async () => {
      const candidate = task({ description: undefined });
      expect(await matches('description:bank', candidate)).toBe(false);
    });

    it('matches a quoted phrase as a substring', async () => {
      const candidate = task({ description: 'Call the bank about the loan' });
      expect(await matches('description:"the bank about"', candidate)).toBe(
        true,
      );
      expect(await matches('description:"the gym about"', candidate)).toBe(
        false,
      );
    });

    it('supports negation', async () => {
      const candidate = task({ description: 'Call the bank' });
      expect(await matches('-description:bank', candidate)).toBe(false);
      expect(await matches('-description:gym', candidate)).toBe(true);
    });
  });

  describe('heading:', () => {
    it('matches a substring of the parent heading', async () => {
      const candidate = task({ parentHeading: 'Meeting Notes' });
      expect(await matches('heading:meeting', candidate)).toBe(true);
      expect(await matches('heading:notes', candidate)).toBe(true);
      expect(await matches('heading:archive', candidate)).toBe(false);
    });

    it('does not match when the task has no heading', async () => {
      const candidate = task({ parentHeading: undefined });
      expect(await matches('heading:meeting', candidate)).toBe(false);
    });

    it('matches a quoted phrase as a substring', async () => {
      const candidate = task({ parentHeading: 'Meeting Notes' });
      expect(await matches('heading:"meeting notes"', candidate)).toBe(true);
      expect(await matches('heading:"notes meeting"', candidate)).toBe(false);
    });

    it('is case-insensitive by default', async () => {
      const candidate = task({ parentHeading: 'Meeting Notes' });
      expect(await matches('heading:MEETING', candidate)).toBe(true);
    });
  });

  it('combines with other filters', async () => {
    const match = task({
      description: 'Call the bank',
      parentHeading: 'Finance',
      state: 'TODO',
    });
    const wrongHeading = task({
      description: 'Call the bank',
      parentHeading: 'Personal',
      state: 'TODO',
    });

    expect(await matches('description:bank heading:finance', match)).toBe(true);
    expect(
      await matches('description:bank heading:finance', wrongHeading),
    ).toBe(false);
  });
});
