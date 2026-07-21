import { describe, expect, it } from 'vitest';
import { clipToSentence, findLastSentenceEnd, spellAcronyms, stripMarkdown } from './speech-text.js';

describe('stripMarkdown', () => {
  it.each<[string, string, string]>([
    ['fenced code blocks', 'Before ```const a = 1;``` After', 'Before After'],
    ['tilde-fenced code blocks', 'Before ~~~const a = 1;~~~ After', 'Before After'],
    ['inline code spans', 'Run `npm test` now.', 'Run npm test now.'],
    ['markdown links', '[Docs](https://example.com) here', 'Docs here'],
    ['markdown images', '![Alt text](img.png) shown', 'Alt text shown'],
    ['ATX headers', '# Heading\nBody text', 'Heading Body text'],
    ['blockquotes', '> Quoted line\nNormal line', 'Quoted line Normal line'],
    ['dash bullets', '- item one\n- item two', 'item one item two'],
    ['numbered bullets', '1. first\n2. second', 'first second'],
    ['bold emphasis with asterisks', '**bold** text', 'bold text'],
    ['bold emphasis with underscores', '__bold__ text', 'bold text'],
    ['italic emphasis with asterisks', '*italic* text', 'italic text'],
    ['italic emphasis with underscores', '_italic_ text', 'italic text'],
    ['collapses repeated whitespace and trims', '   Multiple   spaces   ', 'Multiple spaces']
  ])('should strip %s', (_description, input, expected) => {
    expect(stripMarkdown(input)).toBe(expected);
  });

  it('should not treat a mid-word hyphen as a bullet', () => {
    expect(stripMarkdown('This well-known fact remains.')).toBe('This well-known fact remains.');
  });

  it('should not strip an unmatched asterisk with no closing pair', () => {
    expect(stripMarkdown('Use * as a wildcard.')).toBe('Use * as a wildcard.');
  });

  it('should leave plain prose without markdown syntax unchanged', () => {
    expect(stripMarkdown('Plain sentence with no markdown at all.')).toBe('Plain sentence with no markdown at all.');
  });
});

describe('spellAcronyms', () => {
  it.each<[string, string, string]>([
    ['a single configured acronym', 'Use the CLI to build.', 'Use the c.l.i. to build.'],
    ['a plural configured acronym', 'Run CLIs in parallel.', 'Run c.l.i.s in parallel.'],
    ['multiple acronyms in one string', 'Check the API and the UI now.', 'Check the a.p.i. and the u.i. now.'],
    ['lowercase input case-insensitively', 'lowercase cli also spells out.', 'lowercase c.l.i. also spells out.']
  ])('should spell out %s', (_description, input, expected) => {
    expect(spellAcronyms(input)).toBe(expected);
  });

  it('should pass an already-dotted acronym through unchanged', () => {
    expect(spellAcronyms('Already dotted C.L.I. stays.')).toBe('Already dotted C.L.I. stays.');
  });

  it('should not spell out an acronym embedded inside a longer untouched word', () => {
    expect(spellAcronyms('CLIENT code stays untouched.')).toBe('CLIENT code stays untouched.');
  });

  it('should lowercase every spelled letter regardless of input case', () => {
    expect(spellAcronyms('NPM installs packages.')).toBe('n.p.m. installs packages.');
  });

  it('should leave text with no configured acronyms unchanged', () => {
    expect(spellAcronyms('Nothing to spell here.')).toBe('Nothing to spell here.');
  });
});

describe('findLastSentenceEnd', () => {
  it('should return the index just past the final terminator when the text ends on one', () => {
    expect(findLastSentenceEnd('First. Second.')).toBe('First. Second.'.length);
  });

  it('should not treat the dots inside a dotted acronym as a sentence end', () => {
    expect(findLastSentenceEnd('The build uses C.L.I. tools primarily')).toBeUndefined();
  });

  it('should not treat an e.g.-style abbreviation as a sentence end', () => {
    expect(findLastSentenceEnd('Use tools, e.g. curl and jq')).toBeUndefined();
  });

  it('should return undefined for text with no sentence-ending punctuation', () => {
    expect(findLastSentenceEnd('No terminal punctuation here')).toBeUndefined();
  });
});

describe('clipToSentence', () => {
  it('should return text unchanged when it is within budget and ends on sentence punctuation', () => {
    expect(clipToSentence('Hello world.', 100)).toBe('Hello world.');
  });

  it('should clip a within-budget mid-sentence stop back to the last full sentence', () => {
    const midSentenceStop = 'Done building the CLI. Also partial next se';
    expect(clipToSentence(midSentenceStop, 100)).toBe('Done building the CLI.');
  });

  it('should cut an over-budget reply at the last sentence boundary within budget', () => {
    expect(clipToSentence('Short one. Overflow text keeps going and going.', 12)).toBe('Short one.');
  });

  it('should drop the trailing partial word when an over-budget reply has no sentence boundary', () => {
    expect(clipToSentence('Alphabet soup without any punctuation whatsoever', 10)).toBe('Alphabet');
  });

  it('should return the full clipped candidate when it is over budget with no boundary and no space', () => {
    expect(clipToSentence('Supercalifragilisticexpialidociousaaaaaaaaaa', 10)).toBe('Supercalif');
  });

  it('should return a within-budget reply unchanged when it has no sentence boundary at all', () => {
    expect(clipToSentence('No punctuation here', 50)).toBe('No punctuation here');
  });

  it('should not treat a dotted acronym as a sentence boundary when clipping', () => {
    const withDottedAcronym = 'Ship the C.L.I. now.';
    expect(clipToSentence(withDottedAcronym, 100)).toBe(withDottedAcronym);
  });

  it('should not clip on an e.g.-style abbreviation even when over budget', () => {
    const overBudget = 'Use tools such as curl, e.g. for scripting automation tasks.';
    expect(clipToSentence(overBudget, 25)).not.toMatch(/e\.$/);
  });
});
