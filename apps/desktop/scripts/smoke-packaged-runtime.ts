/** Validate the assembled application, including native Office conversion outside ASAR. */
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { verifyWindowsCode } from './windows-runtime-signature.mjs'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'
import { resolveDesktopPackageTarget } from './package-target.ts'

const paths = resolveDesktopTargetBuildPaths()
const { values } = parseArgs({ options: { unsigned: { type: 'boolean', default: false } }, allowPositionals: false })
const target = resolveDesktopBuildTarget()
const windows = target === 'win-x64'
const linux = target === 'linux-x64'
const artifacts = values.unsigned ? paths.unsignedArtifacts : paths.artifacts
let application = windows ? join(artifacts, 'win-unpacked')
  : linux ? join(artifacts, 'linux-unpacked')
    : join(artifacts, target === 'mac-arm64' ? 'mac-arm64' : 'mac', 'DeepSeek Harness.app', 'Contents')
let alias: string | undefined
// Electron 44.7 fails ASAR reads through non-ASCII absolute paths (ENOTDIR), and module resolution
// realpaths symlinks back to such paths; smoke an identical copy at an ASCII path instead.
if (linux && /[^\x00-\x7F]/u.test(application)) {
  alias = mkdtempSync(join(tmpdir(), 'dsh-smoke-copy-'))
  const copied = join(alias, 'linux-unpacked')
  cpSync(application, copied, { recursive: true })
  application = copied
}
const resources = join(application, windows || linux ? 'resources' : 'Resources')
const executable = windows ? join(application, 'DeepSeek Harness.exe')
  : linux ? join(application, 'deepseek-harness')
    : join(application, 'MacOS', 'DeepSeek Harness')
try {
  const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version,
    resolveDesktopPackageTarget(target))
  if (windows && !values.unsigned) await verifyWindowsCode(application)
  await smokePreparedRuntime(join(resources, 'app.asar', 'dsh'), executable, join(resources, 'runtime'), descriptor)
} finally {
  if (alias !== undefined) rmSync(alias, { recursive: true, force: true })
}
