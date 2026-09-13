import { Search } from '../../search/search';
import { SortDirection } from '../../utils/task-sort';
import { GroupByField } from '../../utils/task-group';

/**
 * Valid sort options for embedded task lists
 */
export type SortOption =
  | 'filepath'
  | 'scheduled'
  | 'deadline'
  | 'closed'
  | 'started'
  | 'priority'
  | 'urgency'
  | 'keyword'
  | 'tag';

/**
 * Valid completed task display options
 */
export type CompletedOption = 'show' | 'hide' | 'sort-to-end';

/**
 * Valid future task display options
 */
export type FutureOption =
  'show-all' | 'show-upcoming' | 'hide' | 'sort-to-end';

/**
 * Valid grouping options for embedded task lists (location grouping)
 */
export type GroupByOption = GroupByField;

/** Sort aliases mapped to their canonical option (backward compatibility). */
const SORT_ALIASES: Record<string, SortOption | 'default'> = {
  default: 'default',
  priority: 'priority',
  due: 'deadline',
  deadline: 'deadline',
  urgency: 'urgency',
  urgent: 'urgency',
  scheduled: 'scheduled',
  filepath: 'filepath',
  file: 'filepath',
  path: 'filepath',
  keyword: 'keyword',
  keywords: 'keyword',
  closed: 'closed',
  started: 'started',
  tag: 'tag',
  tags: 'tag',
};

/** Canonical sort fields, shown in validation messages. */
const SORT_FIELDS: SortOption[] = [
  'filepath',
  'scheduled',
  'deadline',
  'closed',
  'started',
  'priority',
  'urgency',
  'keyword',
  'tag',
];

const GROUP_BY_FIELDS: GroupByOption[] = [
  'folder',
  'file',
  'heading',
  'status',
  'priority',
  'scheduled',
  'deadline',
  'closed',
  'started',
  'tag',
];

/**
 * Parse a `"<field> [asc|desc]"` token, validating the field against
 * `validFields` (aliases allowed) and the direction against `asc`/`desc`.
 * `displayFields` is what the error message lists.
 */
function parseFieldWithDirection(
  raw: string,
  validFields: readonly string[],
  displayFields: readonly string[],
  fieldNoun: string,
  directionNoun: string,
): { field: string; direction?: SortDirection } {
  const tokens = raw
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0 || tokens.length > 2) {
    throw new Error(
      `Invalid ${fieldNoun} value: "${raw}". Expected "<field> [asc|desc]"`,
    );
  }
  if (!validFields.includes(tokens[0])) {
    throw new Error(
      `Invalid ${fieldNoun}: ${tokens[0]}. Valid options: ${displayFields.join(', ')}`,
    );
  }
  if (tokens.length === 2) {
    const direction = tokens[1];
    if (direction !== 'asc' && direction !== 'desc') {
      throw new Error(
        `Invalid ${directionNoun}: ${tokens[1]}. Valid options: asc, desc`,
      );
    }
    return { field: tokens[0], direction };
  }
  return { field: tokens[0] };
}

/**
 * Parsed parameters from a todoseq code block
 */
export interface TodoseqParameters {
  searchQuery: string;
  sortMethod: SortOption | 'default';
  sortDirection?: SortDirection;
  secondarySortMethod?: SortOption;
  secondarySortDirection?: SortDirection;
  completed?: CompletedOption;
  future?: FutureOption;
  limit?: number;
  showFile?: boolean;
  showUrgency?: boolean; // show the calculated urgency score next to the file info
  title?: string;
  showQuery?: boolean;
  wrapContent?: boolean | 'dynamic';
  collapse?: boolean;
  showScheduledDate?: boolean;
  showDeadlineDate?: boolean;
  showClosedDate?: boolean;
  // Warning period overrides (per-code-block)
  upcomingPeriod?: number;
  scheduledWarningPeriod?: number;
  deadlineWarningPeriod?: number;
  skipScheduledWarningIfDeadline?: boolean;
  skipDeadlineWarningIfScheduled?: boolean;
  showDescription?: 'hide' | 'show';
  groupBy?: GroupByOption;
  groupByDirection?: SortDirection;
  error?: string;
}

