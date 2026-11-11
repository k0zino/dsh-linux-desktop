#!/usr/bin/env node
/**
 * Publish the rolling APT repository hosted by GitHub Releases.
 *
 * GitHub Releases stores the repository as static assets under one fixed tag
 * (`apt` by default). Each run adds one release's `.deb` files, regenerates the
 * flat `Packages` index, and uploads the index last so clients never resolve a
 * package whose bytes are not public yet.
 *
 * Linux packaging revisions such as `linux.2` are not part of the `.deb`
 * control version, so two rebuilds of one upstream version compare equal to
 * APT. This publisher appends the release tag's revision as a Debian revision
 * (`0.2.1~rc.2` -> `0.2.1~rc.2-linux.2`) while replacing only the control
 * archive; the data archive bytes stay unchanged. The original release asset
 * is never modified.
 *
 * The script is Linux-only and expects `gh`, `dpkg-deb`, `ar`, `tar`,
 * `apt-ftparchive`, `curl`, and optionally `gpg` in PATH.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'

/** Default rolling release tag that hosts the APT repository. */
export const DEFAULT_APT_TAG = 'apt'

/** Name of the exported public key asset. */
export const KEYRING_ASSET = 'dsh-archive-keyring.gpg'

const RELEASE_TAG_PATTERN = /^v?(.+)-linux\.(\d+)$/
const APT_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const CONTROL_MEMBER_PATTERN = /^control\.tar(?:\.(?:xz|gz|zst))?$/
const APT_RELEASE_TITLE = 'APT repository (rolling)'
const APT_RELEASE_NOTES = [
  'Rolling APT repository for the DeepSeek Harness Linux x64 desktop build.',
  'Do not delete this release; the .deb and index assets under this tag are the',
  'download source configured on user machines.',
].join(' ')

/**
 * Extract the Linux packaging revision from a release tag.
 * @param tag - Release tag such as `v0.2.1-rc.2-linux.2`.
 * @returns The upstream-facing app version and the `linux.<n>` revision.
 */
export function parseReleaseTag(tag) {
  const match = RELEASE_TAG_PATTERN.exec(tag)
  if (match === null) {
    throw new Error(`release tag ${JSON.stringify(tag)} must end with -linux.<number>`)
  }
  return { appVersion: match[1], revision: `linux.${match[2]}` }
}

/**
 * Add a Debian revision to a package version. Re-running with the same
 * revision is idempotent; a different existing revision is rejected.
 * @param controlVersion - Version read from the `.deb` control file.
 * @param revision - Linux packaging revision such as `linux.2`.
 * @returns A Debian version that sorts above the original build.
 */
export function normalizeDebVersion(controlVersion, revision) {
  if (!/^[0-9][A-Za-z0-9.+~:-]*$/.test(controlVersion)) {
    throw new Error(`unsupported control version ${JSON.stringify(controlVersion)}`)
  }
  if (!/^linux\.[0-9]+$/.test(revision)) {
    throw new Error(`invalid Linux packaging revision ${JSON.stringify(revision)}`)
  }
  if (controlVersion.endsWith(`-${revision}`)) return controlVersion
  if (controlVersion.includes('-')) {
    throw new Error(`control version ${controlVersion} already carries a Debian revision`)
  }
  return `${controlVersion}-${revision}`
}

/**
 * Build a release-asset filename APT can use. GitHub renames release assets
 * that contain characters such as `~`, so the filename uses only safe
 * characters; the Debian version inside the control file keeps its original
 * spelling.
 * @param packageName - Control Package name.
 * @param version - Normalized Debian version.
 * @param architecture - Control Architecture.
 * @returns A safe `.deb` asset name.
 */
export function aptAssetName(packageName, version, architecture) {
  const safe = value => value.replace(/[^A-Za-z0-9._-]/g, '.')
  return `${safe(packageName)}_${safe(version)}_${safe(architecture)}.deb`
}

/**
 * Parse `Packages` stanzas. Blank lines separate stanzas; continuation lines
 * begin with whitespace and belong to the preceding field.
 * @param text - `Packages` file contents.
 * @returns Trimmed stanza strings in file order.
 */
export function parsePackages(text) {
  return text.split(/\n\s*\n/).map(stanza => stanza.trim()).filter(stanza => stanza !== '')
}

