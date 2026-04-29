import { readFileSync, writeFileSync } from 'node:fs'

function fail(message) {
  console.error(`release-notes: ${message}`)
  process.exit(1)
}

const releaseTag = process.argv[2]
if (!releaseTag) {
  fail('missing release tag argument')
}

const normalizedTag = releaseTag.startsWith('refs/tags/')
  ? releaseTag.slice('refs/tags/'.length)
  : releaseTag
const normalizedVersion = normalizedTag.startsWith('v') ? normalizedTag.slice(1) : normalizedTag

const versionManifest = JSON.parse(readFileSync(new URL('../../version.json', import.meta.url), 'utf8'))
if (versionManifest.core_version !== normalizedVersion) {
  fail(`core_version ${versionManifest.core_version} does not match release ${normalizedVersion}`)
}

const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8')
const knownIssues = readFileSync(new URL('../../docs/release-known-issues.md', import.meta.url), 'utf8').trim()

const versionHeader = `## [${normalizedVersion}]`
const sectionStart = changelog.indexOf(versionHeader)
if (sectionStart === -1) {
  fail(`unable to locate changelog section for ${normalizedVersion}`)
}

const nextSection = changelog.indexOf('\n## [', sectionStart + versionHeader.length)
const changelogSection = changelog.slice(sectionStart, nextSection === -1 ? undefined : nextSection).trim()

const installCommand = [
  'mkdir -p appos-release && cd appos-release',
  `curl -fsSLO https://raw.githubusercontent.com/Websoft9/appos/${normalizedTag}/build/docker-compose.yml`,
  `APPOS_SECRET_KEY=<change-me> IMAGE_TAG=${normalizedVersion} docker compose -f docker-compose.yml up -d`,
].join('\n')

const notes = `# AppOS ${normalizedVersion}

## Docker Tag
- \`websoft9/appos:${normalizedVersion}\`
- \`websoft9/appos:${normalizedTag}\`

## Install Command
\`\`\`bash
${installCommand}
\`\`\`

## Known Issues
${knownIssues}

## Compatibility Matrix
See \`docs/version-compatibility-matrix.md\` for the current release compatibility policy.

## Changelog
${changelogSection}
`

writeFileSync(new URL('../../release-notes.md', import.meta.url), notes)
console.log(`release-notes: generated for ${normalizedTag}`)
