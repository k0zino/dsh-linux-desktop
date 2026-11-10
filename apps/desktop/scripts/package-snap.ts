/** Build the Snap Store package from the packaged Linux x64 application tree. */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'

const APP_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SNAP_NAME = 'deepseek-harness-linux-community'
const TARGET = 'linux-x64' as const

const paths = desktopTargetBuildPaths(TARGET)
const source = join(paths.artifacts, 'linux-unpacked')
if (!existsSync(source)) {
  throw new Error(`snap: ${source} is missing; run "pnpm --dir apps/desktop run package:linux:x64" first`)
}

const product = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string }
const buildRoot = join(paths.root, 'snap')
const appRoot = join(buildRoot, 'app')
const snapRoot = join(buildRoot, 'snap')
const guiRoot = join(snapRoot, 'gui')

rmSync(buildRoot, { recursive: true, force: true })
mkdirSync(guiRoot, { recursive: true })
cpSync(source, appRoot, { recursive: true, dereference: true })
// Snap strict confinement supplies the sandbox; the setuid helper is neither usable nor needed.
rmSync(join(appRoot, 'chrome-sandbox'), { force: true })

cpSync(join(APP_ROOT, 'snap', 'command.sh'), join(buildRoot, 'command.sh'))
chmodSync(join(buildRoot, 'command.sh'), 0o755)
cpSync(join(APP_ROOT, 'snap', 'gui', 'deepseek-harness-linux-community.desktop'), join(guiRoot, 'deepseek-harness-linux-community.desktop'))
cpSync(join(APP_ROOT, 'resources', 'icons', '256x256.png'), join(guiRoot, 'deepseek-harness-linux-community.png'))

const manifest = readFileSync(join(APP_ROOT, 'snap', 'snapcraft.yaml.template'), 'utf8')
  .replaceAll('__VERSION__', product.version)
writeFileSync(join(snapRoot, 'snapcraft.yaml'), manifest)

const output = join(buildRoot, 'dist')
mkdirSync(output, { recursive: true })
for (const name of readdirSync(output)) {
  if (name.startsWith(`${SNAP_NAME}_`) && name.endsWith('.snap')) rmSync(join(output, name), { force: true })
}
const result = spawnSync('snapcraft', ['pack', '--destructive-mode', '--output', output], {
  cwd: buildRoot,
  env: { ...process.env, SNAPCRAFT_BUILD_ENVIRONMENT: 'host' },
  stdio: 'inherit',
})
if (result.error !== undefined) {
  throw new Error(`snap: cannot run snapcraft: ${result.error.message}`)
}
if (result.status !== 0) throw new Error(`snap: snapcraft exited with ${String(result.status ?? result.signal)}`)

for (const directory of ['parts', 'stage', 'prime']) {
  rmSync(join(buildRoot, directory), { recursive: true, force: true })
}

const artifact = readdirSync(output)
  .filter(name => name.startsWith(`${SNAP_NAME}_`) && name.endsWith('_amd64.snap'))
  .sort()
  .at(-1)
if (artifact === undefined) throw new Error(`snap: no ${SNAP_NAME} artifact was produced`)
cpSync(join(output, artifact), join(paths.artifacts, artifact))
console.log(`snap: built ${join(paths.artifacts, artifact)}`)
