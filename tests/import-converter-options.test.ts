import { buildConverterOptions } from '../src/services/import/import-converter-options';
import { createTestKeywordManager } from './helpers/test-helper';

describe('buildConverterOptions', () => {
  test('derives states and keywords from the keyword manager', () => {
    const keywordManager = createTestKeywordManager();
    const options = buildConverterOptions(keywordManager);

    expect(options.defaultState).toBe('TODO');
    expect(options.inProgressState).toBe('DOING');
    expect(options.completedState).toBe('DONE');
    expect(options.cancelledState).toBe('CANCELED');
    expect(options.knownKeywords).toEqual(
      expect.arrayContaining(['TODO', 'DOING', 'DONE']),
    );
  });

  test('uses custom completed keywords for the cancelled state', () => {
    const keywordManager = createTestKeywordManager({
      additionalCompletedKeywords: ['ABANDONED'],
    });
    const options = buildConverterOptions(keywordManager);
    expect(options.cancelledState).toBe('CANCELED');
    expect(options.knownKeywords).toEqual(
      expect.arrayContaining(['ABANDONED']),
    );
  });

  test('passes through the priority mapping', () => {
    const keywordManager = createTestKeywordManager();
    const mapping = {
      highest: 'A' as const,
      high: 'A' as const,
      medium: null,
      low: null,
      lowest: null,
    };
    const options = buildConverterOptions(keywordManager, mapping);
    expect(options.priorityMapping).toBe(mapping);
  });
});
