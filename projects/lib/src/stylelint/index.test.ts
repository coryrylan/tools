import { describe, expect, it } from 'vitest';
import stylelint from 'stylelint';
import config from './index.js';

describe('@coryrylan/tools/stylelint', () => {
  it('should flag a physical margin property via property-disallowed-list', async () => {
    const result = await stylelint.lint({
      code: 'a { margin-left: var(--space-md); }',
      config,
      codeFilename: 'test.css'
    });

    const [warning] = result.results[0]?.warnings ?? [];
    expect(warning?.rule).toBe('property-disallowed-list');
  });

  it('should pass a logical-property equivalent with zero violations', async () => {
    const result = await stylelint.lint({
      code: 'a { margin-inline-start: var(--space-md); }',
      config,
      codeFilename: 'test.css'
    });

    expect(result.results[0]?.warnings).toEqual([]);
  });

  it('should flag a hardcoded pixel value via declaration-property-value-disallowed-list', async () => {
    const result = await stylelint.lint({
      code: 'a { padding: 12px; }',
      config,
      codeFilename: 'test.css'
    });

    const [warning] = result.results[0]?.warnings ?? [];
    expect(warning?.rule).toBe('declaration-property-value-disallowed-list');
  });

  it('should pass a token-based gap value with zero violations', async () => {
    const result = await stylelint.lint({
      code: 'a { gap: var(--space-sm); }',
      config,
      codeFilename: 'test.css'
    });

    expect(result.results[0]?.warnings).toEqual([]);
  });
});
