import fs from 'node:fs';
import process from 'node:process';

const DRY_RUN = false;
// semantic-release runs from the package directory (see the root `release`
// script); cosmiconfig finds this root config by searching upward from cwd.
const packageFile = JSON.parse(fs.readFileSync(`${process.cwd()}/package.json`, 'utf8'));
const scope = packageFile.name.split('/').pop();

export default {
  dryRun: DRY_RUN,
  tagFormat: `${scope}-v\${version}`,
  branches: ['main'],
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        // The default angular preset cannot parse the `feat(scope)!:` breaking
        // marker — only the conventionalcommits parser turns `!` into a major.
        preset: 'conventionalcommits',
        releaseRules: [
          // Unscoped and foreign-scoped commits release nothing; the explicit
          // `false` rules also stop commit-analyzer's default-rule fallback
          // (which would otherwise patch-release on any perf or revert commit).
          { breaking: true, release: false },
          { revert: true, release: false },
          { type: 'feat', release: false },
          { type: 'fix', release: false },
          { type: 'perf', release: false },
          { type: 'chore', release: false },
          { breaking: true, scope, release: 'major' },
          { revert: true, scope, release: 'patch' },
          { type: 'feat', scope, release: 'minor' },
          { type: 'fix', scope, release: 'patch' },
          { type: 'perf', scope, release: 'patch' }
        ]
      }
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',
        presetConfig: {
          // Drop commits that mention neither `(scope)` nor `[scope]` from the
          // notes. The tail must be `[^]*$`, not `.*$` — `.` cannot cross
          // newlines, so `.*$` never matches a commit with a body.
          ignoreCommits: `^(?![^]*\\(${scope}\\))(?![^]*\\[${scope}\\])[^]*$`
        }
      }
    ],
    [
      '@semantic-release/changelog',
      {
        changelogFile: 'CHANGELOG.md'
      }
    ],
    [
      '@semantic-release/exec',
      {
        prepareCmd: 'npm pkg set version=${nextRelease.version} && pnpm pack',
        publishCmd: `npm publish ./*.tgz --provenance --registry=https://registry.npmjs.org ${DRY_RUN ? '--dry-run' : ''} --access=public`
      }
    ],
    [
      '@semantic-release/git',
      {
        assets: ['package.json', 'CHANGELOG.md'],
        message: `chore(release): ${scope}` + '-v${nextRelease.version} [skip ci]\n\n${nextRelease.notes}'
      }
    ],
    [
      '@semantic-release/github',
      {
        successComment: '🎉 This issue has been resolved in version ${nextRelease.version} 🎉'
      }
    ]
  ]
};
