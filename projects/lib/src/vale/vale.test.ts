import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const valeDirectory = import.meta.dirname;
const valeIniPath = join(valeDirectory, 'vale.ini');
const vocabularyDirectory = join(valeDirectory, 'styles', 'config', 'vocabularies', 'Tools');
const acceptPath = join(vocabularyDirectory, 'accept.txt');
const rejectPath = join(vocabularyDirectory, 'reject.txt');

/** Newline-split, non-empty lines - a trailing EOF newline never yields a phantom empty entry. */
function readNonEmptyLines(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(line => line.length > 0);
}

describe('vale.ini', () => {
  const contents = readFileSync(valeIniPath, 'utf8');

  it('should exist and be non-empty', () => {
    expect(contents.length).toBeGreaterThan(0);
  });

  it('should declare a StylesPath', () => {
    expect(contents).toMatch(/^StylesPath\s*=/m);
  });

  it('should pin Vocab to Tools', () => {
    expect(contents).toMatch(/^Vocab\s*=\s*Tools\s*$/m);
  });

  it('should enable the Google and write-good packages', () => {
    expect(contents).toMatch(/^Packages\s*=\s*Google,\s*write-good\s*$/m);
  });

  it('should configure a [*.md] section', () => {
    expect(contents).toMatch(/^\[\*\.md\]$/m);
  });

  it('should configure a [*.ts] section', () => {
    expect(contents).toMatch(/^\[\*\.ts\]$/m);
  });
});

describe('vocabulary/Tools/accept.txt', () => {
  const lines = readNonEmptyLines(acceptPath);

  it('should be non-empty', () => {
    expect(lines.length).toBeGreaterThan(0);
  });

  it('should contain no duplicate lines', () => {
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('should have no leading or trailing whitespace on any line', () => {
    expect(lines.every(line => line === line.trim())).toBe(true);
  });

  it('should be sorted alphabetically, case-insensitively', () => {
    const sorted = [...lines].sort((first, second) => first.toLowerCase().localeCompare(second.toLowerCase()));

    expect(lines).toEqual(sorted);
  });
});

describe('vocabulary/Tools/reject.txt', () => {
  const lines = readNonEmptyLines(rejectPath);

  it('should be non-empty', () => {
    expect(lines.length).toBeGreaterThan(0);
  });

  it('should contain no duplicate lines', () => {
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('should have no leading or trailing whitespace on any line', () => {
    expect(lines.every(line => line === line.trim())).toBe(true);
  });
});