/**
 * Merge new stanzas into an existing index. A stanza with the same package,
 * version, and architecture is replaced only when its SHA256 is unchanged;
 * different bytes under the same version fail because APT cannot distinguish
 * them and users would silently miss the rebuild.
 * @param existing - Current `Packages` contents, or an empty string.
 * @param additions - New stanzas, separated by blank lines.
 * @returns The merged `Packages` contents.
 */
export function mergePackages(existing, additions) {
  const existingStanzas = parsePackages(existing)
  const additionStanzas = parsePackages(additions)
  const additionById = new Map(additionStanzas.map(stanza => [stanzaIdentity(stanza), stanza]))
  for (const stanza of existingStanzas) {
    const id = stanzaIdentity(stanza)
    const replacement = additionById.get(id)
    if (replacement === undefined) continue
    if (stanzaField(stanza, 'SHA256') !== stanzaField(replacement, 'SHA256')) {
      throw new Error(`package version ${stanzaField(stanza, 'Version')} already exists with different bytes; publish a new -linux.<n> revision`)
    }
  }
  const seen = new Set()
  const retained = existingStanzas.filter(stanza => {
    const id = stanzaIdentity(stanza)
    if (additionById.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
  const merged = [...retained, ...additionStanzas]
  return merged.map(stanza => stanza.trimEnd()).join('\n\n') + '\n\n'
}

/**
 * Resolve the repository slug from an argument, the Actions environment, or gh.
 * @param explicit - Value passed with `--repo`.
 * @returns `owner/name`.
 */
function resolveRepo(explicit) {
  const value = explicit?.trim() || process.env.GITHUB_REPOSITORY?.trim()
  if (value !== undefined && value !== '') {
    if (!REPO_PATTERN.test(value)) throw new Error(`invalid repository ${JSON.stringify(value)}; expected owner/name`)
    return value
  }
  if (!commandExists('gh')) throw new Error('gh is required to infer the GitHub repository; pass --repo owner/name')
  const result = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error('cannot infer the GitHub repository; pass --repo owner/name or set GITHUB_REPOSITORY')
  }
  const inferred = (result.stdout ?? '').trim()
  if (!REPO_PATTERN.test(inferred)) throw new Error(`gh returned an invalid repository ${JSON.stringify(inferred)}`)
  return inferred
}

/**
 * Run a command and return stdout. Stderr is included in failures.
 * @param command - Executable name.
 * @param args - Arguments.
 * @param options - `execFileSync` options; encoding defaults to utf8.
 * @returns Command stdout.
 */
function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })
  } catch (error) {
    const detail = error && typeof error === 'object' && 'stderr' in error
      ? String(error.stderr).trim().slice(-4000)
      : ''
    throw new Error(`${command} ${args.join(' ')} failed${detail === '' ? '' : `:\n${detail}`}`)
  }
}

/**
 * Run a command with inherited output and fail on a non-zero status.
 * @param command - Executable name.
 * @param args - Arguments.
 * @param options - `spawnSync` options.
 */
