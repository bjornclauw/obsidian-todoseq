import type { KeywordManager } from '../../utils/keyword-manager';
import {
  DEFAULT_PRIORITY_MAPPING,
  type ObsidianTasksConverterOptions,
  type PriorityMapping,
} from './obsidian-tasks-converter';

/**
 * Builds converter options from the live keyword configuration, so the importer
 * uses the same states and keyword set as the rest of TODOseq instead of
 * hard-coded values.
 */
export function buildConverterOptions(
  keywordManager: KeywordManager,
  priorityMapping: PriorityMapping = DEFAULT_PRIORITY_MAPPING,
): ObsidianTasksConverterOptions {
  const completed = keywordManager.getKeywordsForGroup('completedKeywords');
  const cancelled =
    completed.find((keyword) => /^CANCEL+ED$/i.test(keyword)) ??
    keywordManager.getDefaultCompleted();

  return {
    defaultState: keywordManager.getDefaultInactive(),
    inProgressState: keywordManager.getDefaultActive(),
    completedState: keywordManager.getDefaultCompleted(),
    cancelledState: cancelled,
    priorityMapping,
    includePriority: true,
    knownKeywords: keywordManager.getAllKeywords(),
  };
}
