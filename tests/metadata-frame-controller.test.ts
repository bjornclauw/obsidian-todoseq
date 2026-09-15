import { MarkdownView, TFile } from 'obsidian';
import { MetadataFrameController } from '../src/view/editor-extensions/metadata-frame-controller';
import { createBaseTask } from './helpers/test-helper';

jest.mock('../src/view/components/date-picker-menu', () => ({
  DatePicker: jest.fn().mockImplementation(() => ({
    show: jest.fn().mockResolvedValue(undefined),
    hide: jest.fn(),
  })),
}));

// Imported after the mock so the controller receives the mocked constructor.
import { DatePicker } from '../src/view/components/date-picker-menu';

function createHarness() {
  const task = createBaseTask({
    line: 4,
    state: 'TODO',
    scheduledDate: new Date(2026, 8, 14),
    deadlineDate: new Date(2026, 8, 16),
  });

  const editor = {
    setCursor: jest.fn(),
    lineCount: () => 8,
    getLine: jest.fn().mockReturnValue('- [ ] TODO Task'),
  };

  const mdView = new MarkdownView({} as never);
  mdView.file = new TFile('test.md', 'test.md', 'md');
  mdView.editor = editor as never;

  const leaf = { view: mdView };
  const container = {};
  (editor as { cm?: unknown }).cm = { dom: container };

  /** A chip that belongs to this harness's editor container. */
  const chipFor = (action: string, line = 5) => ({
    getAttribute: (name: string) =>
      name === 'data-todoseq-action'
        ? action
        : name === 'data-todoseq-line'
          ? String(line)
          : null,
    closest: () => container,
  });

  const updateTask = jest.fn().mockResolvedValue(undefined);
  const openStateMenuAtMouseEvent = jest.fn();
  const openFromActiveEditor = jest.fn();

  const plugin = {
    app: {
      workspace: {
        getLeavesOfType: jest.fn().mockReturnValue([leaf]),
        setActiveLeaf: jest.fn(),
      },
    },
    taskStateManager: {
      findTaskByPathAndLine: jest.fn().mockReturnValue(task),
    },
    vaultScanner: { getParser: jest.fn().mockReturnValue(null) },
    taskUpdateCoordinator: { updateTask },
    editorKeywordMenu: { openStateMenuAtMouseEvent },
    taskEditorController: { openFromActiveEditor },
    settings: { weekStartsOn: 'Monday' },
  };

  const controller = new MetadataFrameController(plugin as never);
  return {
    controller,
    plugin,
    task,
    editor,
    chipFor,
    updateTask,
    openStateMenuAtMouseEvent,
    openFromActiveEditor,
  };
}

function mouseEvent() {
  return { clientX: 10, clientY: 20, preventDefault: jest.fn() };
}

describe('MetadataFrameController', () => {
  beforeEach(() => {
    (DatePicker as unknown as jest.Mock).mockClear();
  });

  it('ignores the expand action (handled by the widget)', () => {
    const { controller, chipFor } = createHarness();
    const chip = chipFor('expand');
    expect(
      controller.handleChipClick(mouseEvent() as never, chip as never),
    ).toBe(false);
  });

  it('ignores the source toggle action (handled by the widget)', () => {
    const { controller, chipFor } = createHarness();
    const chip = chipFor('source');
    expect(
      controller.handleChipClick(mouseEvent() as never, chip as never),
    ).toBe(false);
  });

  it('ignores chips without a resolvable task', () => {
    const { controller, plugin, chipFor } = createHarness();
    plugin.taskStateManager.findTaskByPathAndLine.mockReturnValue(null);
    const chip = chipFor('scheduled');

    expect(
      controller.handleChipClick(mouseEvent() as never, chip as never),
    ).toBe(false);
  });

  it('opens the date picker for the scheduled chip and writes through the coordinator', () => {
    const { controller, task, updateTask, chipFor } = createHarness();
    const chip = chipFor('scheduled');

    expect(
      controller.handleChipClick(mouseEvent() as never, chip as never),
    ).toBe(true);

    expect(DatePicker).toHaveBeenCalledTimes(1);
    const [callbacks, config] = (DatePicker as unknown as jest.Mock).mock
      .calls[0];
    expect(config.allowRepeat).toBe(true);

    const newDate = new Date(2026, 8, 20);
    callbacks.onDateSelected(newDate, null, 'scheduled');
    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task,
        type: 'scheduled-date',
        source: 'editor',
        newDate,
      }),
    );
  });

  it('opens the date picker in deadline mode for the deadline chip', () => {
    const { controller, chipFor } = createHarness();
    const chip = chipFor('deadline');

    controller.handleChipClick(mouseEvent() as never, chip as never);

    const [, config] = (DatePicker as unknown as jest.Mock).mock.calls[0];
    void config;
    const datePickerInstance = (DatePicker as unknown as jest.Mock).mock
      .results[0].value;
    expect(datePickerInstance.show).toHaveBeenCalledWith(
      { x: 10, y: 28 },
      'deadline',
      expect.any(Date),
      null,
    );
  });

  it('opens the task editor for the description chip with the cursor on the task line', () => {
    const { controller, editor, openFromActiveEditor, task, chipFor } =
      createHarness();
    const chip = chipFor('description');

    expect(
      controller.handleChipClick(mouseEvent() as never, chip as never),
    ).toBe(true);

    expect(editor.setCursor).toHaveBeenCalledWith({ line: task.line, ch: 0 });
    expect(openFromActiveEditor).toHaveBeenCalled();
  });

  it('opens the state menu for the started chip with the task line override', () => {
    const { controller, openStateMenuAtMouseEvent, task, chipFor } =
      createHarness();
    const chip = chipFor('started');

    expect(
      controller.handleChipClick(mouseEvent() as never, chip as never),
    ).toBe(true);

    expect(openStateMenuAtMouseEvent).toHaveBeenCalledWith(
      task.state,
      chip,
      expect.anything(),
      task.line + 1,
    );
  });

  it('treats informational chips as handled without opening a surface', () => {
    const { controller, openFromActiveEditor, updateTask, chipFor } =
      createHarness();
    const chip = chipFor('created');

    expect(
      controller.handleChipClick(mouseEvent() as never, chip as never),
    ).toBe(true);
    expect(openFromActiveEditor).not.toHaveBeenCalled();
    expect(updateTask).not.toHaveBeenCalled();
  });
});