function runInteractive(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${String(result.status)}`)
}

/**
 * Whether an executable is available in PATH.
 * @param command - Executable name.
 * @returns True when `command -v` succeeds.
 */
function commandExists(command) {
  return spawnSync('sh', ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', command], { stdio: 'ignore' }).status === 0
}

/**
 * Throw unless every required executable is available.
 * @param commands - Executable names.
 */
function requireCommands(commands) {
  const missing = commands.filter(command => !commandExists(command))
  if (missing.length > 0) {
    throw new Error(`missing required commands: ${missing.join(', ')}${missing.includes('apt-ftparchive') ? ' (install apt-utils on Debian/Ubuntu)' : ''}`)
  }
}

/**
 * Read one control field from a `.deb`.
 * @param debPath - Package path.
 * @param field - Control field name.
 * @returns Field value without surrounding whitespace.
 */
function debField(debPath, field) {
  return run('dpkg-deb', ['-f', debPath, field]).trim()
}

/**
 * Hash the data archive while ignoring the control archive.
 * @param debPath - Package path.
 * @returns SHA256 of `dpkg-deb --fsys-tarfile` output.
 */
function dataArchiveHash(debPath) {
  const output = run('bash', ['-c', 'dpkg-deb --fsys-tarfile "$1" | sha256sum', 'bash', debPath])
  return output.trim().split(/\s+/)[0]
}

/**
 * Read a single control stanza field.
 * @param stanza - One `Packages` stanza.
 * @param field - Field name at column zero.
 * @returns Field value, or an empty string when absent.
 */
function stanzaField(stanza, field) {
  const match = new RegExp(`^${field}:\\s*(.*)$`, 'm').exec(stanza)
  return match?.[1]?.trim() ?? ''
}

/**
 * Identity APT uses to select one binary package version.
 * @param stanza - One `Packages` stanza.
 * @returns Package, version, and architecture joined by NUL.
 */
function stanzaIdentity(stanza) {
  const fields = ['Package', 'Version', 'Architecture'].map(field => stanzaField(stanza, field))
  if (fields.some(value => value === '')) throw new Error('Packages stanza lacks Package, Version, or Architecture')
  return fields.join('\0')
}

/**
 * Rebuild one `.deb` with a different control Version while preserving the
 * data archive bytes.
 * @param source - Original `.deb` path.
 * @param targetVersion - Debian version to write into control.
 * @param destination - Output `.deb` path.
 * @returns Package name, architecture, and normalized version.
 */
async function repackControlVersion(source, targetVersion, destination) {
  const work = await mkdtemp(join(tmpdir(), 'dsh-apt-control-'))
  try {
    const members = run('ar', ['t', source]).trim().split('\n').map(member => member.trim()).filter(Boolean)
    const controlMember = members.find(member => CONTROL_MEMBER_PATTERN.test(member))
    if (controlMember === undefined) throw new Error(`${source} has no control.tar member`)
    if (!members.includes('debian-binary') || !members.some(member => /^data\.tar(?:\.|$)/.test(member))) {
      throw new Error(`${source} is not a Debian package archive`)
    }

    const controlArchive = join(work, controlMember)
    await writeFile(controlArchive, execFileSync('ar', ['p', source, controlMember]))
    const controlDir = join(work, 'control')
    await mkdir(controlDir)
    if (controlMember.endsWith('.xz')) runInteractive('tar', ['-xJf', controlArchive, '-C', controlDir])
    else if (controlMember.endsWith('.gz')) runInteractive('tar', ['-xzf', controlArchive, '-C', controlDir])
    else if (controlMember.endsWith('.zst')) runInteractive('tar', ['--zstd', '-xf', controlArchive, '-C', controlDir])
    else runInteractive('tar', ['-xf', controlArchive, '-C', controlDir])

    const controlFile = join(controlDir, 'control')
    const control = await readFile(controlFile, 'utf8')
    if (!/^Version: .*$/m.test(control)) throw new Error(`${source} control file has no Version field`)
    const updated = control.replace(/^Version: .*$/m, `Version: ${targetVersion}`)
    await writeFile(controlFile, updated)

    // Recompressing must be deterministic: a rerun for the same release has to
    // produce the same bytes, or the index merge would reject its own output.
    const tarPath = join(work, 'control.tar')
    runInteractive('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-cf', tarPath, '-C', controlDir, '.'])
    if (controlMember.endsWith('.xz')) {
      if (!commandExists('xz')) throw new Error('xz is required to repack control.tar.xz')
      await writeFile(controlArchive, execFileSync('xz', ['-c', tarPath], { maxBuffer: 16 * 1024 * 1024 }))
    } else if (controlMember.endsWith('.gz')) {
      if (!commandExists('gzip')) throw new Error('gzip is required to repack control.tar.gz')
      await writeFile(controlArchive, execFileSync('gzip', ['-n', '-9', '-c', tarPath], { maxBuffer: 16 * 1024 * 1024 }))
    } else if (controlMember.endsWith('.zst')) {
      if (!commandExists('zstd')) throw new Error('zstd is required to repack control.tar.zst')
      await writeFile(controlArchive, execFileSync('zstd', ['-q', '-c', tarPath], { maxBuffer: 16 * 1024 * 1024 }))
    } else {
      await copyFile(tarPath, controlArchive)
    }

    await copyFile(source, destination)
    runInteractive('ar', ['rD', destination, controlMember], { cwd: work })

    const packageName = debField(source, 'Package')
    const architecture = debField(source, 'Architecture')
    if (debField(destination, 'Package') !== packageName) throw new Error(`${destination} changed its package name`)
    if (debField(destination, 'Architecture') !== architecture) throw new Error(`${destination} changed its architecture`)
    if (debField(destination, 'Version') !== targetVersion) throw new Error(`${destination} did not receive version ${targetVersion}`)
    if (dataArchiveHash(source) !== dataArchiveHash(destination)) throw new Error(`${destination} changed the data archive`)
    return { packageName, architecture }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/**
 * Generate one `Packages` stanza from a `.deb`.
 * @param debPath - Package path.
 * @param work - Temporary directory.
 * @returns A stanza with `Filename`, size, and hashes.
 */
async function generateStanza(debPath, work) {
  const directory = await mkdtemp(join(work, 'stanza-'))
  await copyFile(debPath, join(directory, basename(debPath)))
  return run('apt-ftparchive', ['packages', '.'], { cwd: directory }).trimEnd() + '\n'
}

/**
 * Generate the flat repository `Release` file.
 * @param indexDir - Directory containing Packages files.
 * @param architectures - Architectures present in the index.
 * @returns `Release` contents.
 */
function generateRelease(indexDir, architectures) {
  return run('apt-ftparchive', [
    '-o', 'APT::FTPArchive::Release::Origin=dsh-linux-desktop',
    '-o', 'APT::FTPArchive::Release::Label=dsh-linux-desktop',
    '-o', 'APT::FTPArchive::Release::Suite=stable',
    '-o', 'APT::FTPArchive::Release::Codename=stable',
    '-o', `APT::FTPArchive::Release::Architectures=${architectures}`,
    '-o', 'APT::FTPArchive::Release::Components=main',
    'release', '.',
  ], { cwd: indexDir })
}

/**
 * Run gpg with the passphrase on stdin, never in argv.
 * @param args - gpg arguments.
 * @param passphrase - Key passphrase; an empty string is valid for an unprotected key.
 * @param encoding - Output encoding.
 * @returns gpg stdout.
 */
function gpg(args, passphrase, encoding = 'utf8') {
  const result = spawnSync('gpg', args, {
    input: encoding === 'buffer' ? Buffer.from(`${passphrase}\n`) : `${passphrase}\n`,
    encoding,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const stderr = result.stderr ?? ''
    const detail = (encoding === 'utf8' ? String(stderr) : Buffer.from(stderr).toString('utf8')).trim()
    throw new Error(`gpg ${args.join(' ')} failed${detail === '' ? '' : `:\n${detail}`}`)
  }
  return result.stdout
}

/**
 * Sign Release and export the public key used for it.
 * @param indexDir - Directory containing Release.
 * @param keyId - Signing key fingerprint.
 * @param passphrase - Key passphrase.
 */
async function signRelease(indexDir, keyId, passphrase) {
  const release = join(indexDir, 'Release')
  gpg(['--batch', '--yes', '--pinentry-mode', 'loopback', '--passphrase-fd', '0', '--local-user', keyId, '--clearsign', '--output', join(indexDir, 'InRelease'), release], passphrase)
  gpg(['--batch', '--yes', '--pinentry-mode', 'loopback', '--passphrase-fd', '0', '--local-user', keyId, '--armor', '--detach-sign', '--output', join(indexDir, 'Release.gpg'), release], passphrase)
  gpg(['--batch', '--verify', join(indexDir, 'InRelease')], '')
  gpg(['--batch', '--verify', join(indexDir, 'Release.gpg'), release], '')
  const exported = gpg(['--batch', '--yes', '--export', keyId], '', 'buffer')
  await writeFile(join(indexDir, KEYRING_ASSET), exported)
  await chmod(join(indexDir, KEYRING_ASSET), 0o644)
}

/**
 * View one release, treating a missing release as null.
 * @param repo - Repository slug.
 * @param tag - Release tag.
 * @returns Release JSON or null.
 */
function releaseView(repo, tag) {
  const result = spawnSync('gh', ['release', 'view', tag, '--repo', repo, '--json', 'assets,isDraft,isPrerelease'], { encoding: 'utf8' })
  if (result.status !== 0) {
    if (/not found/i.test(result.stderr ?? '')) return null
    throw new Error(`gh release view ${tag} failed:\n${(result.stderr ?? '').trim()}`)
  }
  return JSON.parse(result.stdout ?? '')
}

/**
 * Create the rolling release when it does not exist.
 * @param repo - Repository slug.
 * @param tag - Rolling release tag.
 */
function ensureRollingRelease(repo, tag) {
  const existing = releaseView(repo, tag)
  if (existing === null) {
    runInteractive('gh', ['release', 'create', tag, '--repo', repo, '--prerelease', '--title', APT_RELEASE_TITLE, '--notes', APT_RELEASE_NOTES])
    return
  }
  if (existing.isDraft === true) throw new Error(`release ${tag} is a draft; publish it before adding APT assets`)
}

/**
 * Wait for the source release to carry a `.deb`, then download every one.
 * @param repo - Repository slug.
 * @param tag - Source release tag.
 * @param directory - Download directory.
 * @param waitSeconds - How long to wait for the release asset.
 * @returns Downloaded `.deb` paths.
 */
async function downloadReleaseDebs(repo, tag, directory, waitSeconds) {
  const attempts = Math.max(1, Math.ceil(waitSeconds / 3))
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const release = releaseView(repo, tag)
    if (release !== null && release.assets.some(asset => asset.name.endsWith('.deb'))) {
      const download = spawnSync('gh', ['release', 'download', tag, '--repo', repo, '--pattern', '*.deb', '--dir', directory, '--clobber'], { encoding: 'utf8' })
      if (download.status === 0) {
        const files = (await readdir(directory)).filter(name => name.endsWith('.deb')).map(name => join(directory, name))
        if (files.length > 0) return files
      }
    }
    await delay(3000)
  }
  throw new Error(`release ${tag} has no downloadable .deb asset after ${String(waitSeconds)} seconds`)
}

/**
 * Download the current `Packages` index from the rolling release.
 * @param repo - Repository slug.
 * @param tag - Rolling release tag.
 * @param directory - Download directory.
 * @returns Existing index text, or an empty string.
 */
async function downloadExistingPackages(repo, tag, directory) {
  const release = releaseView(repo, tag)
  if (release === null) return ''
  const hasPackages = release.assets.some(asset => asset.name === 'Packages' || asset.name === 'Packages.gz')
  if (!hasPackages) return ''
  const plainPath = join(directory, 'Packages')
  if (existsSync(plainPath)) await rm(plainPath, { force: true })
  const plain = spawnSync('gh', ['release', 'download', tag, '--repo', repo, '--pattern', 'Packages', '--dir', directory, '--clobber'], { stdio: 'ignore' })
  if (plain.status === 0) {
    const text = await readFile(plainPath, 'utf8')
    if (text.trim() === '') throw new Error(`release ${tag} has an empty Packages index`)
    return text
  }
  const compressedPath = join(directory, 'Packages.gz')
  if (existsSync(compressedPath)) await rm(compressedPath, { force: true })
  const compressed = spawnSync('gh', ['release', 'download', tag, '--repo', repo, '--pattern', 'Packages.gz', '--dir', directory, '--clobber'], { stdio: 'ignore' })
  if (compressed.status !== 0) throw new Error(`release ${tag} has a Packages index but it could not be downloaded`)
  const text = gunzipSync(await readFile(compressedPath)).toString('utf8')
  if (text.trim() === '') throw new Error(`release ${tag} has an empty Packages index`)
  return text
}

/**
 * Upload files to the rolling release.
 * @param repo - Repository slug.
 * @param tag - Rolling release tag.
 * @param files - Absolute file paths.
 */
function uploadFiles(repo, tag, files) {
  if (files.length === 0) return
  runInteractive('gh', ['release', 'upload', tag, '--repo', repo, '--clobber', ...files])
}

/**
 * Build the public URL for a release asset.
 * @param repo - Repository slug.
 * @param tag - Release tag.
 * @param name - Asset name.
 * @returns GitHub release asset URL.
 */
function assetUrl(repo, tag, name) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`
}