/**
 * Parses the content of a todoseq code block to extract search and sort parameters.
 *
 * Example code block:
 * ```
 * todoseq
 * search: tag:project1 AND content:"example"
 * sort: priority
 * completed: hide
 * show-completed: hide
 * future: show-all
 * show-future: show-all
 * limit: 10
 * ```
 */
export class TodoseqCodeBlockParser {
  /**
   * Parse parameters from code block source content
   * @param source The content of the code block
   * @returns Parsed parameters with validation
   */
  static parse(source: string): TodoseqParameters {
    try {
      const lines = source.split('\n');
      let searchQuery = '';
      let sortMethod: SortOption | 'default' = 'default';
      let sortDirection: SortDirection | undefined;
      let secondarySortMethod: SortOption | undefined;
      let secondarySortDirection: SortDirection | undefined;
      let completed: CompletedOption | undefined;
      let future: FutureOption | undefined;
      let limit: number | undefined;
      let showFile: boolean | undefined;
      let showUrgency: boolean | undefined; // show the calculated urgency score
      let title: string | undefined;
      let showQuery: boolean | undefined;
      let wrapContent: boolean | 'dynamic' | undefined;
      let collapse: boolean | undefined;
      let showScheduledDate: boolean | undefined;
      let showDeadlineDate: boolean | undefined;
      let showClosedDate: boolean | undefined;
      let upcomingPeriod: number | undefined;
      let scheduledWarningPeriod: number | undefined;
      let deadlineWarningPeriod: number | undefined;
      let skipScheduledWarningIfDeadline: boolean | undefined;
      let skipDeadlineWarningIfScheduled: boolean | undefined;
      let showDescription: 'hide' | 'show' | undefined;
      let groupBy: GroupByOption | undefined;
      let groupByDirection: SortDirection | undefined;

      // Parse each line for parameters
      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith('search:')) {
          searchQuery = trimmed.substring('search:'.length).trim();
        } else if (trimmed.startsWith('sort:')) {
          const sortValue = trimmed.substring('sort:'.length).trim();
          const sortKeys = sortValue
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0);
          if (sortKeys.length === 0 || sortKeys.length > 2) {
            throw new Error(
              'Invalid sort value. Use up to two keys, e.g. "sort: priority desc, scheduled"',
            );
          }

          const validSortFields = Object.keys(SORT_ALIASES);
          const primary = parseFieldWithDirection(
            sortKeys[0],
            validSortFields,
            SORT_FIELDS,
            'sort method',
            'sort direction',
          );
          sortMethod = SORT_ALIASES[primary.field];
          sortDirection = primary.direction;

          if (sortKeys.length === 2) {
            const secondary = parseFieldWithDirection(
              sortKeys[1],
              validSortFields,
              SORT_FIELDS,
              'sort method',
              'sort direction',
            );
            const mappedSecondary = SORT_ALIASES[secondary.field];
            if (mappedSecondary === 'default') {
              throw new Error(
                'Invalid secondary sort method: default. Use a real field',
              );
            }
            secondarySortMethod = mappedSecondary;
            secondarySortDirection = secondary.direction;
          }
        } else if (trimmed.startsWith('group-by:')) {
          const groupValue = trimmed.substring('group-by:'.length).trim();
          const parsed = parseFieldWithDirection(
            groupValue,
            GROUP_BY_FIELDS,
            GROUP_BY_FIELDS,
            'group-by option',
            'group-by direction',
          );
          groupBy = parsed.field as GroupByOption;
          groupByDirection = parsed.direction;
        } else if (trimmed.startsWith('show-completed:')) {
          const completedValue = trimmed
            .substring('show-completed:'.length)
            .trim()
            .toLowerCase();
          const validCompleted: CompletedOption[] = [
            'show',
            'hide',
            'sort-to-end',
          ];
          if (validCompleted.includes(completedValue as CompletedOption)) {
            completed = completedValue as CompletedOption;
          } else {
            throw new Error(
              `Invalid show-completed option: ${completedValue}. Valid options: show, hide, sort-to-end`,
            );
          }
        } else if (trimmed.startsWith('completed:')) {
          const completedValue = trimmed
            .substring('completed:'.length)
            .trim()
            .toLowerCase();
          const validCompleted: CompletedOption[] = [
            'show',
            'hide',
            'sort-to-end',
          ];
          if (validCompleted.includes(completedValue as CompletedOption)) {
            completed = completedValue as CompletedOption;
          } else {
            throw new Error(
              `Invalid completed option: ${completedValue}. Valid options: show, hide, sort-to-end`,
            );
          }
        } else if (trimmed.startsWith('show-future:')) {
          const futureValue = trimmed
            .substring('show-future:'.length)
            .trim()
            .toLowerCase();
          const validFuture: FutureOption[] = [
            'show-all',
            'show-upcoming',
            'hide',
            'sort-to-end',
          ];
          if (validFuture.includes(futureValue as FutureOption)) {
            future = futureValue as FutureOption;
          } else {
            throw new Error(
              `Invalid show-future option: ${futureValue}. Valid options: show-all, show-upcoming, hide, sort-to-end`,
            );
          }
        } else if (trimmed.startsWith('future:')) {
          const futureValue = trimmed
            .substring('future:'.length)
            .trim()
            .toLowerCase();
          const validFuture: FutureOption[] = [
            'show-all',
            'show-upcoming',
            'hide',
            'sort-to-end',
          ];
          if (validFuture.includes(futureValue as FutureOption)) {
            future = futureValue as FutureOption;
          } else {
            throw new Error(
              `Invalid future option: ${futureValue}. Valid options: show-all, show-upcoming, hide, sort-to-end`,
            );
          }
        } else if (trimmed.startsWith('limit:')) {
          const limitValue = trimmed.substring('limit:'.length).trim();
          const parsedLimit = parseInt(limitValue, 10);
          if (isNaN(parsedLimit) || parsedLimit < 1) {
            throw new Error(
              `Invalid limit value: ${limitValue}. Must be a positive number.`,
            );
          }
          limit = parsedLimit;
        } else if (trimmed.startsWith('show-file:')) {
          const showFileValue = trimmed
            .substring('show-file:'.length)
            .trim()
            .toLowerCase();
          if (showFileValue === 'false' || showFileValue === 'hide') {
            showFile = false;
          } else if (showFileValue === 'true' || showFileValue === 'show') {
            showFile = true;
          } else {
            throw new Error(
              `Invalid show-file option: ${showFileValue}. Valid options: true, false, show, hide`,
            );
          }
        } else if (trimmed.startsWith('show-urgency:')) {
          const showUrgencyValue = trimmed
            .substring('show-urgency:'.length)
            .trim()
            .toLowerCase();
          if (showUrgencyValue === 'false' || showUrgencyValue === 'hide') {
            showUrgency = false;
          } else if (
            showUrgencyValue === 'true' ||
            showUrgencyValue === 'show'
          ) {
            showUrgency = true;
          } else {
            throw new Error(
              `Invalid show-urgency option: ${showUrgencyValue}. Valid options: true, false, show, hide`,
            );
          }
        } else if (trimmed.startsWith('title:')) {
          title = trimmed.substring('title:'.length).trim();
        } else if (trimmed.startsWith('show-query:')) {
          const showQueryValue = trimmed
            .substring('show-query:'.length)
            .trim()
            .toLowerCase();
          if (showQueryValue === 'false' || showQueryValue === 'hide') {
            showQuery = false;
          } else if (showQueryValue === 'true' || showQueryValue === 'show') {
            showQuery = true;
          } else {
            throw new Error(
              `Invalid show-query option: ${showQueryValue}. Valid options: true, false, show, hide`,
            );
          }
        } else if (trimmed.startsWith('wrap-content:')) {
          const wrapValue = trimmed
            .substring('wrap-content:'.length)
            .trim()
            .toLowerCase();
          if (wrapValue === 'false' || wrapValue === 'truncate') {
            wrapContent = false;
          } else if (wrapValue === 'true' || wrapValue === 'wrap') {
            wrapContent = true;
          } else if (wrapValue === 'dynamic') {
            wrapContent = 'dynamic';
          } else {
            throw new Error(
              `Invalid wrap-content option: ${wrapValue}. Valid options: true, false, wrap, truncate, dynamic`,
            );
          }
        } else if (trimmed.startsWith('collapse:')) {
          const collapseValue = trimmed
            .substring('collapse:'.length)
            .trim()
            .toLowerCase();
          if (collapseValue === 'false') {
            collapse = false;
          } else if (collapseValue === 'true') {
            collapse = true;
          } else {
            throw new Error(
              `Invalid collapse option: ${collapseValue}. Valid options: true, false`,
            );
          }
        } else if (trimmed.startsWith('show-scheduled-date:')) {
          const value = trimmed
            .substring('show-scheduled-date:'.length)
            .trim()
            .toLowerCase();
          if (value === 'false' || value === 'hide') {
            showScheduledDate = false;
          } else if (value === 'true' || value === 'show') {
            showScheduledDate = true;
          } else {
            throw new Error(
              `Invalid show-scheduled-date option: ${value}. Valid options: true, false, show, hide`,
            );
          }
        } else if (trimmed.startsWith('show-deadline-date:')) {
          const value = trimmed
            .substring('show-deadline-date:'.length)
            .trim()
            .toLowerCase();
          if (value === 'false' || value === 'hide') {
            showDeadlineDate = false;
          } else if (value === 'true' || value === 'show') {
            showDeadlineDate = true;
          } else {
            throw new Error(
              `Invalid show-deadline-date option: ${value}. Valid options: true, false, show, hide`,
            );
          }
        } else if (trimmed.startsWith('show-closed-date:')) {
          const value = trimmed
            .substring('show-closed-date:'.length)
            .trim()
            .toLowerCase();
          if (value === 'false' || value === 'hide') {
            showClosedDate = false;
          } else if (value === 'true' || value === 'show') {
            showClosedDate = true;
          } else {
            throw new Error(
              `Invalid show-closed-date option: ${value}. Valid options: true, false, show, hide`,
            );
          }
        } else if (trimmed.startsWith('upcoming-period:')) {
          const periodValue = trimmed
            .substring('upcoming-period:'.length)
            .trim();
          const parsedPeriod = parseInt(periodValue, 10);
          if (isNaN(parsedPeriod) || parsedPeriod < 0) {
            throw new Error(
              `Invalid upcoming-period value: ${periodValue}. Must be a non-negative number.`,
            );
          }
          upcomingPeriod = parsedPeriod;
        } else if (trimmed.startsWith('scheduled-warning-period:')) {
          const periodValue = trimmed
            .substring('scheduled-warning-period:'.length)
            .trim();
          const parsedPeriod = parseInt(periodValue, 10);
          if (isNaN(parsedPeriod) || parsedPeriod < 0) {
            throw new Error(
              `Invalid scheduled-warning-period value: ${periodValue}. Must be a non-negative number.`,
            );
          }
          scheduledWarningPeriod = parsedPeriod;
        } else if (trimmed.startsWith('deadline-warning-period:')) {
          const periodValue = trimmed
            .substring('deadline-warning-period:'.length)
            .trim();
          const parsedPeriod = parseInt(periodValue, 10);
          if (isNaN(parsedPeriod) || parsedPeriod < 0) {
            throw new Error(
              `Invalid deadline-warning-period value: ${periodValue}. Must be a non-negative number.`,
            );
          }
          deadlineWarningPeriod = parsedPeriod;
        } else if (trimmed.startsWith('skip-scheduled-warning-if-deadline:')) {
          const value = trimmed
            .substring('skip-scheduled-warning-if-deadline:'.length)
            .trim()
            .toLowerCase();
          if (value === 'false') {
            skipScheduledWarningIfDeadline = false;
          } else if (value === 'true') {
            skipScheduledWarningIfDeadline = true;
          } else {
            throw new Error(
              `Invalid skip-scheduled-warning-if-deadline option: ${value}. Valid options: true, false`,
            );
          }
        } else if (trimmed.startsWith('skip-deadline-warning-if-scheduled:')) {
          const value = trimmed
            .substring('skip-deadline-warning-if-scheduled:'.length)
            .trim()
            .toLowerCase();
          if (value === 'false') {
            skipDeadlineWarningIfScheduled = false;
          } else if (value === 'true') {
            skipDeadlineWarningIfScheduled = true;
          } else {
            throw new Error(
              `Invalid skip-deadline-warning-if-scheduled option: ${value}. Valid options: true, false`,
            );
          }
        } else if (trimmed.startsWith('show-description:')) {
          const showDescValue = trimmed
            .substring('show-description:'.length)
            .trim()
            .toLowerCase();
          if (['true', 'false', 'show', 'hide'].includes(showDescValue)) {
            // Map boolean-like values to the new enum
            if (showDescValue === 'true' || showDescValue === 'show') {
              showDescription = 'show';
            } else {
              showDescription = 'hide';
            }
          } else {
            throw new Error(
              `Invalid show-description option: ${showDescValue}. Valid options: true, false, show, hide`,
            );
          }
        }
      }

      // Validate search query syntax
      if (searchQuery) {
        try {
          Search.validate(searchQuery);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new Error(`Invalid search query: ${message}`);
        }
      }

      // Validate collapse option compatibility
      // collapse: true requires either a title or showQuery to be enabled (not explicitly false)
      // because there must be a clickable header to expand/collapse the list
      if (collapse === true && !title && showQuery === false) {
        throw new Error(
          'collapse option requires either title to be set or show-query to be enabled',
        );
      }

      return {
        searchQuery,
        sortMethod,
        sortDirection,
        secondarySortMethod,
        secondarySortDirection,
        completed,
        future,
        limit,
        showFile,
        showUrgency,
        title,
        showQuery,
        wrapContent,
        collapse,
        showScheduledDate,
        showDeadlineDate,
        showClosedDate,
        upcomingPeriod,
        scheduledWarningPeriod,
        deadlineWarningPeriod,
        skipScheduledWarningIfDeadline,
        skipDeadlineWarningIfScheduled,
        showDescription,
        groupBy,
        groupByDirection,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        searchQuery: '',
        sortMethod: 'default',
        sortDirection: undefined,
        secondarySortMethod: undefined,
        secondarySortDirection: undefined,
        error: errorMessage,
        showFile: undefined,
        showUrgency: undefined,
        title: undefined,
        showQuery: undefined,
        wrapContent: undefined,
        collapse: undefined,
        showScheduledDate: undefined,
        showDeadlineDate: undefined,
        showClosedDate: undefined,
        upcomingPeriod: undefined,
        scheduledWarningPeriod: undefined,
        deadlineWarningPeriod: undefined,
        skipScheduledWarningIfDeadline: undefined,
        skipDeadlineWarningIfScheduled: undefined,
        showDescription: undefined,
        groupBy: undefined,
        groupByDirection: undefined,
      };
    }
  }

  /**
   * Check if a code block might be affected by changes to a specific file
   * @param source The code block source content
   * @param changedFilePath The path of the file that changed
   * @returns True if the code block might display tasks from the changed file
   */
  static mightAffectCodeBlock(
    source: string,
    changedFilePath: string,
  ): boolean {
    // If no search query, it might show all tasks including from this file
    if (!source.includes('search:')) {
      return true;
    }

    // Parse the search query to check if it references the changed file
    const params = this.parse(source);
    if (params.error) {
      return true; // Be safe and assume it might be affected
    }

    // Check if search query contains file path references
    const searchQuery = params.searchQuery.toLowerCase();
    const filePath = changedFilePath.toLowerCase();

    // Check for file: filter
    if (searchQuery.includes('file:')) {
      return searchQuery.includes(filePath);
    }

    // Check for path: filter
    if (searchQuery.includes('path:')) {
      return searchQuery.includes(filePath);
    }

    // If no file-specific filters, assume it might be affected
    return true;
  }

  /**
   * Map completed option to internal completed task setting
   * @param completed The completed option from code block
   * @returns Internal completed task setting value
   */
  static getCompletedSetting(
    completed: CompletedOption | undefined,
  ): 'showAll' | 'sortToEnd' | 'hide' {
    if (!completed) {
      return 'showAll'; // Default to showing all
    }
    const map: Record<CompletedOption, 'showAll' | 'sortToEnd' | 'hide'> = {
      show: 'showAll',
      'sort-to-end': 'sortToEnd',
      hide: 'hide',
    };
    return map[completed];
  }

  /**
   * Map future option to internal future task setting
   * @param future The future option from code block
   * @returns Internal future task setting value
   */
  static getFutureSetting(
    future: FutureOption | undefined,
  ): 'showAll' | 'showUpcoming' | 'sortToEnd' | 'hideFuture' {
    if (!future) {
      return 'showAll'; // Default to showing all
    }
    const map: Record<
      FutureOption,
      'showAll' | 'showUpcoming' | 'sortToEnd' | 'hideFuture'
    > = {
      'show-all': 'showAll',
      'show-upcoming': 'showUpcoming',
      hide: 'hideFuture',
      'sort-to-end': 'sortToEnd',
    };
    return map[future];
  }
}
