import {
  PluginSettingTab,
  App,
  Setting,
  Notice,
  DropdownComponent,
  SettingDefinitionItem,
  SettingDefinitionPage,
  SettingDefinitionList,
} from 'obsidian';
import TodoTracker from '../main';
import { TaskParser } from '../parser/task-parser';
import { validateKeywordGroupsDetailed } from '../utils/settings-utils';
import { SavedSearch, TodoTrackerSettings } from './settings-types';
import { SUPPORTED_EXTENSIONS } from '../parser/code-comment-task-parser';
import { SavedSearchDialog } from '../view/components/saved-search-dialog';
import {
  createSavedSearch,
  addSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  getSavedSearches,
  reorderSavedSearches,
} from '../services/saved-search-manager';
import { TaskListView } from '../view/task-list/task-list-view';
import { KeywordGroup } from '../types/task';
import { TransitionParser } from '../services/transition-parser';
import { KeywordManager } from '../utils/keyword-manager';

function hideSettingNameAndControl(setting: Setting): void {
  setting.nameEl.classList.add('todoseq-hidden');
  setting.controlEl.classList.add('todoseq-hidden');
}

type KeywordSettingKey = keyof Pick<
  TodoTrackerSettings,
  | 'additionalActiveKeywords'
  | 'additionalInactiveKeywords'
  | 'additionalWaitingKeywords'
  | 'additionalCompletedKeywords'
  | 'additionalArchivedKeywords'
>;

export class TodoTrackerSettingTab extends PluginSettingTab {
  plugin: TodoTracker;
  private fileExtensionsDebounceTimer: number | null = null;
  private transitionValidationDebounceTimer: number | null = null;
  private keywordApplyTimer: number | null = null;
  private readonly KEYWORD_DEBOUNCE_MS = 500;
  private readonly FILE_EXTENSIONS_DEBOUNCE_MS = 500;
  private readonly TRANSITION_VALIDATION_DEBOUNCE_MS = 500;
  // Live keyword colour pickers, keyed by keyword, so a group colour change can
  // update the children that inherit it without re-rendering the whole tab.
  private readonly keywordColorPickers = new Map<
    string,
    { picker: { setValue: (value: string) => void }; group: KeywordGroup }
  >();
  // Store dropdown components for default state settings to update when keywords change
  private defaultStateDropdowns: {
    inactive?: DropdownComponent;
    active?: DropdownComponent;
    completed?: DropdownComponent;
  } = {};

  // Store Setting instances for transition settings to attach validation errors
  private transitionSettings: {
    inactive?: Setting;
    active?: Setting;
    completed?: Setting;
    transitions?: Setting;
  } = {};

  private readonly keywordSettingToGroup: Record<
    KeywordSettingKey,
    KeywordGroup
  > = {
    additionalActiveKeywords: 'activeKeywords',
    additionalInactiveKeywords: 'inactiveKeywords',
    additionalWaitingKeywords: 'waitingKeywords',
    additionalCompletedKeywords: 'completedKeywords',
    additionalArchivedKeywords: 'archivedKeywords',
  };

  private readonly sideEffectHandlers: Record<
    string,
    (value: unknown) => Promise<void> | void
  > = {
    formatTaskKeywords: () => this.plugin.updateTaskFormatting(),
    keywordColors: () => this.refreshKeywordColors(),
    keywordGroupColors: () => this.refreshKeywordColors(),
    metadataFrame: () => this.plugin.updateTaskFormatting(),
    trackWorkLog: () => this.plugin.updateTaskFormatting(),
    includeCalloutBlocks: () => this.rescanAndRefresh(),
    includeCommentBlocks: () => this.rescanAndRefresh(),
    includeCodeBlocks: (value) => {
      if (!value) this.plugin.settings.languageCommentSupport = false;
      this.refreshDomState();
      return this.rescanAndRefresh();
    },
    languageCommentSupport: () => this.rescanAndRefresh(),
    enableSmartDateRecognition: (value) => {
      if (!value) this.plugin.settings.smartDateRemoveKeywords = false;
      this.plugin.smartDateProcessor?.setEnabled(Boolean(value));
      this.refreshDomState();
    },
    weekStartsOn: () => this.refreshViews(),
    taskListViewMode: () => this.refreshViews(),
    futureTaskSorting: () => this.refreshViews(),
    taskDescriptionDisplay: () => this.refreshViews(),
    upcomingPeriod: () => this.refreshViews(),
    defaultDeadlineWarningPeriod: () => this.refreshViews(),
    defaultScheduledWarningPeriod: () => this.refreshViews(),
    skipScheduledWarningPeriodIfDeadline: () => this.refreshViews(),
    skipDeadlinePrewarningIfScheduled: () => this.refreshViews(),
    migrateToTodayState: () => {
      this.plugin.embeddedTaskListProcessor?.updateSettings();
      return this.refreshViews();
    },
    detectOrgModeFiles: (value) => {
      // Sync .org extension with additionalFileExtensions
      const currentExtensions = [
        ...(this.plugin.settings.additionalFileExtensions ?? []),
      ];
      const orgExtension = '.org';

      if (value) {
        // Add .org if not already present
        if (!currentExtensions.includes(orgExtension)) {
          currentExtensions.push(orgExtension);
        }
      } else {
        // Remove .org if present
        const orgIndex = currentExtensions.indexOf(orgExtension);
        if (orgIndex !== -1) {
          currentExtensions.splice(orgIndex, 1);
        }
      }

      this.plugin.settings.additionalFileExtensions = currentExtensions;
      return this.rescanAndRefresh();
    },
    scanCodeFiles: (value) => {
      // Sync code file extensions with additionalFileExtensions
      const codeExtensions = SUPPORTED_EXTENSIONS;
      const currentExtensions = [
        ...(this.plugin.settings.additionalFileExtensions ?? []),
      ];

      if (value) {
        // Snapshot pre-existing extensions before adding code extensions
        if (!this.codeExtensionsSnapshot) {
          this.codeExtensionsSnapshot = [...currentExtensions];
        }
        // Add code extensions not already present
        for (const ext of codeExtensions) {
          if (!currentExtensions.includes(ext)) {
            currentExtensions.push(ext);
          }
        }
      } else {
        // Only remove extensions that were added by this feature,
        // preserving any that the user had manually configured before
        const snapshot = this.codeExtensionsSnapshot ?? [];
        for (const ext of codeExtensions) {
          if (!snapshot.includes(ext)) {
            const idx = currentExtensions.indexOf(ext);
            if (idx !== -1) {
              currentExtensions.splice(idx, 1);
            }
          }
        }
      }

      this.plugin.settings.additionalFileExtensions = currentExtensions;
      return this.rescanAndRefresh();
    },
    useExtendedCheckboxStyles: async () => {
      // Re-create parser to update KeywordManager with new settings
      await this.plugin.recreateParser();
      // Update KeywordManager in TaskWriter with new settings
      this.plugin.updateTaskWriterKeywordManager();
    },
  };

  private codeExtensionsSnapshot: string[] | null = null;