/**
 * Wait until a release asset answers a HEAD or one-byte range request. GitHub
 * can return 404 for a short period after an upload while the CDN catches up.
 * @param url - Asset URL.
 */
async function waitForAsset(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const head = spawnSync('curl', ['-fsSIL', '--max-time', '30', '-o', '/dev/null', '-w', '%{http_code}', url], { encoding: 'utf8' })
    if (head.status === 0 && head.stdout.trim() === '200') return
    const range = spawnSync('curl', ['-fsSL', '--max-time', '30', '--range', '0-0', '-o', '/dev/null', '-w', '%{http_code}', url], { encoding: 'utf8' })
    if (range.status === 0 && ['200', '206'].includes(range.stdout.trim())) return
    await delay(3000)
  }
  throw new Error(`asset did not become downloadable: ${url}`)
}

/**
 * Verify the published repository with apt itself. This catches signature,
 * redirect, index, and version mistakes that a local file tree cannot.
 * @param options - Published repository details.
 */
async function verifyPublished(options) {
  const { repo, tag, versions, signed, keyringPath } = options
  const directory = await mkdtemp(join(tmpdir(), 'dsh-apt-verify-'))
  const lists = join(directory, 'lists')
  const cache = join(directory, 'cache')
  const sources = join(directory, 'sources.list')
  const verifyKeyring = join(directory, KEYRING_ASSET)
  const sourceOption = signed ? `signed-by=${verifyKeyring}` : 'trusted=yes'
  const aptOptions = [
    '-o', `Dir::Etc::sourcelist=${sources}`,
    '-o', 'Dir::Etc::sourceparts=-',
    '-o', `Dir::State::lists=${lists}`,
    '-o', `Dir::Cache=${cache}`,
    '-o', 'Acquire::Retries=3',
    '-o', 'Acquire::http::Timeout=30',
  ]
  await chmod(directory, 0o755)
  await mkdir(lists, { recursive: true, mode: 0o755 })
  await mkdir(join(lists, 'partial'), { recursive: true, mode: 0o755 })
  await mkdir(join(cache, 'archives', 'partial'), { recursive: true, mode: 0o755 })
  await chmod(lists, 0o755)
  await chmod(join(lists, 'partial'), 0o755)
  await chmod(cache, 0o755)
  await chmod(join(cache, 'archives'), 0o755)
  await chmod(join(cache, 'archives', 'partial'), 0o755)
  if (signed) {
    await copyFile(keyringPath, verifyKeyring)
    await chmod(verifyKeyring, 0o644)
  }
  await writeFile(sources, `deb [arch=amd64 ${sourceOption}] https://github.com/${repo}/releases/download/${tag} ./\n`, { mode: 0o644 })
  await chmod(sources, 0o644)
  try {
    runInteractive('apt-get', ['update', ...aptOptions])
    for (const { packageName, version } of versions) {
      const policy = run('apt-cache', ['policy', packageName, ...aptOptions])
      if (!policy.includes(version)) {
        throw new Error(`apt-cache policy for ${packageName} does not contain ${version}`)
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/**
 * Verify the published repository, retrying while GitHub's release CDN
 * catches up with replaced index assets.
 * @param options - Published repository details.
 */
async function verifyPublishedWithRetry(options) {
  let lastError
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await verifyPublished(options)
      return
    } catch (error) {
      lastError = error
      if (attempt < 9) {
        process.stderr.write(`apt publish: verification attempt ${String(attempt + 1)} failed; retrying after 15 seconds\n`)
        await delay(15000)
      }
    }
  }
  throw lastError
}

/**
 * Copy dry-run files into one flat directory that can be served by any HTTP
 * server, matching the layout of the GitHub release.
 * @param indexDir - Generated index directory.
 * @param debs - Repacked package paths.
 * @param output - Destination directory.
 */
async function writeDryRunOutput(indexDir, debs, output) {
  if (existsSync(output) && (await readdir(output)).length > 0) {
    throw new Error(`dry-run output directory is not empty: ${output}`)
  }
  await mkdir(output, { recursive: true })
  for (const file of await readdir(indexDir)) {
    await copyFile(join(indexDir, file), join(output, file))
  }
  for (const deb of debs) {
    await copyFile(deb, join(output, basename(deb)))
  }
}

/**
 * Continue after a fixed delay.
 * @param milliseconds - Delay length.
 */
function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))
}

