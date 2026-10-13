# dsh-linux-desktop

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 桌面版的社区 Linux 移植。官方桌面安装包只支持 macOS 和 Windows，本仓库在上游源码（MIT 协议）基础上补齐了 **Linux x86_64** 的完整打包链路，可产出 **deb / rpm / pacman / AppImage** 四种安装包。

> English: A community Linux port of the DeepSeek Harness desktop app. The upstream desktop packaging only targets macOS and Windows; this repo adds a complete `linux-x64` packaging pipeline that produces **deb, rpm, pacman, and AppImage** artifacts, plus the fixes needed to make the packaged app actually run (WASM sharp backend, an ASAR `lstatSync` probe fix for the LibreOffice engine fallback, and a proper icon set with desktop-entry association). See [Build from source](#从源码构建) below. Not affiliated with DeepSeek; upstream is MIT licensed.

## 安装

在 [Releases](../../releases) 或本地构建产物中选择对应格式：

| 格式 | 适用发行版 | 安装命令 |
| --- | --- | --- |
| `.deb` | Debian / Ubuntu / Deepin 等 | `sudo apt install ./deepseek-harness-*-linux-amd64.deb` |
| `.rpm` | Fedora / RHEL / openSUSE 等 | `sudo dnf install ./deepseek-harness-*-linux-x86_64.rpm` |
| `.pacman` | Arch / Manjaro / CachyOS 等 | `sudo pacman -U deepseek-harness-*-linux-x64.pacman` |
| `.AppImage` | 通用，免安装 | `chmod +x deepseek-harness-*.AppImage && ./deepseek-harness-*.AppImage` |

安装后应用名为 **DeepSeek Harness**，桌面环境中可直接从启动器打开（含完整的多尺寸图标）。

## 从源码构建

环境要求：

- Linux x86_64,Node `^22.19 || >=24`,pnpm(corepack 自带）
- 打 `.rpm` 需要 `rpmbuild`。Arch 系发行版自带 `rpm-tools`;Debian 系为 `rpm` 包；没有 root 权限时可以解包发行版仓库的 `rpm`/`librpm*`/`debugedit` 等到用户目录，再通过 `PATH` / `LD_LIBRARY_PATH` / `RPM_CONFIGDIR` 指向它
- 打 `.pacman` 需要 `bsdtar`(Debian 系为 `libarchive-tools` 包，同样可以解包到用户目录）
- 打 `.deb` 需要系统的 `dpkg`；其余打包工具由 electron-builder 内置，无需系统安装
- 本机构网受限时，Electron 可用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`;Node/Python 运行时与 Python wheel 偶发拉取失败时，可按 `scripts/primary-runtime/lock.json` 的 sha256 预先下载到 `apps/desktop/.desktop-build/downloads/<sha256>` 复用

步骤：

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

产物在 `apps/desktop/.desktop-build/targets/linux-x64/artifacts/`，同目录的 `linux-unpacked/` 是可直接运行的免安装版。完整构建约 5~10 分钟，包含打包后的真实冒烟测试（启动 Host、加载前端、DOCX/XLSX/PPTX 转 PDF)。

## 相对上游的改动

全部改动集中在 `apps/desktop/`，与上游 master 保持线性 diff，便于 rebase:

1. **linux-x64 目标全链路**:`desktop-build-paths.mjs` / `package-target.ts` / `electron-builder-config.mjs` / `desktop-package-environment.mjs` 等注册 linux 目标、四种打包格式与本地专用（无签名、无自动更新）的发布策略。
2. **sharp 换 WASM 后端**(`prepare-dsh.ts` 的 `installSharpWasmBackend`)：原生 sharp 在 Electron on Linux 下解码即段错误，打包时从 registry 暂存 `@img/sharp-wasm32` 并移除原生二进制。
3. **ASAR 探针修复**(`prepare-dsh.ts` 的 `patchLibreOfficeAsarProbe`):Electron 的 asar 补丁使 `lstatSync(p, { throwIfNoEntry: false })` 对归档内缺失路径返回 `null` 而非 `undefined`，导致 `@deepseek-ai/libreoffice-kit` 把"Linux 原生引擎未安装"误判为"引擎包损坏"而无法回退 WASM 引擎。物化时把探针改写为 `Boolean(lstatSync(...))`。
4. **NODE_PATH 泄漏修复**(`smoke-prepared-runtime.ts`)：清掉 tsx 注入的 `NODE_PATH`，避免冒烟进程从构建仓库捞到原生模块（这个修复对 macOS/Windows 同样成立）。
5. **图标与桌面集成**:`resources/icons/` 提供 16~1024 多尺寸图标，`desktopName` + `syncDesktopName` 让运行中的窗口与 .desktop 条目正确关联，X11 下另设 `BrowserWindow` 的运行时 icon。
6. **客户端身份上报修复**:`x-client-platform` 请求头此前把 Linux 桌面端误报为 `desktop-mac`(Host 侧则退化为 `web`)；现在 `deepseek-account` 的头部映射、`deepseek-account-platform` 的 `desktopPlatform` 配置、基座 `cordis.patch.yml` 与桌面主进程均识别 `linux`，上报为 `desktop-linux`。
7. **构建版本号发现修复**(`desktop-build-version-discovery.ts`):`--build-version auto` 的本地序号扫描此前只认 mac/win 产物名（`.exe/.dmg/.zip`),Linux 产物（`.AppImage/.deb/.rpm/.pacman`）会被漏算而重发同一序号；同时 Linux 目标不再误查 macOS 更新桶。

## 已知限制

- 仅 `linux-x64`;ARM64 Linux 未做（上游引擎包和 Electron 目标都需额外适配）。
- Linux 构建为本地构建：不做代码签名，不含自动更新 feed。
- 仅测试于 glibc 发行版；musl(Alpine 等）未覆盖。

## 协议

与上游一致：[MIT](LICENSE)。上游项目版权归 DeepSeek AI 所有。
