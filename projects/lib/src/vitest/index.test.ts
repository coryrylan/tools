import { describe, expect, it } from 'vitest';
import { nodeTestConfig } from './index.js';

describe('nodeTestConfig', () => {
  it('runs unit tests under the node environment', () => {
    expect(nodeTestConfig.test?.environment).toBe('node');
  });

  it('enables globals so specs can call describe/it/expect without importing them', () => {
    expect(nodeTestConfig.test?.globals).toBe(true);
  });

  it('collects only *.test.ts files under src', () => {
    expect(nodeTestConfig.test?.include).toEqual(['src/**/*.test.ts']);
  });

  it('exposes no browser-mode config, keeping it independent of the playwright-backed preset', () => {
    expect(nodeTestConfig.test?.browser).toBeUndefined();
    expect(Object.keys(nodeTestConfig)).toEqual(['test']);
  });
});