/**
 * Parse command-line options and validate their values.
 * @param argv - Arguments after the script name.
 * @returns Validated options.
 */
function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'release-tag': { type: 'string' },
      'apt-tag': { type: 'string', default: DEFAULT_APT_TAG },
      repo: { type: 'string' },
      deb: { type: 'string' },
      unsigned: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      output: { type: 'string' },
      'wait-seconds': { type: 'string', default: '900' },
      'keep-workdir': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  })
  if (values.help === true) return { help: true }
  const releaseTag = values['release-tag']?.trim()
  if (releaseTag === undefined || releaseTag === '') throw new Error('--release-tag is required')
  const aptTag = values['apt-tag']?.trim() ?? DEFAULT_APT_TAG
  if (!APT_TAG_PATTERN.test(aptTag)) throw new Error(`invalid --apt-tag ${JSON.stringify(aptTag)}`)
  if (releaseTag === aptTag) throw new Error('--release-tag and --apt-tag must differ')
  const deb = values.deb === undefined ? undefined : resolve(values.deb)
  if (deb !== undefined && !statSync(deb, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`local package does not exist or is not a file: ${deb}`)
  }
  if (values.output !== undefined && values['dry-run'] !== true) throw new Error('--output requires --dry-run')
  if (values.output !== undefined && resolve(values.output) === resolve(sep)) {
    throw new Error('refusing to use the filesystem root as --output')
  }
  const waitSeconds = Number(values['wait-seconds'] ?? '900')
  if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 3600) {
    throw new Error('--wait-seconds must be an integer between 0 and 3600')
  }
  return {
    help: false,
    releaseTag,
    aptTag,
    repo: values.repo,
    deb,
    unsigned: values.unsigned === true,
    dryRun: values['dry-run'] === true,
    output: values.output === undefined ? undefined : resolve(values.output),
    waitSeconds,
    keepWorkdir: values['keep-workdir'] === true,
  }
}

