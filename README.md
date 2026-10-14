# dsh-linux-desktop

English | [中文](README.zh.md)

A community Linux port of the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) desktop app. The upstream desktop packaging only targets macOS and Windows; this repo builds on the upstream sources (MIT license) and adds a complete **Linux x86_64** packaging pipeline that produces **deb / rpm / pacman / AppImage** artifacts.

## Installation

Pick a format from the [Releases](https://github.com/k0zino/dsh-linux-desktop/releases) page or a local build:

| Format | Distributions | Install command |
| --- | --- | --- |
| `.deb` | Debian / Ubuntu / Deepin etc. | `sudo apt install ./deepseek-harness-*-linux-amd64.deb` |
| `.rpm` | Fedora / RHEL / openSUSE etc. | `sudo dnf install ./deepseek-harness-*-linux-x86_64.rpm` |
| `.pacman` | Arch / Manjaro / CachyOS etc. | `sudo pacman -U deepseek-harness-*-linux-x64.pacman` |
| `.AppImage` | Universal, no install | `chmod +x deepseek-harness-*.AppImage && ./deepseek-harness-*.AppImage` |

Once installed the app is named **DeepSeek Harness** and can be launched from the desktop environment's launcher (with a full multi-size icon set).

## Build from source

Requirements:

- Linux x86_64, Node `^22.19 || >=24`, pnpm (bundled with corepack)
- Building `.rpm` requires `rpmbuild`. Arch distributions ship `rpm-tools`; on Debian-based systems the package is `rpm`. Without root access you can unpack the distribution's `rpm`/`librpm*`/`debugedit` packages into a user directory and point `PATH` / `LD_LIBRARY_PATH` / `RPM_CONFIGDIR` at it
- Building `.pacman` requires `bsdtar` (the `libarchive-tools` package on Debian-based systems, likewise unpackable into a user directory)
- Building `.deb` requires the system `dpkg`; every other packaging tool is bundled with electron-builder and needs no system install
- On a restricted network, Electron can use `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`; when the Node/Python runtime or Python wheel downloads fail intermittently, pre-download them by their sha256 from `scripts/primary-runtime/lock.json` into `apps/desktop/.desktop-build/downloads/<sha256>` for reuse

Steps:

```bash
git clone https://github.com/k0zino/dsh-linux-desktop.git
cd dsh-linux-desktop
pnpm install

# 打包配置：创建 apps/desktop/.env.linux，内容如下
#   DSH_DESKTOP_APP_ID=com.deepseek.harness
#   # 可选：npm 镜像，加速内嵌运行时安装
#   # DSH_DESKTOP_NPM_REGISTRY=https://registry.npmmirror.com

pnpm --dir apps/desktop run package:linux:x64
```

Artifacts land in `apps/desktop/.desktop-build/targets/linux-x64/artifacts/`; the sibling `linux-unpacked/` is a directly runnable no-install build. A full build takes about 5~10 minutes and includes real smoke tests against the packaged tree (starting the Host, loading the frontend, converting DOCX/XLSX/PPTX to PDF).

## Changes relative to upstream

All changes live under `apps/desktop/` and stay a linear diff against upstream master, so rebasing is easy:

1. **The full linux-x64 target pipeline**: `desktop-build-paths.mjs` / `package-target.ts` / `electron-builder-config.mjs` / `desktop-package-environment.mjs` and friends register the linux target, the four packaging formats, and a local-only release policy (no signing, no auto-update).
2. **sharp swapped for the WASM backend** (`installSharpWasmBackend` in `prepare-dsh.ts`): native sharp deterministically segfaults on decode under Electron on Linux, so packaging stages `@img/sharp-wasm32` from the registry and removes the native binaries.
3. **ASAR probe fix** (`patchLibreOfficeAsarProbe` in `prepare-dsh.ts`): Electron's asar patch makes `lstatSync(p, { throwIfNoEntry: false })` return `null` instead of `undefined` for paths missing from the archive, so `@deepseek-ai/libreoffice-kit` misread "no native engine installed on Linux" as "corrupt engine package" and could not fall back to the WASM engine. Materialization rewrites the probe to `Boolean(lstatSync(...))`.
4. **NODE_PATH leak fix** (`smoke-prepared-runtime.ts`): clears the `NODE_PATH` tsx injects, so the smoke process cannot pick up native modules from the build repository (this fix applies to macOS/Windows too).
5. **Icons and desktop integration**: `resources/icons/` provides 16~1024 multi-size icons, and `desktopName` + `syncDesktopName` associate running windows with the .desktop entry; X11 additionally sets the runtime `BrowserWindow` icon.
6. **Client identity reporting fix**: the `x-client-platform` request header previously misreported the Linux desktop client as `desktop-mac` (and the Host side degraded to `web`); now the header mapping in `deepseek-account`, the `desktopPlatform` config of `deepseek-account-platform`, the base `cordis.patch.yml`, and the desktop main process all recognize `linux` and report `desktop-linux`.
7. **Build version discovery fix** (`desktop-build-version-discovery.ts`): the local index scan for `--build-version auto` previously only recognized mac/win artifact names (`.exe/.dmg/.zip`), so Linux artifacts (`.AppImage/.deb/.rpm/.pacman`) were miscounted and a taken index could be reissued; the Linux target also no longer queries the macOS update bucket by mistake.

## Known limitations

- `linux-x64` only; ARM64 Linux is not done (both the upstream engine packages and the Electron targets need extra adaptation).
- Linux builds are local: no code signing and no auto-update feed.
- Tested only on glibc distributions; musl (Alpine etc.) is not covered.

## License

Same as upstream: [MIT](LICENSE). The upstream project is copyrighted by DeepSeek AI.
