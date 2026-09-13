import type { App, TFile } from 'obsidian';
import {
  DEFAULT_CONVERTER_OPTIONS,
  convertObsidianTasksContent,
} from './obsidian-tasks-converter';
import type { ObsidianTasksConverterOptions } from './obsidian-tasks-converter';

/** A markdown file that contains Obsidian Tasks lines TODOseq can adopt. */
export interface ImportCandidate {
  path: string;
  file: TFile;
  originalContent: string;
  convertedContent: string;
  changedLineCount: number;
  warnings: string[];
}

export interface ImportScanResult {
  candidates: ImportCandidate[];
  scannedFiles: number;
}

export interface ImportApplyError {
  path: string;
  message: string;
}

export interface ImportApplyResult {
  filesWritten: number;
  errors: ImportApplyError[];
}

export interface ImportScanOptions {
  onProgress?: (processed: number, total: number) => void;
  /**
   * Top-level folder paths to include. An empty string (`''`) means files at
   * the vault root. Omit to scan every markdown file.
   */
  folderPrefixes?: string[];
}

const YIELD_EVERY_FILES = 50;

function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && window.requestAnimationFrame) {
      window.requestAnimationFrame(() => resolve());
    } else {
      window.setTimeout(resolve, 0);
    }
  });
}

/** True when `path` lives directly in the vault root or under `prefix`. */
function isInFolder(path: string, prefix: string): boolean {
  if (prefix === '') return !path.includes('/');
  return path.startsWith(`${prefix}/`);
}

/**
 * Scans markdown files, converts Obsidian Tasks syntax in memory, and writes
 * the converted files back.
 *
 * The conversion itself lives in `obsidian-tasks-converter.ts`; this service is
 * the I/O shell so the transform stays unit-testable in isolation.
 */
export class ObsidianTasksImporter {
  constructor(
    private readonly app: App,
    private readonly options: ObsidianTasksConverterOptions = DEFAULT_CONVERTER_OPTIONS,
  ) {}

  /** Read the in-scope markdown files and keep only those with convertible lines. */
  async scan(scanOptions: ImportScanOptions = {}): Promise<ImportScanResult> {
    const { onProgress, folderPrefixes } = scanOptions;
    const allFiles = this.app.vault.getMarkdownFiles();
    const files =
      folderPrefixes === undefined
        ? allFiles
        : allFiles.filter((file) =>
            folderPrefixes.some((prefix) => isInFolder(file.path, prefix)),
          );
    const candidates: ImportCandidate[] = [];

    for (let i = 0; i < files.length; i += YIELD_EVERY_FILES) {
      const batch = files.slice(i, i + YIELD_EVERY_FILES);
      const results = await Promise.all(
        batch.map((file) => this.scanFile(file)),
      );
      for (const candidate of results) {
        if (candidate) candidates.push(candidate);
      }
      onProgress?.(Math.min(i + YIELD_EVERY_FILES, files.length), files.length);
      await yieldToEventLoop();
    }

    return { candidates, scannedFiles: files.length };
  }

  private async scanFile(file: TFile): Promise<ImportCandidate | null> {
    const originalContent = await this.app.vault.cachedRead(file);
    const result = convertObsidianTasksContent(originalContent, this.options);
    if (!result.changed) return null;
    return {
      path: file.path,
      file,
      originalContent,
      convertedContent: result.content,
      changedLineCount: result.changedLineCount,
      warnings: result.warnings,
    };
  }

  /**
   * Write the selected candidates back to disk. The conversion is re-run
   * against the freshest file content inside `vault.process`, so concurrent
   * edits are not clobbered and the write is atomic.
   */
  async apply(candidates: ImportCandidate[]): Promise<ImportApplyResult> {
    const errors: ImportApplyError[] = [];
    let filesWritten = 0;

    for (const candidate of candidates) {
      try {
        await this.app.vault.process(
          candidate.file,
          (data) => convertObsidianTasksContent(data, this.options).content,
        );
        filesWritten++;
      } catch (error) {
        errors.push({
          path: candidate.path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { filesWritten, errors };
  }
}