/** Print command usage. */
function printUsage() {
  process.stdout.write(`Usage: node apt/publish.mjs --release-tag <tag> [options]

Options:
  --release-tag <tag>  Release containing the .deb (required; must end with -linux.<n>)
  --apt-tag <tag>      Rolling release tag (default: ${DEFAULT_APT_TAG})
  --repo <owner/name>  GitHub repository (default: GITHUB_REPOSITORY or gh repo view)
  --deb <path>         Use a local .deb instead of downloading the release asset
  --unsigned           Build an unsigned repository (testing only)
  --dry-run            Build the repository locally without uploading
  --output <dir>       Empty output directory for --dry-run
  --wait-seconds <n>   How long to wait for the release .deb asset (default: 900)
  --keep-workdir       Keep the temporary work directory
  -h, --help           Show this help
`)
}

/**
 * Run the publisher.
 * @param options - Parsed options.
 */
async function publish(options) {
  const { appVersion, revision } = parseReleaseTag(options.releaseTag)
  process.stdout.write(`apt publish: ${options.releaseTag} (${appVersion}, revision ${revision})\n`)
  const needsRepository = options.dryRun !== true || options.deb === undefined
  const repo = needsRepository ? resolveRepo(options.repo) : undefined
  const commands = ['dpkg-deb', 'ar', 'tar', 'bash', 'sha256sum', 'apt-ftparchive']
  if (needsRepository) commands.push('gh', 'curl')
  if (options.dryRun !== true) commands.push('apt-get', 'apt-cache')
  if (options.unsigned !== true) commands.push('gpg')
  requireCommands(commands)
  if (needsRepository) {
    const auth = spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' })
    if (auth.status !== 0) throw new Error('gh is not authenticated; set GH_TOKEN or run gh auth login')
  }

  const work = await mkdtemp(join(tmpdir(), 'dsh-apt-publish-'))
  let succeeded = false
  try {
    const indexDir = join(work, 'index')
    const debsDir = join(work, 'debs')
    await mkdir(indexDir)
    await mkdir(debsDir)

    let sourceDebs
    if (options.deb !== undefined) {
      sourceDebs = [options.deb]
    } else {
      const sourceDir = join(work, 'source')
      await mkdir(sourceDir)
      sourceDebs = await downloadReleaseDebs(repo, options.releaseTag, sourceDir, options.waitSeconds)
    }

    let existing = ''
    if (options.dryRun !== true) {
      ensureRollingRelease(repo, options.aptTag)
      existing = await downloadExistingPackages(repo, options.aptTag, work)
    }

    const additions = []
    const packages = []
    for (const source of sourceDebs) {
      const controlVersion = debField(source, 'Version')
      const releaseVersion = controlVersion.endsWith(`-${revision}`)
        ? controlVersion.slice(0, -(revision.length + 1))
        : controlVersion
      if (releaseVersion.replaceAll('~', '-') !== appVersion) {
        throw new Error(`package version ${controlVersion} does not match release tag version ${appVersion}`)
      }
      const targetVersion = normalizeDebVersion(controlVersion, revision)
      const packageName = debField(source, 'Package')
      const architecture = debField(source, 'Architecture')
      const target = join(debsDir, aptAssetName(packageName, targetVersion, architecture))
      if (existsSync(target)) throw new Error(`duplicate package in one release: ${targetVersion} ${architecture}`)
      const repacked = await repackControlVersion(source, targetVersion, target)
      additions.push(await generateStanza(target, work))
      packages.push({ packageName: repacked.packageName, version: targetVersion, architecture: repacked.architecture, path: target })
    }

    const merged = mergePackages(existing, additions.join('\n'))
    const packagesPath = join(indexDir, 'Packages')
    await writeFile(packagesPath, merged)
    await writeFile(join(indexDir, 'Packages.gz'), gzipSync(Buffer.from(merged), { level: 9 }))
    const architectures = [...new Set(parsePackages(merged).map(stanza => stanzaField(stanza, 'Architecture')))].sort().join(' ')
    const release = generateRelease(indexDir, architectures)
    await writeFile(join(indexDir, 'Release'), release)

    if (options.unsigned !== true) {
      const keyId = process.env.APT_GPG_KEY_ID?.trim().replace(/\s+/g, '')
      if (keyId === undefined || keyId === '') throw new Error('APT_GPG_KEY_ID is required unless --unsigned is set')
      await signRelease(indexDir, keyId, process.env.APT_GPG_PASSPHRASE ?? '')
    }

    if (options.dryRun === true) {
      const output = options.output ?? await mkdtemp(join(tmpdir(), 'dsh-apt-dry-run-'))
      await writeDryRunOutput(indexDir, packages.map(pkg => pkg.path), output)
      process.stdout.write('apt publish: dry run complete\n')
      for (const pkg of packages) process.stdout.write(`  ${pkg.packageName} ${pkg.version} ${pkg.architecture}\n`)
      process.stdout.write(`apt publish: index written to ${output}\n`)
      if (options.unsigned === true) {
        process.stdout.write(`apt publish: test with  deb [trusted=yes] file:${output} ./\n`)
      } else {
        process.stdout.write(`apt publish: test with  deb [signed-by=${join(output, KEYRING_ASSET)}] file:${output} ./\n`)
      }
      succeeded = true
      return
    }

    uploadFiles(repo, options.aptTag, packages.map(pkg => pkg.path))
    for (const pkg of packages) await waitForAsset(assetUrl(repo, options.aptTag, basename(pkg.path)))
    if (options.unsigned !== true) {
      uploadFiles(repo, options.aptTag, [join(indexDir, KEYRING_ASSET)])
      await waitForAsset(assetUrl(repo, options.aptTag, KEYRING_ASSET))
    }
    uploadFiles(repo, options.aptTag, [packagesPath, join(indexDir, 'Packages.gz')])
    await waitForAsset(assetUrl(repo, options.aptTag, 'Packages'))
    await waitForAsset(assetUrl(repo, options.aptTag, 'Packages.gz'))
    const releaseAssets = [join(indexDir, 'Release')]
    if (options.unsigned !== true) releaseAssets.push(join(indexDir, 'InRelease'), join(indexDir, 'Release.gpg'))
    uploadFiles(repo, options.aptTag, releaseAssets)
    await waitForAsset(assetUrl(repo, options.aptTag, options.unsigned === true ? 'Release' : 'InRelease'))
    await verifyPublishedWithRetry({
      repo,
      tag: options.aptTag,
      versions: packages.map(pkg => ({ packageName: pkg.packageName, version: pkg.version })),
      signed: options.unsigned !== true,
      keyringPath: join(indexDir, KEYRING_ASSET),
    })
    process.stdout.write(`apt publish: published ${packages.length} package(s) to ${options.aptTag}\n`)
    for (const pkg of packages) process.stdout.write(`  ${pkg.packageName} ${pkg.version} ${pkg.architecture}\n`)
    succeeded = true
  } finally {
    if (options.keepWorkdir === true || !succeeded) {
      process.stderr.write(`apt publish: work directory retained at ${work}\n`)
    } else {
      await rm(work, { recursive: true, force: true })
    }
  }
}

/**
 * Report failures without a stack trace; temporary directories are retained
 * for diagnosis unless the run succeeded.
 */
async function main() {
  let options
  try {
    options = parseCli(process.argv.slice(2))
    if (options.help === true) {
      printUsage()
      return
    }
    await publish(options)
  } catch (error) {
    process.stderr.write(`apt publish: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main()
}
