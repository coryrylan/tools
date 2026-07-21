import { cpSync, mkdirSync } from 'node:fs';
import { defineConfig, mergeConfig } from 'vite';
import { createNodeLibraryBuildConfig } from './src/vite/index.ts';

export default defineConfig(
  mergeConfig(
    createNodeLibraryBuildConfig({
      entry: {
        'eslint/index': 'src/eslint/index.ts',
        'prettier/index': 'src/prettier/index.ts',
        'stylelint/index': 'src/stylelint/index.ts',
        'vite/index': 'src/vite/index.ts',
        'vite/plugins/write-if-changed': 'src/vite/plugins/write-if-changed.ts',
        'vite/plugins/dts': 'src/vite/plugins/dts.ts',
        'vitest/index': 'src/vitest/index.ts',
        'vitest/browser': 'src/vitest/browser.ts',
        'pi/greeting/index': 'src/pi/greeting/index.ts',
        'pi/audio-summary/index': 'src/pi/audio-summary/index.ts',
        'pi/hooks/index': 'src/pi/hooks/index.ts'
      }
    }),
    {
      plugins: [
        {
          // Vale's ini template and vocabulary are plain assets, not a JS
          // entry - copied into dist so the published tarball (dist-only
          // allowlist) can ship them. Tests, docs, and `vale sync`-downloaded
          // style packages stay out of the copy.
          name: 'copy-vale-assets',
          closeBundle: () => {
            mkdirSync('dist/vale', { recursive: true });
            cpSync('src/vale/vale.ini', 'dist/vale/vale.ini');
            cpSync('src/vale/styles/config', 'dist/vale/styles/config', { recursive: true });
          }
        }
      ]
    }
  )
);
