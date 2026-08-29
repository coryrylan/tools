/** @type {import('knip').KnipConfig} */
export default {
  ignoreDependencies: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/github',
    'conventional-changelog-conventionalcommits',
    '@nvidia-elements/code',
    '@nvidia-elements/core',
    '@nvidia-elements/styles',
    '@nvidia-elements/themes'
  ],
  ignoreBinaries: ['vale', 'osascript', 'afplay', 'pmset', 'say'],
  workspaces: {
    'projects/docs': {
      eleventy: false,
      entry: ['eleventy.config.js', 'src/_layouts/index.11ty.js', 'src/_layouts/index.ts'],
      project: ['**/*.{js,ts}'],
      ignoreDependencies: ['@nvidia-elements/styles']
    },
    'projects/tools': {
      entry: ['release.config.js'],
      ignoreDependencies: ['stylelint-config-standard']
    }
  }
};
