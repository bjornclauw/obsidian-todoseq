import {
  DEFAULT_CONVERTER_OPTIONS,
  convertObsidianTasksContent,
  convertObsidianTasksLine,
  formatObsidianDate,
  parseObsidianRecurrence,
} from '../src/services/import/obsidian-tasks-converter';

function convert(line: string, overrides = {}) {
  return convertObsidianTasksLine(line, {
    ...DEFAULT_CONVERTER_OPTIONS,
    ...overrides,
  });
}

describe('formatObsidianDate', () => {
  test('formats a valid date with weekday', () => {
    expect(formatObsidianDate('2026-01-20')).toBe('2026-01-20 Tue');
    expect(formatObsidianDate('2026-01-15')).toBe('2026-01-15 Thu');
    expect(formatObsidianDate('2026-03-05')).toBe('2026-03-05 Thu');
  });

  test('rejects invalid calendar dates', () => {
    expect(formatObsidianDate('2026-13-40')).toBeNull();
    expect(formatObsidianDate('not-a-date')).toBeNull();
  });
});

describe('parseObsidianRecurrence', () => {
  test('maps simple intervals', () => {
    expect(parseObsidianRecurrence('every day').raw).toBe('+1d');
    expect(parseObsidianRecurrence('every week').raw).toBe('+1w');
    expect(parseObsidianRecurrence('every month').raw).toBe('+1m');
    expect(parseObsidianRecurrence('every year').raw).toBe('+1y');
    expect(parseObsidianRecurrence('every 2 weeks').raw).toBe('+2w');
    expect(parseObsidianRecurrence('every 3 months').raw).toBe('+3m');
  });

  test('maps "when done" to the shift-from-now repeater', () => {
    expect(parseObsidianRecurrence('every week when done').raw).toBe('.+1w');
    expect(parseObsidianRecurrence('every 2 days when done').raw).toBe('.+2d');
  });

  test('maps weekday anchors to weekly with a warning', () => {
    const result = parseObsidianRecurrence('every Friday');
    expect(result.raw).toBe('+1w');
    expect(result.warning).toContain('weekday anchor');
  });

  test('rejects unsupported phrasing', () => {
    expect(parseObsidianRecurrence('every weekday').raw).toBeNull();
    expect(parseObsidianRecurrence('whenever').raw).toBeNull();
  });
});

describe('convertObsidianTasksLine - basics', () => {
  test('adds TODO to a bare checkbox task', () => {
    const result = convert('- [ ] Buy milk');
    expect(result.changed).toBe(true);
    expect(result.lines).toEqual(['- [ ] TODO Buy milk']);
    expect(result.warnings).toEqual([]);
  });

  test('leaves an already-converted task untouched', () => {
    const result = convert('- [ ] TODO Buy milk');
    expect(result.changed).toBe(false);
    expect(result.lines).toEqual(['- [ ] TODO Buy milk']);
  });

  test('ignores non-checkbox lines', () => {
    const result = convert('Just some prose');
    expect(result.changed).toBe(false);
    expect(result.lines).toEqual(['Just some prose']);
  });

  test('preserves list markers and indentation', () => {
    expect(convert('* [ ] Task').lines).toEqual(['* [ ] TODO Task']);
    expect(convert('1. [ ] Task').lines).toEqual(['1. [ ] TODO Task']);
    expect(convert('  - [ ] Task').lines).toEqual(['  - [ ] TODO Task']);
  });

  test('preserves tags, links and inline markdown in the text', () => {
    const result = convert('- [ ] Review [[Note]] #work **now**');
    expect(result.lines).toEqual(['- [ ] TODO Review [[Note]] #work **now**']);
  });
});

