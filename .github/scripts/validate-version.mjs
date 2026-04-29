import { readFileSync } from 'node:fs'

const REQUIRED_KEYS = [
  'core_version',
  'apphub_version',
  'deployment_version',
  'git_version',
  'proxy_version',
  'media_version',
  'library_version',
]

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function fail(message) {
  console.error(`version-check: ${message}`)
  process.exit(1)
}

let versionManifest

try {
  versionManifest = JSON.parse(readFileSync(new URL('../../version.json', import.meta.url), 'utf8'))
} catch (error) {
  fail(`unable to read version.json: ${error instanceof Error ? error.message : String(error)}`)
}

for (const key of REQUIRED_KEYS) {
  if (!(key in versionManifest)) {
    fail(`missing required key \"${key}\"`)
  }

  if (typeof versionManifest[key] !== 'string' || !semverPattern.test(versionManifest[key])) {
    fail(`key \"${key}\" must be a valid SemVer string`) 
  }
}

const inputTag = process.argv[2] || process.env.APPOS_RELEASE_TAG || ''
if (inputTag) {
  const normalizedTag = inputTag.startsWith('refs/tags/') ? inputTag.slice('refs/tags/'.length) : inputTag
  const expectedTag = `v${versionManifest.core_version}`
  if (normalizedTag !== expectedTag) {
    fail(`tag \"${normalizedTag}\" must match core_version as \"${expectedTag}\"`)
  }
}

console.log(`version-check: ok (${versionManifest.core_version})`)