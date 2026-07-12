import { describe, expect, it } from 'vitest';
import { format } from 'prettier';
import config from './index.js';

describe('@coryrylan/tools/prettier', () => {
  it('should lock every preference to its confirmed value', () => {
    expect(config.trailingComma).toBe('none');
    expect(config.tabWidth).toBe(2);
    expect(config.printWidth).toBe(120);
    expect(config.semi).toBe(true);
    expect(config.singleQuote).toBe(true);
    expect(config.arrowParens).toBe('avoid');
    expect(config.bracketSameLine).toBe(true);
    expect(config.embeddedLanguageFormatting).toBe('off');
    expect(config.singleAttributePerLine).toBe(false);
  });

  it('should format double-quoted strings, multiline objects, and single-param arrows per the confirmed preferences', async () => {
    const source = [
      'const settings = {',
      '  name: "test",',
      '  value: 1',
      '};',
      '',
      'const double = (x) => { return x * 2 };',
      ''
    ].join('\n');

    const formatted = await format(source, { ...config, parser: 'typescript' });

    // singleQuote rewrites "test" -> 'test'; trailingComma "none" leaves the
    // last multiline object property bare; arrowParens "avoid" drops the
    // parens around the single `x` parameter.
    expect(formatted).toBe(
      [
        'const settings = {',
        "  name: 'test',",
        '  value: 1',
        '};',
        '',
        'const double = x => {',
        '  return x * 2;',
        '};',
        ''
      ].join('\n')
    );
  });
});
