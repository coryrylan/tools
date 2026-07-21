import { describe, expect, it } from 'vitest';
import { browserTestConfig } from './browser.js';

describe('browserTestConfig', () => {
  it('enables browser mode with a single chromium instance', () => {
    expect(browserTestConfig.test?.browser?.enabled).toBe(true);
    expect(browserTestConfig.test?.browser?.instances).toEqual([{ browser: 'chromium' }]);
  });

  it('runs headless, since tests here never run under --watch', () => {
    expect(browserTestConfig.test?.browser?.headless).toBe(true);
  });

  it('configures a playwright browser provider', () => {
    const provider = browserTestConfig.test?.browser?.provider;
    expect(provider).toBeDefined();
    expect(provider).toMatchObject({ name: 'playwright' });
    expect(typeof provider?.providerFactory).toBe('function');
  });

  it('retries a failing test twice before marking it failed', () => {
    expect(browserTestConfig.test?.retry).toBe(2);
  });

  it('gates coverage on istanbul with a 90% floor on every metric', () => {
    const coverage = browserTestConfig.test?.coverage;
    expect(coverage?.provider).toBe('istanbul');
    expect(coverage?.thresholds).toEqual({
      lines: 90,
      branches: 90,
      functions: 90,
      statements: 90
    });
  });

  it('reports coverage as html and json-summary, alongside lcov', () => {
    const reporters = browserTestConfig.test?.coverage?.reporter;
    expect(reporters).toContainEqual('html');
    expect(reporters).toContainEqual('json-summary');
  });
});
