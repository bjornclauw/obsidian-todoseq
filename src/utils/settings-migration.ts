import { DEFAULT_SAVED_SEARCHES } from '../settings/settings-types';
import { isSortMethod } from './task-sort';

/**
 * Settings migration utilities for TODOseq plugin.
 * Handles migrating settings from older versions to newer versions.
 */

export interface SettingsMigrations {
  version: number;
  migrate: (settings: Record<string, unknown>) => Record<string, unknown>;
}

// Note: Migrations v3 and v4 (smart date settings, warning periods) were
// no-op migrations that have been removed for simplicity. Existing users
// with settingsVersion < 5 jump straight to v5, which supplies all defaults
// via DefaultSettings.
const MIGRATIONS: SettingsMigrations[] = [
  {
    version: 1,
    migrate: (settings: Record<string, unknown>): Record<string, unknown> => {
      const migrated = { ...settings };

      if ('additionalTaskKeywords' in migrated) {
        migrated['additionalInactiveKeywords'] =
          migrated['additionalTaskKeywords'];
        delete migrated['additionalTaskKeywords'];
      }

      return migrated;
    },
  },
  {
    version: 2,
    migrate: (settings: Record<string, unknown>): Record<string, unknown> => {
      const migrated = { ...settings };

      if ('languageCommentSupport' in migrated) {
        const oldValue = migrated['languageCommentSupport'];
        if (
          typeof oldValue === 'object' &&
          oldValue !== null &&
          'enabled' in oldValue &&
          typeof oldValue.enabled === 'boolean'
        ) {
          migrated['languageCommentSupport'] = (
            oldValue as { enabled: boolean }
          ).enabled;
        }
      }

      return migrated;
    },
  },
  {
    version: 5,
    migrate: (settings: Record<string, unknown>) => {
      // v5: added saved searches with default presets
      // If savedSearches is not already present, add the default presets.
      // Existing users get the initial set of saved searches.
      // New installs will get them from DefaultSettings.
      if (!('savedSearches' in settings)) {
        return {
          ...settings,
          savedSearches: DEFAULT_SAVED_SEARCHES,
        };
      }
      return { ...settings };
    },
  },
  {
    version: 6,
    migrate: (settings: Record<string, unknown>) => {
      // v6: added trackStartedDate setting (opt-in, default false)
      // DefaultSettings supplies the value; this migration just stamps the
      // version so we can distinguish pre/post-STARTED settings files.
      if (!('trackStartedDate' in settings)) {
        return {
          ...settings,
          trackStartedDate: false,
        };
      }
      return { ...settings };
    },
  },
  {
    version: 7,
    migrate: (settings: Record<string, unknown>) => {
      // v7: added task-list grouping + sort-direction defaults (both preserve
      // current behaviour: no grouping, each method's natural direction).
      return {
        ...settings,
        taskListGroupBy: settings['taskListGroupBy'] ?? 'none',
        taskListSortDirection: settings['taskListSortDirection'] ?? 'natural',
        taskListGroupDirection: settings['taskListGroupDirection'] ?? 'natural',
      };
    },
  },
  {
    version: 8,
    migrate: (settings: Record<string, unknown>) => {
      // v8: the Task List now always remembers the user's last-chosen sort, so
      // the standalone "Default sort method" setting was removed. Seed the
      // remembered value from it once, then drop the old key.
      const migrated = { ...settings };
      if (
        migrated['taskListSortMethod'] === undefined &&
        isSortMethod(migrated['defaultSortMethod'])
      ) {
        migrated['taskListSortMethod'] = migrated['defaultSortMethod'];
      }
      delete migrated['defaultSortMethod'];
      return migrated;
    },
  },
  {
    version: 9,
    migrate: (settings: Record<string, unknown>) => {
      // v9: the built-in saved searches now reset grouping to 'none'. Fill it
      // in for existing installs without overriding a custom grouping.
      const builtInIds = new Set([
        'default-today',
        'default-overdue',
        'default-active',
      ]);
      const rawSearches = settings['savedSearches'];
      if (!Array.isArray(rawSearches)) {
        return { ...settings };
      }
      const savedSearches: unknown[] = rawSearches.map((search: unknown) => {
        if (search === null || typeof search !== 'object') {
          return search;
        }
        const entry = search as { id?: unknown; groupBy?: unknown };
        if (
          typeof entry.id === 'string' &&
          builtInIds.has(entry.id) &&
          entry.groupBy === undefined
        ) {
          return { ...(search as Record<string, unknown>), groupBy: 'none' };
        }
        return search;
      });
      return { ...settings, savedSearches };
    },
  },
];

export function migrateSettings(
  settings: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!settings) {
    return {};
  }

  const currentVersion = (settings['settingsVersion'] as number) ?? 0;

  let migratedSettings = { ...settings };

  for (const migration of MIGRATIONS) {
    if (currentVersion < migration.version) {
      migratedSettings = migration.migrate(migratedSettings);
      migratedSettings['settingsVersion'] = migration.version;
    }
  }

  return migratedSettings;
}

export function getLatestSettingsVersion(): number {
  return MIGRATIONS.length > 0
    ? Math.max(...MIGRATIONS.map((m) => m.version))
    : 0;
}
