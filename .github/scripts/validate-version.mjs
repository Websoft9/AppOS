import { execSync } from 'node:child_process'

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function fail(message) {
  console.error(`version-check: ${message}`)
  process.exit(1)
}

function normalizeRef(value) {
  return value.startsWith('refs/tags/') ? value.slice('refs/tags/'.length) : value
}

function deriveGitRef() {
  try {
    return execSync('git describe --tags --always --dirty', {
      cwd: new URL('../..', import.meta.url),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    fail(`unable to derive git version: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const inputRef = process.argv[2] || process.env.APPOS_RELEASE_TAG || deriveGitRef()
const normalizedRef = normalizeRef(inputRef)

if (normalizedRef.startsWith('v')) {
  const version = normalizedRef.slice(1)
  if (!semverPattern.test(version)) {
    fail(`tag \"${normalizedRef}\" must be a valid SemVer tag like v1.2.3 or v1.2.3-rc.1`)
  }
  console.log(`version-check: ok (${normalizedRef})`)
  process.exit(0)
}

console.log(`version-check: ok (non-release build ${normalizedRef})`)