describe('convertObsidianTasksLine - dates', () => {
  test('converts scheduled date', () => {
    expect(convert('- [ ] Task ⏳ 2026-01-15').lines).toEqual([
      '- [ ] TODO Task',
      '  SCHEDULED: <2026-01-15 Thu>',
    ]);
  });

  test('converts due date to deadline', () => {
    expect(convert('- [ ] Task 📅 2026-01-20').lines).toEqual([
      '- [ ] TODO Task',
      '  DEADLINE: <2026-01-20 Tue>',
    ]);
  });

  test('scheduled appears before deadline', () => {
    expect(convert('- [ ] Task ⏳ 2026-01-15 📅 2026-01-20').lines).toEqual([
      '- [ ] TODO Task',
      '  SCHEDULED: <2026-01-15 Thu>',
      '  DEADLINE: <2026-01-20 Tue>',
    ]);
  });

  test('converts created date', () => {
    expect(convert('- [ ] Task ➕ 2026-01-01').lines).toEqual([
      '- [ ] TODO Task',
      '  CREATED: [2026-01-01 Thu]',
    ]);
  });

  test('converts done date to closed', () => {
    expect(convert('- [x] Task ✅ 2026-01-18').lines).toEqual([
      '- [x] DONE Task',
      '  CLOSED: [2026-01-18 Sun]',
    ]);
  });

  test('warns about an invalid date and omits the line', () => {
    const result = convert('- [ ] Task 📅 2026-13-40');
    expect(result.lines).toEqual(['- [ ] TODO Task']);
    expect(result.warnings.join(' ')).toContain('invalid deadline date');
  });
});

describe('convertObsidianTasksLine - status', () => {
  test('maps checked checkbox to DONE', () => {
    expect(convert('- [x] Task').lines).toEqual(['- [x] DONE Task']);
  });

  test('maps in-progress checkbox to DOING', () => {
    expect(convert('- [/] Task').lines).toEqual(['- [/] DOING Task']);
  });

  test('maps cancelled checkbox to CANCELED with closed date', () => {
    expect(convert('- [-] Task ❌ 2026-01-18').lines).toEqual([
      '- [-] CANCELED Task',
      '  CLOSED: [2026-01-18 Sun]',
    ]);
  });

  test('normalises an unknown checkbox status and warns', () => {
    const result = convert('- [?] Task');
    expect(result.lines).toEqual(['- [ ] TODO Task']);
    expect(result.warnings.join(' ')).toContain('unknown checkbox status');
  });
});

describe('convertObsidianTasksLine - priority', () => {
  test('maps emoji priorities via the configured mapping', () => {
    expect(convert('- [ ] Task ⏫').lines).toEqual(['- [ ] TODO [#A] Task']);
    expect(convert('- [ ] Task 🔼').lines).toEqual(['- [ ] TODO [#A] Task']);
    expect(convert('- [ ] Task 🔽').lines).toEqual(['- [ ] TODO [#C] Task']);
    expect(convert('- [ ] Task ⏬').lines).toEqual(['- [ ] TODO [#C] Task']);
  });

  test('does not add a priority token when none was present', () => {
    expect(convert('- [ ] Task 📅 2026-01-20').lines).toEqual([
      '- [ ] TODO Task',
      '  DEADLINE: <2026-01-20 Tue>',
    ]);
  });

  test('honours a custom mapping', () => {
    const result = convert('- [ ] Task ⏫', {
      priorityMapping: {
        highest: 'C',
        high: 'B',
        medium: null,
        low: null,
        lowest: null,
      },
    });
    expect(result.lines).toEqual(['- [ ] TODO [#C] Task']);
  });

  test('omits priority entirely when includePriority is false', () => {
    const result = convert('- [ ] Task ⏫', { includePriority: false });
    expect(result.lines).toEqual(['- [ ] TODO Task']);
  });
});

describe('convertObsidianTasksLine - recurrence', () => {
  test('attaches a repeater to the deadline', () => {
    expect(
      convert('- [ ] Pay rent 🔁 every month 📅 2026-01-20').lines,
    ).toEqual(['- [ ] TODO Pay rent', '  DEADLINE: <2026-01-20 Tue +1m>']);
  });

  test('attaches a repeater to scheduled when there is no deadline', () => {
    expect(
      convert('- [ ] Water plants 🔁 every 2 days ⏳ 2026-01-15').lines,
    ).toEqual(['- [ ] TODO Water plants', '  SCHEDULED: <2026-01-15 Thu +2d>']);
  });

  test('uses the from-done repeater for "when done"', () => {
    expect(
      convert('- [ ] Review 🔁 every week when done 📅 2026-01-20').lines,
    ).toEqual(['- [ ] TODO Review', '  DEADLINE: <2026-01-20 Tue .+1w>']);
  });

  test('warns and skips recurrence without a date', () => {
    const result = convert('- [ ] Task 🔁 every week');
    expect(result.lines).toEqual(['- [ ] TODO Task']);
    expect(result.warnings.join(' ')).toContain(
      'no scheduled or deadline date',
    );
  });

  test('warns about unsupported recurrence', () => {
    const result = convert('- [ ] Task 🔁 every weekday 📅 2026-01-20');
    expect(result.lines).toEqual([
      '- [ ] TODO Task',
      '  DEADLINE: <2026-01-20 Tue>',
    ]);
    expect(result.warnings.join(' ')).toContain('unsupported recurrence');
  });
});

