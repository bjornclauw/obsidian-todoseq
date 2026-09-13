import { planCreatedDateInsertion } from '../src/utils/created-date';

function planner(lines: string[]) {
  return (lineNumber: number): string | undefined =>
    lineNumber >= 1 && lineNumber <= lines.length
      ? lines[lineNumber - 1]
      : undefined;
}

describe('planCreatedDateInsertion', () => {
  it('inserts directly below the task when there is no metadata', () => {
    const lines = ['- [ ] TODO Buy milk', '- [ ] TODO Other task'];
    expect(planCreatedDateInsertion(planner(lines), lines.length, 1)).toEqual({
      insertAtLine: 2,
    });
  });

  it('inserts after DESCRIPTION when it is the first metadata line', () => {
    const lines = [
      '- [ ] TODO Buy milk',
      '  DESCRIPTION: notes',
      '  SCHEDULED: <2026-03-10 Tue>',
    ];
    expect(planCreatedDateInsertion(planner(lines), lines.length, 1)).toEqual({
      insertAtLine: 3,
    });
  });

  it('returns null when a CREATED line already exists', () => {
    const lines = [
      '- [ ] TODO Buy milk',
      '  CREATED: [2026-01-01 Wed 08:00]',
      '  SCHEDULED: <2026-03-10 Tue>',
    ];
    expect(
      planCreatedDateInsertion(planner(lines), lines.length, 1),
    ).toBeNull();
  });

  it('places CREATED above STARTED/SCHEDULED when no DESCRIPTION exists', () => {
    const lines = [
      '- [ ] TODO Buy milk',
      '  STARTED: [2026-01-02 Thu 09:00]',
      '  SCHEDULED: <2026-03-10 Tue>',
    ];
    expect(planCreatedDateInsertion(planner(lines), lines.length, 1)).toEqual({
      insertAtLine: 2,
    });
  });

  it('skips blank lines while scanning the metadata block', () => {
    const lines = ['- [ ] TODO Buy milk', '', '  SCHEDULED: <2026-03-10 Tue>'];
    expect(planCreatedDateInsertion(planner(lines), lines.length, 1)).toEqual({
      insertAtLine: 2,
    });
  });

  it('stops at the next task line', () => {
    const lines = ['- [ ] TODO First', '- [ ] TODO Second'];
    expect(planCreatedDateInsertion(planner(lines), lines.length, 1)).toEqual({
      insertAtLine: 2,
    });
  });

  it('detects a quoted CREATED line', () => {
    const lines = ['> - [ ] TODO Quoted', '> CREATED: [2026-01-01 Wed 08:00]'];
    expect(
      planCreatedDateInsertion(planner(lines), lines.length, 1),
    ).toBeNull();
  });

  it('returns the line after the task when it is the last line', () => {
    const lines = ['- [ ] TODO Buy milk'];
    expect(planCreatedDateInsertion(planner(lines), lines.length, 1)).toEqual({
      insertAtLine: 2,
    });
  });

  it('stops at a non-metadata paragraph', () => {
    const lines = ['- [ ] TODO Buy milk', 'Just some prose'];
    expect(planCreatedDateInsertion(planner(lines), lines.length, 1)).toEqual({
      insertAtLine: 2,
    });
  });
});