  private readonly controlsRequiringTabUpdate = new Set<string>([
    'includeCodeBlocks',
    'enableSmartDateRecognition',
  ]);

  constructor(app: App, plugin: TodoTracker) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private refreshAllTaskListViews = async () => {
    // Ensure the vault scanner's keyword manager has fresh settings
    // (keyword manager is a snapshot; it must be recreated when settings change)
    if (this.plugin.vaultScanner) {
      await this.plugin.vaultScanner.updateSettings(this.plugin.settings);
      // Sync main.ts keywordManager reference so embedded task lists see fresh settings
      this.plugin.keywordManager = this.plugin.vaultScanner.getKeywordManager();
    }

    const leaves = this.app.workspace.getLeavesOfType('todoseq-view');
    const tasks = this.plugin.getTasks();
    for (const leaf of leaves) {
      if (leaf.view instanceof TaskListView) {
        const taskListView = leaf.view;
        // Update keyword manager with new settings before rendering
        taskListView.updateSettings();
        taskListView.updateTasks(tasks);
        // Re-sync toolbar controls with settings. Saved-search overrides (if
        // any) still win, because the view resolves effective values.
        taskListView.syncPreferenceControls();
        // Update context menu config for settings changes
        taskListView.updateContextMenuConfig();
        // Use lighter refresh instead of full onOpen rebuild
        taskListView.refreshVisibleList().catch((error) => {
          new Notice('Failed to refresh task list');
          console.error('Error refreshing task list:', error);
        });
      }
    }
  };

  private async rescanAndRefresh(): Promise<void> {
    try {
      await this.plugin.recreateParser();
      await this.plugin.scanVault();
      await this.refreshAllTaskListViews();
      this.plugin.refreshVisibleEditorDecorations();
      this.plugin.refreshReaderViewFormatter();
    } catch (parseError) {
      console.error('Failed to rescan vault:', parseError);
    }
  }

  private refreshViews(): Promise<void> {
    return this.refreshAllTaskListViews();
  }

  /**
   * Repaint every surface after a keyword colour changed. The editor
   * decorations read settings directly, while the reader and task lists resolve
   * colours through the (snapshot) KeywordManager, which the refresh syncs.
   */
  private refreshKeywordColors(): Promise<void> {
    this.plugin.updateTaskFormatting();
    this.plugin.refreshReaderViewFormatter();
    return this.refreshAllTaskListViews();
  }

  /**
   * Read a control value. Supports indexed keys (`arrayField#3`) used by the
   * keyword and transition list rows, plus the transition statement array.
   */
  getControlValue(key: string): unknown {
    const indexed = this.parseIndexedKey(key);
    if (indexed) {
      if (indexed.base === 'transitionStatements') {
        return this.plugin.settings.stateTransitions.transitionStatements[
          indexed.index
        ];
      }
      const arr = (this.plugin.settings as unknown as Record<string, unknown>)[
        indexed.base
      ];
      return Array.isArray(arr) ? arr[indexed.index] : undefined;
    }
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const indexed = this.parseIndexedKey(key);
    if (indexed) {
      if (indexed.base === 'transitionStatements') {
        const statements =
          this.plugin.settings.stateTransitions.transitionStatements;
        if (indexed.index >= 0 && indexed.index < statements.length) {
          statements[indexed.index] = typeof value === 'string' ? value : '';
        }
        await this.plugin.saveSettings();
        this.scheduleTransitionValidation();
        return;
      }
      const arr = (this.plugin.settings as unknown as Record<string, unknown>)[
        indexed.base
      ];
      if (
        Array.isArray(arr) &&
        indexed.index >= 0 &&
        indexed.index < arr.length
      ) {
        arr[indexed.index] = typeof value === 'string' ? value : '';
      }
      this.scheduleKeywordApply();
      return;
    }

    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    await this.sideEffectHandlers[key]?.(value);
    await this.plugin.saveSettings();
    if (this.controlsRequiringTabUpdate.has(key)) {
      this.update();
    }
  }

  /** Parse an `arrayField#3` style indexed control key. */
  private parseIndexedKey(key: string): { base: string; index: number } | null {
    const match = /^(.*)#(\d+)$/.exec(key);
    if (!match) {
      return null;
    }
    return { base: match[1], index: Number(match[2]) };
  }

  /** Debounce keyword edits so a scan runs once the user pauses. */
  private scheduleKeywordApply(): void {
    if (this.keywordApplyTimer !== null) {
      window.clearTimeout(this.keywordApplyTimer);
    }
    this.keywordApplyTimer = window.setTimeout(() => {
      this.keywordApplyTimer = null;
      void this.applyKeywordGroups();
    }, this.KEYWORD_DEBOUNCE_MS);
  }

  /** Validate, persist and apply the current keyword groups. */
  private async applyKeywordGroups(): Promise<void> {
    const parsedBySetting = this.getKeywordInputsFromSettings();
    const regexValidation =
      this.validateKeywordRegexForAllGroups(parsedBySetting);
    const groupsForValidation = this.toGroupKeywordInput(
      regexValidation.validBySetting,
    );
    const keywordValidation =
      validateKeywordGroupsDetailed(groupsForValidation);

    this.renderKeywordValidationState(
      regexValidation.errorsByGroup,
      keywordValidation.errors,
      keywordValidation.warnings,
    );

    for (const [key, values] of Object.entries(
      regexValidation.validBySetting,
    )) {
      this.plugin.settings[key as KeywordSettingKey] = values;
    }
    await this.plugin.saveSettings();

    await this.updateDefaultStateDropdowns();
    this.validateTransitionSettings();

    try {
      await this.plugin.recreateParser();
      await this.plugin.scanVault();
      await this.refreshAllTaskListViews();
      this.plugin.refreshVisibleEditorDecorations();
      this.plugin.refreshReaderViewFormatter();
    } catch (parseError) {
      console.error('Failed to recreate parser with keywords:', parseError);
    }
  }

  private scheduleTransitionValidation(): void {
    if (this.transitionValidationDebounceTimer) {
      window.clearTimeout(this.transitionValidationDebounceTimer);
    }
    this.transitionValidationDebounceTimer = window.setTimeout(() => {
      this.transitionValidationDebounceTimer = null;
      this.validateTransitionSettings();
      this.plugin.updateTaskListViewSettings();
      this.plugin.updateTaskUpdateCoordinatorSettings();
    }, this.TRANSITION_VALIDATION_DEBOUNCE_MS);
  }