describe('convertObsidianTasksLine - dataview fields', () => {
  test('converts dataview date fields', () => {
    expect(
      convert('- [ ] Task [scheduled:: 2026-01-15] [due:: 2026-01-20]').lines,
    ).toEqual([
      '- [ ] TODO Task',
      '  SCHEDULED: <2026-01-15 Thu>',
      '  DEADLINE: <2026-01-20 Tue>',
    ]);
  });

  test('converts a dataview priority field', () => {
    expect(convert('- [ ] Task [priority:: highest]').lines).toEqual([
      '- [ ] TODO [#A] Task',
    ]);
  });

  test('converts a dataview recurrence field', () => {
    expect(
      convert('- [ ] Task [recurrence:: every week] [due:: 2026-01-20]').lines,
    ).toEqual(['- [ ] TODO Task', '  DEADLINE: <2026-01-20 Tue +1w>']);
  });

  test('converts dataview completion and cancelled fields', () => {
    expect(convert('- [x] Task [completion:: 2026-01-18]').lines).toEqual([
      '- [x] DONE Task',
      '  CLOSED: [2026-01-18 Sun]',
    ]);
    expect(convert('- [-] Task [cancelled:: 2026-01-18]').lines).toEqual([
      '- [-] CANCELED Task',
      '  CLOSED: [2026-01-18 Sun]',
    ]);
  });
});

describe('convertObsidianTasksLine - start date', () => {
  test('uses the start date as scheduled when none exists', () => {
    expect(convert('- [ ] Task 🛫 2026-01-10').lines).toEqual([
      '- [ ] TODO Task',
      '  SCHEDULED: <2026-01-10 Sat>',
    ]);
  });

  test('warns and drops the start date when a scheduled date already exists', () => {
    const result = convert('- [ ] Task 🛫 2026-01-10 ⏳ 2026-01-15');
    expect(result.lines).toEqual([
      '- [ ] TODO Task',
      '  SCHEDULED: <2026-01-15 Thu>',
    ]);
    expect(result.warnings.join(' ')).toContain('start date dropped');
  });

  test('uses a dataview start field as scheduled when none exists', () => {
    expect(convert('- [ ] Task [start:: 2026-01-10]').lines).toEqual([
      '- [ ] TODO Task',
      '  SCHEDULED: <2026-01-10 Sat>',
    ]);
  });
});

describe('convertObsidianTasksContent', () => {
  test('converts multiple tasks and reports the count', () => {
    const input = [
      '# Notes',
      '- [ ] First ⏳ 2026-01-15',
      'Some prose',
      '- [x] Second ✅ 2026-01-18',
    ].join('\n');
    const result = convertObsidianTasksContent(input);
    expect(result.changed).toBe(true);
    expect(result.changedLineCount).toBe(2);
    expect(result.content).toBe(
      [
        '# Notes',
        '- [ ] TODO First',
        '  SCHEDULED: <2026-01-15 Thu>',
        'Some prose',
        '- [x] DONE Second',
        '  CLOSED: [2026-01-18 Sun]',
      ].join('\n'),
    );
  });

  test('is idempotent on a second run', () => {
    const input = [
      '- [ ] First ⏳ 2026-01-15 📅 2026-01-20',
      '- [x] Second ✅ 2026-01-18',
    ].join('\n');
    const first = convertObsidianTasksContent(input);
    const second = convertObsidianTasksContent(first.content);
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });

  test('does not duplicate an existing date line', () => {
    const input = [
      '- [ ] Task ⏳ 2026-01-15',
      '  SCHEDULED: <2026-01-15 Thu>',
    ].join('\n');
    const result = convertObsidianTasksContent(input);
    expect(result.content).toBe(
      ['- [ ] TODO Task', '  SCHEDULED: <2026-01-15 Thu>'].join('\n'),
    );
  });

  test('collects warnings with line numbers', () => {
    const result = convertObsidianTasksContent(
      '- [ ] Task ⏫\n- [ ] Bad 📅 2026-13-40',
    );
    expect(result.warnings.some((w) => w.startsWith('Line 2:'))).toBe(true);
  });
});