  /** Snapshot the keyword arrays from settings (source of truth for a scan). */
  private getKeywordInputsFromSettings(): Record<KeywordSettingKey, string[]> {
    return {
      additionalActiveKeywords: [
        ...(this.plugin.settings.additionalActiveKeywords ?? []),
      ],
      additionalInactiveKeywords: [
        ...(this.plugin.settings.additionalInactiveKeywords ?? []),
      ],
      additionalWaitingKeywords: [
        ...(this.plugin.settings.additionalWaitingKeywords ?? []),
      ],
      additionalCompletedKeywords: [
        ...(this.plugin.settings.additionalCompletedKeywords ?? []),
      ],
      additionalArchivedKeywords: [
        ...(this.plugin.settings.additionalArchivedKeywords ?? []),
      ],
    };
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    // Compute default values for each state
    const keywordManager = new KeywordManager(this.plugin.settings);
    const defaultInactive = this.getDefaultForGroup(
      keywordManager,
      'inactiveKeywords',
      'TODO',
    );
    const defaultActive = this.getDefaultForGroup(
      keywordManager,
      'activeKeywords',
      'DOING',
    );
    const defaultCompleted = this.getDefaultForGroup(
      keywordManager,
      'completedKeywords',
      'DONE',
    );

    const sections: SettingDefinitionItem[] = [
      {
        name: 'Format task keywords',
        desc: 'Highlight task keywords (todo, doing, etc.) in bold with accent color in the editor.',
        control: { type: 'toggle', key: 'formatTaskKeywords' },
      },
      {
        name: 'Metadata frame',
        desc: 'Render the metadata below a task (scheduled, deadline, description, started) as a compact icon frame in Live Preview. The underlying text is never modified and returns whenever the cursor is placed inside the block.',
        control: { type: 'toggle', key: 'metadataFrame' },
      },
      {
        name: 'Track work time',
        desc: 'Show a play/pause control on task metadata frames and record work sessions in a `[!work]` callout.',
        control: { type: 'toggle', key: 'trackWorkLog' },
      },
      {
        name: 'Blank line after task',
        desc: 'When creating a task with the task editor, insert a blank line after the task and its metadata lines.',
        control: { type: 'toggle', key: 'blankLineAfterTask' },
      },
      {
        type: 'group',
        heading: 'Task detection',
        items: [
          {
            name: 'Include tasks inside quote and callout blocks',
            desc: 'When enabled, include tasks inside quote and callout blocks (>, >[!info], >[!todo], etc.).',
            control: { type: 'toggle', key: 'includeCalloutBlocks' },
          },
          {
            name: 'Include tasks inside comments',
            desc: 'When enabled, include tasks inside comments (%%).',
            control: { type: 'toggle', key: 'includeCommentBlocks' },
          },
          {
            name: 'Include tasks inside code blocks',
            desc: 'When enabled, tasks inside fenced code blocks (``` or ~~~) will be included.',
            control: { type: 'toggle', key: 'includeCodeBlocks' },
          },
          {
            name: 'Enable language comment support',
            desc: 'When enabled, tasks inside code blocks will be detected using language-specific comment patterns e.g. `// TODO`',
            control: {
              type: 'toggle',
              key: 'languageCommentSupport',
              disabled: () => !this.plugin.settings.includeCodeBlocks,
            },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Smart date recognition',
        items: [
          {
            name: 'Enable smart date recognition',
            desc: 'Automatically convert natural language dates like "today", "tomorrow", "due next week".',
            control: { type: 'toggle', key: 'enableSmartDateRecognition' },
          },
          {
            name: 'Remove date keywords',
            desc: 'Remove natural language text (e.g., "today", "tomorrow") after conversion to structured dates.',
            control: {
              type: 'toggle',
              key: 'smartDateRemoveKeywords',
              disabled: () => !this.plugin.settings.enableSmartDateRecognition,
            },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Task list search and filter',
        items: [
          {
            name: 'Week starts on',
            desc: 'Choose which day the week starts on for date filtering.',
            control: {
              type: 'dropdown',
              key: 'weekStartsOn',
              options: { Monday: 'Monday', Sunday: 'Sunday' },
              defaultValue: 'Monday',
            },
          },
          {
            name: 'Completed tasks',
            desc: 'Choose how completed items are shown in the task list.',
            control: {
              type: 'dropdown',
              key: 'taskListViewMode',
              options: {
                showAll: 'Show all tasks',
                sortCompletedLast: 'Sort completed to end',
                hideCompleted: 'Hide completed',
              },
              defaultValue: 'showAll',
            },
          },
          {
            name: 'Future dated tasks',
            desc: 'Choose how tasks with future dates are displayed in the task list.',
            control: {
              type: 'dropdown',
              key: 'futureTaskSorting',
              options: {
                showAll: 'Show all tasks',
                showUpcoming: 'Show upcoming',
                sortToEnd: 'Sort future to end',
                hideFuture: 'Hide future',
              },
              defaultValue: 'showAll',
            },
          },
          {
            name: 'Task descriptions',
            desc: 'Controls how task descriptions (description: lines) are displayed in the task list.',
            control: {
              type: 'dropdown',
              key: 'taskDescriptionDisplay',
              options: { hide: 'Hide', show: 'Show' },
              defaultValue: 'show',
            },
          },
          {
            name: 'Upcoming period (days)',
            desc: 'Tasks within this many days are shown as "upcoming" when using the show upcoming option.',
            control: {
              type: 'number',
              key: 'upcomingPeriod',
              min: 0,
              max: 30,
              defaultValue: 7,
              // Accept every committed value: Obsidian's runtime shows the
              // range warning for out-of-range commits and calls `validate` on
              // valid ones to deterministically clear that warning.
              validate: () => undefined,
            },
          },
        ],
      },
      this.buildKeywordsPage(),
      {
        type: 'group',
        heading: 'Keyword colors',
        items: [
          {
            name: 'Keyword colors',
            desc: 'Assign a colour to any task state keyword. Unset keywords use the theme accent colour.',
            render: (setting) => {
              this.configureKeywordColorsSetting(setting);
            },
          },
        ],
      },
      {
        type: 'page',
        name: 'State transitions',
        desc: 'How task states cycle, and date tracking on state changes.',
        items: [
          this.buildTransitionList(),
          {
            name: 'Default inactive state',
            desc: 'The default state for inactive tasks when no explicit transition is defined.',
            render: (setting) => {
              this.transitionSettings.inactive = setting;
              setting
                .setName('Default inactive state')
                .setDesc(
                  'The default state for inactive tasks when no explicit transition is defined.',
                )
                .addDropdown((dropdown) => {
                  this.defaultStateDropdowns.inactive = dropdown;
                  this.populateDefaultStateDropdown(
                    dropdown,
                    keywordManager.getInactiveSet(),
                  );
                  dropdown.setValue(
                    this.plugin.settings.stateTransitions.defaultInactive ||
                      defaultInactive,
                  );
                  dropdown.onChange(async (value) => {
                    this.plugin.settings.stateTransitions.defaultInactive =
                      value;
                    await this.plugin.saveSettings();
                    this.validateTransitionSettings();
                    // Update task list views with new state transition settings
                    this.plugin.updateTaskListViewSettings();
                    // Update task update coordinator with new settings
                    this.plugin.updateTaskUpdateCoordinatorSettings();
                  });
                });
            },
          },
          {
            name: 'Default active state',
            desc: 'The default state for active tasks when no explicit transition is defined.',
            render: (setting) => {
              this.transitionSettings.active = setting;
              setting
                .setName('Default active state')
                .setDesc(
                  'The default state for active tasks when no explicit transition is defined.',
                )
                .addDropdown((dropdown) => {
                  this.defaultStateDropdowns.active = dropdown;
                  this.populateDefaultStateDropdown(
                    dropdown,
                    keywordManager.getActiveSet(),
                  );
                  dropdown.setValue(
                    this.plugin.settings.stateTransitions.defaultActive ||
                      defaultActive,
                  );
                  dropdown.onChange(async (value) => {
                    this.plugin.settings.stateTransitions.defaultActive = value;
                    await this.plugin.saveSettings();
                    this.validateTransitionSettings();
                    // Update task list views with new state transition settings
                    this.plugin.updateTaskListViewSettings();
                    // Update task update coordinator with new settings
                    this.plugin.updateTaskUpdateCoordinatorSettings();
                  });
                });
            },
          },
          {
            name: 'Default completed state',
            desc: 'The default state for completed tasks when no explicit transition is defined.',
            render: (setting) => {
              this.transitionSettings.completed = setting;
              setting
                .setName('Default completed state')
                .setDesc(
                  'The default state for completed tasks when no explicit transition is defined.',
                )
                .addDropdown((dropdown) => {
                  this.defaultStateDropdowns.completed = dropdown;
                  this.populateDefaultStateDropdown(
                    dropdown,
                    keywordManager.getCompletedSet(),
                  );
                  dropdown.setValue(
                    this.plugin.settings.stateTransitions.defaultCompleted ||
                      defaultCompleted,
                  );
                  dropdown.onChange(async (value) => {
                    this.plugin.settings.stateTransitions.defaultCompleted =
                      value;
                    await this.plugin.saveSettings();
                    this.validateTransitionSettings();
                    // Update task list views with new state transition settings
                    this.plugin.updateTaskListViewSettings();
                    // Update task update coordinator with new settings
                    this.plugin.updateTaskUpdateCoordinatorSettings();
                  });
                });

              // Initial validation
              window.setTimeout(() => this.validateTransitionSettings(), 0);
            },
          },
          {
            name: 'Track closed date',
            desc: 'Add closed: timestamp when tasks are marked as completed.',
            control: { type: 'toggle', key: 'trackClosedDate' },
          },
          {
            name: 'Track started date',
            desc: 'Add or update the started: timestamp whenever a task enters an active state. Updated on every restart; never removed automatically.',
            control: { type: 'toggle', key: 'trackStartedDate' },
          },
          {
            name: 'Track created date',
            desc: 'Add a created: timestamp when TODOseq creates a task. Written once and never changed afterwards.',
            control: { type: 'toggle', key: 'trackCreatedDate' },
          },
          {
            name: 'Track repeat history',
            desc: 'Log each recurring completion in a collapsed [!repeats] callout (keeps an iteration number, completion time and occurrence date) instead of writing a CLOSED date.',
            control: { type: 'toggle', key: 'trackRepeatHistory' },
          },
          {
            name: 'Repeat history limit',
            desc: 'Maximum number of recent completions kept in each [!repeats] log. Iteration numbers continue counting past the limit.',
            control: {
              type: 'number',
              key: 'repeatHistoryLimit',
              min: 1,
              max: 1000,
              defaultValue: 50,
              validate: () => undefined,
            },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Warning period',
        items: [
          {
            name: 'Deadline advance notice (days)',
            desc: 'Tasks appear this many days before their deadline. Set to 0 to disable.',
            control: {
              type: 'number',
              key: 'defaultDeadlineWarningPeriod',
              min: 0,
              max: 30,
              defaultValue: 0,
              validate: () => undefined,
            },
          },
          {
            name: 'Scheduled delay (days)',
            desc: 'Tasks appear this many days after their scheduled date. Set to 0 to disable.',
            control: {
              type: 'number',
              key: 'defaultScheduledWarningPeriod',
              min: 0,
              max: 30,
              defaultValue: 0,
              validate: () => undefined,
            },
          },
          {
            name: 'Ignore scheduled delay when deadline is set',
            desc: 'If a task has both a scheduled date and a deadline, the scheduled delay is ignored.',
            control: {
              type: 'toggle',
              key: 'skipScheduledWarningPeriodIfDeadline',
            },
          },
          {
            name: 'Ignore deadline advance notice when scheduled is set',
            desc: 'If a task has both a scheduled date and a deadline, the deadline advance notice is ignored.',
            control: {
              type: 'toggle',
              key: 'skipDeadlinePrewarningIfScheduled',
            },
          },
        ],
      },
      {
        type: 'group',
        heading: '⚠︎ Experimental features',
        items: [
          {
            name: 'Experimental features',
            render: (setting) => {
              setting.setDesc(
                'Experimental features may be changed significantly or removed entirely in future versions.',
              );
              hideSettingNameAndControl(setting);
            },
          },
          {
            name: 'Detect org-mode files',
            desc: 'When enabled, scans for .org files in vault and detects tasks using org-mode syntax.',
            control: { type: 'toggle', key: 'detectOrgModeFiles' },
          },
          {
            name: 'Scan code files for comments',
            desc: 'When enabled, scans code files (.js, .ts, .py, .rb, .java, .rs, .go, .c, .cpp, .cs, .swift, .kt, .sh, .YAML, .yml, .toml, .SQL, .ini, .r, .dockerfile, .ps1) for todo-style comments and detects them as tasks. Supports multi-line comments and skips keywords inside string literals.',
            control: { type: 'toggle', key: 'scanCodeFiles' },
          },
          {
            name: 'Use extended Markdown checkbox styles',
            desc: 'When enabled, uses themed checkbox styles ([/], [-]) for active and cancelled tasks.',
            control: { type: 'toggle', key: 'useExtendedCheckboxStyles' },
          },
        ],
      },
    ];

    // The flat `sections` array is kept in declaration order and re-grouped
    // into navigable pages below. Index order must match the array above.
    const [
      formatTaskKeywords,
      metadataFrame,
      trackWorkTime,
      blankLineAfterTask,
      detectionGroup,
      smartDateGroup,
      taskListGroup,
      keywordsGroup,
      colorsGroup,
      transitionsGroup,
      warningGroup,
      experimentalGroup,
    ] = sections;

    const pages: SettingDefinitionItem[] = [
      {
        type: 'page',
        name: 'General',
        desc: 'Task rendering and creation behaviour.',
        items: [
          formatTaskKeywords,
          metadataFrame,
          trackWorkTime,
          blankLineAfterTask,
        ],
      },
      {
        type: 'page',
        name: 'Task detection',
        desc: 'Where TODOseq looks for tasks.',
        items: [detectionGroup],
      },
      {
        type: 'page',
        name: 'Task list',
        desc: 'How the Task List view filters and displays tasks.',
        items: [taskListGroup, warningGroup],
      },
      {
        type: 'page',
        name: 'States & keywords',
        desc: 'Task states, colours, keywords and transitions.',
        items: [keywordsGroup, colorsGroup, transitionsGroup],
      },
      {
        type: 'page',
        name: 'Dates',
        desc: 'Natural-language date recognition.',
        items: [smartDateGroup],
      },
      {
        type: 'page',
        name: 'Saved searches',
        desc: 'Named task list queries.',
        items: [this.buildSavedSearchesList()],
      },
      {
        type: 'page',
        name: 'Experimental',
        desc: 'Features that may change or be removed.',
        items: [experimentalGroup],
      },
    ];

    return pages;
  }

  /**
   * Validate and parse file extensions from user input
   * @param input The raw user input string
   * @returns Object with valid extensions and invalid extensions
   */
  private validateFileExtensions(input: string): {
    valid: string[];
    invalid: string[];
  } {
    const valid: string[] = [];
    const invalid: string[] = [];

    // Parse CSV, trim whitespace
    const parsed = input
      .split(',')
      .map((ext) => ext.trim().toLowerCase())
      .filter((ext) => ext.length > 0);

    for (const ext of parsed) {
      // Must start with a dot
      if (!ext.startsWith('.')) {
        invalid.push(ext);
        continue;
      }

      // Must have at least one character after the dot
      if (ext.length < 2) {
        invalid.push(ext);
        continue;
      }

      // Must contain only valid characters (letters, numbers, dots, hyphens, underscores)
      // Allow multi-level extensions like .txt.bak
      if (!/^\.[a-zA-Z0-9._-]+$/.test(ext)) {
        invalid.push(ext);
        continue;
      }

      valid.push(ext);
    }

    return { valid, invalid };
  }

  /**
   * Render the colour editor. Each state group gets a default colour, and
   * every known keyword (built-in and custom) gets an optional override with a
   * reset button.
   */
  private configureKeywordColorsSetting(setting: Setting): void {
    setting
      .setName('Keyword colors')
      .setDesc(
        'Colour each task state group, with optional per-keyword overrides. Unset values fall back to the theme accent colour.',
      );

    const listEl = setting.settingEl.createDiv({
      cls: 'todoseq-keyword-colors',
    });
    this.keywordColorPickers.clear();
    const keywordManager = new KeywordManager(this.plugin.settings);
    const groups: Array<{ label: string; group: KeywordGroup }> = [
      { label: 'Inactive', group: 'inactiveKeywords' },
      { label: 'Active', group: 'activeKeywords' },
      { label: 'Waiting', group: 'waitingKeywords' },
      { label: 'Completed', group: 'completedKeywords' },
      { label: 'Archived', group: 'archivedKeywords' },
    ];

    for (const { label, group } of groups) {
      const keywords = keywordManager.getKeywordsForGroup(group);
      if (keywords.length === 0) {
        continue;
      }
      listEl.createDiv({
        cls: 'todoseq-keyword-colors-group-heading',
        text: label,
      });
      this.buildGroupColorRow(listEl, label, group);
      for (const keyword of keywords) {
        this.buildKeywordColorRow(listEl, keyword, group);
      }
    }
  }

  /** The group's configured colour if it is a value the picker can show. */
  private getGroupColorHex(group: KeywordGroup): string | null {
    const value = this.plugin.settings.keywordGroupColors?.[group];
    return value && /^#[0-9a-fA-F]+$/.test(value) ? value : null;
  }

  private buildGroupColorRow(
    container: HTMLElement,
    label: string,
    group: KeywordGroup,
  ): void {
    const row = new Setting(container);
    row.setName(`${label} (all keywords)`);
    row.addColorPicker((picker) => {
      const current = this.getGroupColorHex(group);
      if (current) {
        picker.setValue(current);
      }
      picker.onChange((value) => {
        void this.setKeywordGroupColor(group, value);
      });
    });
    row.addExtraButton((button) => {
      button.setIcon('rotate-ccw');
      button.setTooltip('Reset to no colour (theme accent)');
      button.onClick(() => {
        void this.setKeywordGroupColor(group, '');
      });
    });
  }

  private buildKeywordColorRow(
    container: HTMLElement,
    keyword: string,
    group: KeywordGroup,
  ): void {
    const row = new Setting(container);
    row.setName(keyword);
    row.addColorPicker((picker) => {
      // A keyword shows its own override when set, otherwise it inherits the
      // group colour so the picker reflects the effective colour.
      const override = this.plugin.settings.keywordColors?.[keyword];
      const shown =
        override && /^#[0-9a-fA-F]+$/.test(override)
          ? override
          : this.getGroupColorHex(group);
      if (shown) {
        picker.setValue(shown);
      }
      this.keywordColorPickers.set(keyword, { picker, group });
      picker.onChange((value) => {
        void this.setKeywordColor(keyword, value);
      });
    });
    row.addExtraButton((button) => {
      button.setIcon('rotate-ccw');
      button.setTooltip('Reset to the group colour');
      button.onClick(() => {
        void this.setKeywordColor(keyword, '').then(() => {
          const inherited = this.getGroupColorHex(group) ?? '';
          this.keywordColorPickers.get(keyword)?.picker.setValue(inherited);
        });
      });
    });
  }

  private async setKeywordColor(keyword: string, value: string): Promise<void> {
    const colors: Record<string, string> = {
      ...(this.plugin.settings.keywordColors ?? {}),
    };
    if (value.trim().length === 0) {
      delete colors[keyword];
    } else {
      colors[keyword] = value.trim();
    }
    await this.setControlValue('keywordColors', colors);
  }

  private async setKeywordGroupColor(
    group: KeywordGroup,
    value: string,
  ): Promise<void> {
    const colors: Partial<Record<KeywordGroup, string>> = {
      ...(this.plugin.settings.keywordGroupColors ?? {}),
    };
    if (value.trim().length === 0) {
      delete colors[group];
    } else {
      colors[group] = value.trim();
    }
    await this.setControlValue('keywordGroupColors', colors);
    // Children without an explicit override now inherit the new group colour.
    for (const [keyword, entry] of this.keywordColorPickers) {
      if (entry.group !== group) {
        continue;
      }
      if (this.plugin.settings.keywordColors?.[keyword]) {
        continue;
      }
      entry.picker.setValue(value.trim());
    }
  }

  /**
   * Saved searches as a mutable list. Rows open the existing saved-search
   * dialog for editing; add/delete/reorder use the SavedSearchManager helpers.
   */
  private buildSavedSearchesList(): SettingDefinitionList {
    const searches = getSavedSearches(this.plugin.settings);
    return {
      type: 'list',
      heading: 'Saved searches',
      emptyState:
        'No saved searches yet. Add one to reuse a query from the Task List.',
      items: searches.map((search) => ({
        name: search.name || '(unnamed)',
        desc: search.query,
        action: () => this.openSavedSearchDialog(search),
      })),
      addItem: {
        name: 'Add saved search',
        action: () => this.openSavedSearchDialog(null),
      },
      onDelete: (index) => this.removeSavedSearchAt(index),
      onReorder: (oldIndex, newIndex) =>
        this.moveSavedSearch(oldIndex, newIndex),
    };
  }

  private openSavedSearchDialog(search: SavedSearch | null): void {
    const dialog = new SavedSearchDialog({
      existingSearch: search ?? undefined,
      onSave: (data) => {
        void (async () => {
          if (search) {
            updateSavedSearch(this.plugin.settings, search.id, {
              name: data.name,
              query: data.query,
              viewMode: data.viewMode,
              sortMethod: data.sortMethod,
              sortDirection: data.sortDirection,
              groupBy: data.groupBy,
              groupDirection: data.groupDirection,
              futureTaskSorting: data.futureTaskSorting,
              matchCase: data.matchCase,
            });
          } else {
            addSavedSearch(
              this.plugin.settings,
              createSavedSearch(data.name, data.query, {
                viewMode: data.viewMode,
                sortMethod: data.sortMethod,
                sortDirection: data.sortDirection,
                groupBy: data.groupBy,
                groupDirection: data.groupDirection,
                futureTaskSorting: data.futureTaskSorting,
                matchCase: data.matchCase,
              }),
            );
          }
          await this.plugin.saveSettings();
          this.update();
        })();
      },
      onCancel: () => {
        // no-op; the dialog closes itself
      },
    });
    dialog.open();
  }

  private removeSavedSearchAt(index: number): void {
    const search = getSavedSearches(this.plugin.settings)[index];
    if (!search) {
      return;
    }
    deleteSavedSearch(this.plugin.settings, search.id);
    void this.plugin.saveSettings();
    this.update();
  }

  private moveSavedSearch(oldIndex: number, newIndex: number): void {
    reorderSavedSearches(this.plugin.settings, oldIndex, newIndex);
    void this.plugin.saveSettings();
    this.update();
  }

  /** A page listing the five keyword groups as editable lists. */
  private buildKeywordsPage(): SettingDefinitionPage {
    return {
      type: 'page',
      name: 'Keywords',
      desc: 'Custom keywords per state group. Prefix a built-in keyword with - to remove it.',
      items: [
        this.buildKeywordList(
          'additionalInactiveKeywords',
          'Inactive',
          'Keywords for tasks not yet started (e.g. FIXME, HACK). Built-in: TODO, LATER.',
        ),
        this.buildKeywordList(
          'additionalActiveKeywords',
          'Active',
          'Keywords for tasks currently being worked on (e.g. STARTED). Built-in: DOING, NOW, IN-PROGRESS.',
        ),
        this.buildKeywordList(
          'additionalWaitingKeywords',
          'Waiting',
          'Keywords for blocked or paused tasks (e.g. ON-HOLD). Built-in: WAIT, WAITING.',
        ),
        this.buildKeywordList(
          'additionalCompletedKeywords',
          'Completed',
          'Keywords for finished or abandoned tasks (e.g. NEVER). Built-in: DONE, CANCELLED, CANCELED.',
        ),
        this.buildKeywordList(
          'additionalArchivedKeywords',
          'Archived',
          'Keywords for archived tasks (e.g. OLD). Styled but NOT collected. Built-in: ARCHIVED.',
        ),
        {
          name: 'Migrated state keyword',
          desc: 'Keyword or text to set on the source task after migrating to daily note. Leave empty to disable.',
          control: {
            type: 'text',
            key: 'migrateToTodayState',
            placeholder: '(disabled)',
          },
        },
      ],
    };
  }

  /** A single keyword group as a mutable list of tokens. */
  private buildKeywordList(
    settingKey: KeywordSettingKey,
    heading: string,
    description: string,
  ): SettingDefinitionList {
    const values = [
      ...((this.plugin.settings[settingKey] as string[] | undefined) ?? []),
    ];
    return {
      type: 'list',
      heading,
      cls: `todoseq-keyword-list ${this.keywordListClass(settingKey)}`,
      emptyState: `${description} No custom keywords added.`,
      items: values.map((value, index) => ({
        name: value || `Keyword ${index + 1}`,
        control: {
          type: 'text',
          key: `${settingKey}#${index}`,
          placeholder: 'KEYWORD or -BUILTIN',
        },
      })),
      addItem: {
        name: 'Add keyword',
        action: () => this.addKeywordToken(settingKey),
      },
      onDelete: (index) => this.deleteKeywordToken(settingKey, index),
      onReorder: (oldIndex, newIndex) =>
        this.reorderKeywordToken(settingKey, oldIndex, newIndex),
    };
  }

  private keywordListClass(settingKey: KeywordSettingKey): string {
    return `todoseq-keyword-list-${this.keywordSettingToGroup[settingKey]}`;
  }

  private addKeywordToken(settingKey: KeywordSettingKey): void {
    const current = [...(this.plugin.settings[settingKey] ?? [])];
    current.push('');
    this.plugin.settings[settingKey] = current;
    void this.plugin.saveSettings();
    this.update();
  }

  private deleteKeywordToken(
    settingKey: KeywordSettingKey,
    index: number,
  ): void {
    const current = [...(this.plugin.settings[settingKey] ?? [])];
    if (index < 0 || index >= current.length) {
      return;
    }
    current.splice(index, 1);
    this.plugin.settings[settingKey] = current;
    void this.plugin.saveSettings();
    void this.applyKeywordGroups();
    this.update();
  }

  private reorderKeywordToken(
    settingKey: KeywordSettingKey,
    oldIndex: number,
    newIndex: number,
  ): void {
    const current = [...(this.plugin.settings[settingKey] ?? [])];
    if (
      oldIndex < 0 ||
      oldIndex >= current.length ||
      newIndex < 0 ||
      newIndex >= current.length
    ) {
      return;
    }
    const [moved] = current.splice(oldIndex, 1);
    if (moved !== undefined) {
      current.splice(newIndex, 0, moved);
    }
    this.plugin.settings[settingKey] = current;
    void this.plugin.saveSettings();
    this.update();
  }

  /** The state-transition statements as a mutable list of rows. */
  private buildTransitionList(): SettingDefinitionList {
    const statements = [
      ...this.plugin.settings.stateTransitions.transitionStatements,
    ];
    return {
      type: 'list',
      heading: 'Transitions',
      cls: 'todoseq-transition-list',
      emptyState:
        'No transitions defined. Add one like "TODO -> DOING -> DONE" (use (a | b) for multiple initial states).',
      items: statements.map((statement, index) => ({
        name: statement || `Transition ${index + 1}`,
        control: {
          type: 'text',
          key: `transitionStatements#${index}`,
          placeholder: 'TODO -> DOING -> DONE',
        },
      })),
      addItem: {
        name: 'Add transition',
        action: () => this.addTransitionStatement(),
      },
      onDelete: (index) => this.deleteTransitionStatement(index),
      onReorder: (oldIndex, newIndex) =>
        this.reorderTransitionStatement(oldIndex, newIndex),
    };
  }

  private addTransitionStatement(): void {
    const statements = [
      ...this.plugin.settings.stateTransitions.transitionStatements,
    ];
    statements.push('');
    this.plugin.settings.stateTransitions.transitionStatements = statements;
    void this.plugin.saveSettings();
    this.update();
  }

  private deleteTransitionStatement(index: number): void {
    const statements = [
      ...this.plugin.settings.stateTransitions.transitionStatements,
    ];
    if (index < 0 || index >= statements.length) {
      return;
    }
    statements.splice(index, 1);
    this.plugin.settings.stateTransitions.transitionStatements = statements;
    void (async () => {
      await this.plugin.saveSettings();
      this.validateTransitionSettings();
      this.plugin.updateTaskListViewSettings();
      this.plugin.updateTaskUpdateCoordinatorSettings();
    })();
    this.update();
  }

  private reorderTransitionStatement(oldIndex: number, newIndex: number): void {
    const statements = [
      ...this.plugin.settings.stateTransitions.transitionStatements,
    ];
    if (
      oldIndex < 0 ||
      oldIndex >= statements.length ||
      newIndex < 0 ||
      newIndex >= statements.length
    ) {
      return;
    }
    const [moved] = statements.splice(oldIndex, 1);
    if (moved !== undefined) {
      statements.splice(newIndex, 0, moved);
    }
    this.plugin.settings.stateTransitions.transitionStatements = statements;
    void this.plugin.saveSettings();
    this.update();
  }

  private parseKeywordInputsFromUI(): Record<KeywordSettingKey, string[]> {
    return this.getKeywordInputsFromSettings();
  }

  private validateKeywordRegexForAllGroups(
    parsedBySetting: Record<KeywordSettingKey, string[]>,
  ): {
    validBySetting: Record<KeywordSettingKey, string[]>;
    errorsByGroup: Record<KeywordGroup, string[]>;
  } {
    const validBySetting: Record<KeywordSettingKey, string[]> = {
      additionalActiveKeywords: [],
      additionalInactiveKeywords: [],
      additionalWaitingKeywords: [],
      additionalCompletedKeywords: [],
      additionalArchivedKeywords: [],
    };

    const errorsByGroup: Record<KeywordGroup, string[]> = {
      activeKeywords: [],
      inactiveKeywords: [],
      waitingKeywords: [],
      completedKeywords: [],
      archivedKeywords: [],
    };

    for (const settingKey of Object.keys(
      parsedBySetting,
    ) as KeywordSettingKey[]) {
      const group = this.keywordSettingToGroup[settingKey];
      for (const token of parsedBySetting[settingKey]) {
        const keywordToValidate = token.startsWith('-')
          ? token.slice(1)
          : token;
        try {
          TaskParser.validateKeywords([keywordToValidate]);
          validBySetting[settingKey].push(token);
        } catch {
          errorsByGroup[group].push(`Invalid keyword syntax: ${token}`);
        }
      }
    }

    return { validBySetting, errorsByGroup };
  }

  private toGroupKeywordInput(bySetting: Record<KeywordSettingKey, string[]>): {
    activeKeywords: string[];
    inactiveKeywords: string[];
    waitingKeywords: string[];
    completedKeywords: string[];
    archivedKeywords: string[];
  } {
    return {
      activeKeywords: bySetting.additionalActiveKeywords,
      inactiveKeywords: bySetting.additionalInactiveKeywords,
      waitingKeywords: bySetting.additionalWaitingKeywords,
      completedKeywords: bySetting.additionalCompletedKeywords,
      archivedKeywords: bySetting.additionalArchivedKeywords,
    };
  }

  private renderKeywordValidationState(
    regexErrorsByGroup: Record<KeywordGroup, string[]>,
    keywordErrors: Array<{ group: KeywordGroup; message: string }>,
    keywordWarnings: Array<{ group: KeywordGroup; message: string }>,
  ): void {
    const errorsByGroup: Record<KeywordGroup, string[]> = {
      activeKeywords: [...regexErrorsByGroup.activeKeywords],
      inactiveKeywords: [...regexErrorsByGroup.inactiveKeywords],
      waitingKeywords: [...regexErrorsByGroup.waitingKeywords],
      completedKeywords: [...regexErrorsByGroup.completedKeywords],
      archivedKeywords: [...regexErrorsByGroup.archivedKeywords],
    };
    const warningsByGroup: Record<KeywordGroup, string[]> = {
      activeKeywords: [],
      inactiveKeywords: [],
      waitingKeywords: [],
      completedKeywords: [],
      archivedKeywords: [],
    };

    for (const issue of keywordErrors) {
      errorsByGroup[issue.group].push(issue.message);
    }

    for (const issue of keywordWarnings) {
      warningsByGroup[issue.group].push(issue.message);
    }

    const groups: KeywordGroup[] = [
      'activeKeywords',
      'inactiveKeywords',
      'waitingKeywords',
      'completedKeywords',
      'archivedKeywords',
    ];

    for (const group of groups) {
      const container = this.containerEl?.querySelector<HTMLElement>(
        `.todoseq-keyword-list-${group}`,
      );
      if (!container) {
        continue;
      }

      container
        .querySelectorAll(
          '.todoseq-setting-item-error, .todoseq-setting-item-warning',
        )
        .forEach((el) => el.remove());
      container
        .querySelectorAll('input')
        .forEach((el) => el.classList.remove('todoseq-invalid-input'));

      const groupErrors = Array.from(new Set(errorsByGroup[group]));
      const groupWarnings = Array.from(new Set(warningsByGroup[group]));

      if (groupErrors.length > 0) {
        const errorDiv = container.createDiv({
          cls: 'todoseq-setting-item-error',
        });
        for (const message of groupErrors) {
          errorDiv.createDiv({ text: message });
        }
        container
          .querySelectorAll('input')
          .forEach((el) => el.classList.add('todoseq-invalid-input'));
      }

      if (groupWarnings.length > 0) {
        const warningDiv = container.createDiv({
          cls: 'todoseq-setting-item-warning',
        });
        for (const message of groupWarnings) {
          warningDiv.createDiv({ text: message });
        }
      }
    }
  }

  /**
   * Populate a default state dropdown with keywords from the specified group.
   */
  private populateDefaultStateDropdown(
    dropdown: DropdownComponent,
    keywords: Set<string>,
  ): void {
    // Clear existing options
    dropdown.selectEl.empty();

    // Add keywords in sorted order
    const sortedKeywords = Array.from(keywords).sort();
    for (const keyword of sortedKeywords) {
      dropdown.selectEl.createEl('option', {
        text: keyword,
        attr: { value: keyword },
      });
    }
  }

  /**
   * Get the default value for a keyword group.
   * Uses the preferred default (TODO/DOING/DONE) if it exists in the keyword set,
   * otherwise uses the first keyword from the ordered list for that group.
   */
  private getDefaultForGroup(
    keywordManager: KeywordManager,
    group: 'inactiveKeywords' | 'activeKeywords' | 'completedKeywords',
    preferredDefault: string,
  ): string {
    const keywordSet = keywordManager.getKeywordsForGroup(group);
    if (keywordSet.length === 0) {
      return preferredDefault;
    }
    if (keywordSet.includes(preferredDefault)) {
      return preferredDefault;
    }
    return keywordSet[0];
  }

  /**
   * Update all default state dropdowns when keywords change.
   */
  private async updateDefaultStateDropdowns(): Promise<void> {
    const keywordManager = new KeywordManager(this.plugin.settings);
    let needsSave = false;

    if (this.defaultStateDropdowns.inactive) {
      const currentValue = this.defaultStateDropdowns.inactive.getValue();
      this.populateDefaultStateDropdown(
        this.defaultStateDropdowns.inactive,
        keywordManager.getInactiveSet(),
      );
      // Restore current value if it still exists, otherwise use computed default
      if (currentValue && keywordManager.getInactiveSet().has(currentValue)) {
        this.defaultStateDropdowns.inactive.setValue(currentValue);
      } else {
        const defaultInactive = this.getDefaultForGroup(
          keywordManager,
          'inactiveKeywords',
          'TODO',
        );
        this.defaultStateDropdowns.inactive.setValue(defaultInactive);
        this.plugin.settings.stateTransitions.defaultInactive = defaultInactive;
        needsSave = true;
      }
    }

    if (this.defaultStateDropdowns.active) {
      const currentValue = this.defaultStateDropdowns.active.getValue();
      this.populateDefaultStateDropdown(
        this.defaultStateDropdowns.active,
        keywordManager.getActiveSet(),
      );
      if (currentValue && keywordManager.getActiveSet().has(currentValue)) {
        this.defaultStateDropdowns.active.setValue(currentValue);
      } else {
        const defaultActive = this.getDefaultForGroup(
          keywordManager,
          'activeKeywords',
          'DOING',
        );
        this.defaultStateDropdowns.active.setValue(defaultActive);
        this.plugin.settings.stateTransitions.defaultActive = defaultActive;
        needsSave = true;
      }
    }

    if (this.defaultStateDropdowns.completed) {
      const currentValue = this.defaultStateDropdowns.completed.getValue();
      this.populateDefaultStateDropdown(
        this.defaultStateDropdowns.completed,
        keywordManager.getCompletedSet(),
      );
      if (currentValue && keywordManager.getCompletedSet().has(currentValue)) {
        this.defaultStateDropdowns.completed.setValue(currentValue);
      } else {
        const defaultCompleted = this.getDefaultForGroup(
          keywordManager,
          'completedKeywords',
          'DONE',
        );
        this.defaultStateDropdowns.completed.setValue(defaultCompleted);
        this.plugin.settings.stateTransitions.defaultCompleted =
          defaultCompleted;
        needsSave = true;
      }
    }

    if (needsSave) {
      await this.plugin.saveSettings();
    }
  }

  /**
   * Validate and display transition settings errors.
   * Attaches errors to individual settings using the same pattern as keyword errors.
   */
  private validateTransitionSettings(): void {
    const keywordManager = new KeywordManager(this.plugin.settings);
    const parser = new TransitionParser(keywordManager);
    const result = parser.parse(
      this.plugin.settings.stateTransitions.transitionStatements,
    );

    // Clear previous errors from all transition settings
    this.clearTransitionSettingErrors();

    // Check for default state errors (only if value is not empty)
    const allKeywords = keywordManager.getAllKeywords();

    // Validate inactive default
    const inactive = this.plugin.settings.stateTransitions.defaultInactive;
    if (inactive && !allKeywords.includes(inactive)) {
      this.attachInfoToSetting(
        this.transitionSettings.inactive,
        `Default inactive state '${inactive}' not found in keywords.`,
      );
    }

    // Validate active default
    const active = this.plugin.settings.stateTransitions.defaultActive;
    if (active && !allKeywords.includes(active)) {
      this.attachInfoToSetting(
        this.transitionSettings.active,
        `Default active state '${active}' not found in keywords.`,
      );
    }

    // Validate completed default
    const completed = this.plugin.settings.stateTransitions.defaultCompleted;
    if (completed && !allKeywords.includes(completed)) {
      this.attachInfoToSetting(
        this.transitionSettings.completed,
        `Default completed state '${completed}' not found in keywords.`,
      );
    }

    // Display transition errors - use same styling as keyword errors
    if (result.errors.length > 0) {
      this.attachErrorsToContainer(
        '.todoseq-transition-list',
        result.errors.map((e) => e.message),
      );
    }
  }

  /** Attach error messages to the first element matching `selector`. */
  private attachErrorsToContainer(selector: string, messages: string[]): void {
    if (messages.length === 0) {
      return;
    }
    const container = this.containerEl?.querySelector<HTMLElement>(selector);
    if (!container) {
      return;
    }
    const errorDiv = container.createDiv({
      cls: 'todoseq-setting-item-error',
    });
    for (const message of messages) {
      errorDiv.createDiv({ text: message });
    }
    container
      .querySelectorAll('input')
      .forEach((el) => el.classList.add('todoseq-invalid-input'));
  }

  /**
   * Clear previous error/warning elements from transition settings.
   */
  private clearTransitionSettingErrors(): void {
    const settings = [
      this.transitionSettings.inactive,
      this.transitionSettings.active,
      this.transitionSettings.completed,
      this.transitionSettings.transitions,
    ];

    for (const setting of settings) {
      if (!setting) continue;

      // Clear error divs
      const existingErrors = setting.settingEl.querySelectorAll(
        '.todoseq-setting-item-error',
      );
      for (const el of Array.from(existingErrors)) {
        el.remove();
      }

      // Clear info/warning divs
      const existingInfos = setting.settingEl.querySelectorAll(
        '.todoseq-setting-item-info',
      );
      for (const el of Array.from(existingInfos)) {
        el.remove();
      }

      // Clear invalid input highlighting
      const textArea = setting.settingEl.querySelector('textarea');
      if (textArea) {
        textArea.classList.remove('todoseq-invalid-input');
      }
    }

    // Clear errors attached to the transitions list container.
    const container = this.containerEl?.querySelector<HTMLElement>(
      '.todoseq-transition-list',
    );
    if (container) {
      container
        .querySelectorAll(
          '.todoseq-setting-item-error, .todoseq-setting-item-warning',
        )
        .forEach((el) => el.remove());
      container
        .querySelectorAll('input')
        .forEach((el) => el.classList.remove('todoseq-invalid-input'));
    }
  }

  /**
   * Attach info messages to a setting's info area.
   */
  private attachInfoToSetting(
    setting: Setting | undefined,
    message: string,
  ): void {
    if (!setting) return;

    const settingInfo = setting.settingEl.querySelector('.setting-item-info');
    if (!settingInfo) return;

    let infoDiv = settingInfo.querySelector('.todoseq-info-message');
    if (!infoDiv) {
      infoDiv = settingInfo.createDiv({
        cls: 'todoseq-setting-item-warning',
      });
    }

    infoDiv.createDiv({ text: message });
  }

  /**
   * Attach error messages to a setting, similar to keyword errors.
   */
  private attachErrorsToSetting(
    setting: Setting | undefined,
    messages: string[],
  ): void {
    if (!setting || messages.length === 0) return;

    const settingInfo = setting.settingEl.querySelector('.setting-item-info');
    if (!settingInfo) return;

    const errorDiv = settingInfo.createDiv({
      cls: 'todoseq-setting-item-error',
    });
    for (const message of messages) {
      errorDiv.createDiv({ text: message });
    }

    // Highlight the input field
    const textArea = setting.settingEl.querySelector('textarea');
    if (textArea) {
      textArea.classList.add('todoseq-invalid-input');
    }
  }
}
