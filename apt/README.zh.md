# APT 仓库

[English](README.md) | 中文

滚动 `apt` GitHub Release 托管一个带签名的扁平 APT 仓库。用户安装命令放在根 README；本文说明发布、签名和恢复流程。

## 目录结构

`apt` release 包含一个扁平仓库以及它发布过的所有 `.deb`：

```text
apt (GitHub Release, prerelease)
├── Packages
├── Packages.gz
├── Release
├── InRelease
├── Release.gpg
├── dsh-archive-keyring.gpg
└── deepseek-harness_<version>_amd64.deb
```

用户源地址固定：

```text
https://github.com/k0zino/dsh-linux-desktop/releases/download/apt
```

GitHub 会重写 release 资产名里的部分字符，因此 `.deb` 文件名用 `.` 代替 Debian 版本里的 `~`。APT 从 control 文件读取包版本，不从文件名读取。

release 保持在同一个 tag，并标记为预发布，避免成为仓库的 latest release。不要删除它；用户机器会一直使用这个地址。

## 发布

GitHub Release 发布后，`Publish APT repository` 工作流会自动运行。配置好 `APT_GPG_KEY_ID` 后自动运行才会开始；第一次补发和重试使用手动触发。配置好签名密钥后，先用当前 release 手动触发一次工作流，创建 `apt` release。

工作流会：

1. 最多等待 15 分钟，直到选定的 release 出现 `.deb`。
2. 把 release tag 的 `-linux.<n>` 修订号追加到 Debian 包版本。
3. 只替换 `.deb` 的 control 归档，data 归档字节保持不变。
4. 把新包合并进已有的 `Packages` 索引，并保留所有历史版本。
5. 签名 `Release`，把安装包和索引上传到 `apt` release。
6. 对公网地址运行 `apt-get update`，确认新版本出现在仓库索引中。

必须带打包修订号，因为 `linux.1`、`linux.2` 以及后续重建版的上游版本相同；不追加修订号时，它们的 `.deb` 内部 `Version` 相同，APT 无法区分。普通 Release 的原始安装包不会被修改。

手动触发的输入：

- `release_tag`：包含 `.deb` 的 release，例如 `v0.2.2-rc.1-linux.1`。
- `apt_tag`：滚动 release tag，默认 `apt`。

```bash
gh workflow run apt-repo.yml --repo k0zino/dsh-linux-desktop --ref master \
  -f release_tag=v0.2.2-rc.1-linux.1 -f apt_tag=apt
```

工作流会跳过不含 `-linux.` 的 release，也会跳过 `apt` release 自己。发布器检出默认分支，而不是 release tag，避免旧 release 运行旧版本脚本。如果另一个工作流使用默认 `GITHUB_TOKEN` 创建 release，GitHub 会抑制由此产生的 `release` 事件；这种情况请手动触发本工作流。先把 release 建成 draft，上传资产后再发布，可以避免等待资产。

## 签名密钥

创建一把专用签名密钥，不要使用个人主 GPG 密钥。

```bash
gpg --full-generate-key
# Choose RSA 4096, sign-only usage, and an expiry of five years or less.
gpg --list-secret-keys --keyid-format=long
```

把私钥直接写进 GitHub Secret，不落地明文文件：

```bash
gpg --armor --export-secret-keys <fingerprint> | gh secret set APT_GPG_PRIVATE_KEY --repo k0zino/dsh-linux-desktop
```

如果需要离线备份，请导出到密码管理器条目或加密卷。不要把明文私钥留在仓库或 `/tmp`。

配置其余值：

```bash
gh secret set APT_GPG_PASSPHRASE --repo k0zino/dsh-linux-desktop
gh variable set APT_GPG_KEY_ID --repo k0zino/dsh-linux-desktop --body <fingerprint>
gh variable set APT_REPO_SIGNING --repo k0zino/dsh-linux-desktop --body true
```

当本地克隆同时存在 `upstream` remote 时，请显式传 `--repo k0zino/dsh-linux-desktop`；否则 `gh` 会解析到上游仓库。如果密钥没有口令，可以不设置 `APT_GPG_PASSPHRASE`。

工作流导入私钥，签名 `InRelease` 和 `Release.gpg`，并把公钥上传为 `dsh-archive-keyring.gpg`。私钥不会进入仓库或工作流产物。

`APT_REPO_SIGNING=false` 会构建未签名仓库，仅用于测试。不要用它发布面向用户的版本；根 README 的命令安装并信任签名公钥。

轮换密钥时，在过渡期发布包含新旧两把公钥的 keyring。工作流只导出当前签名密钥；在切换签名密钥前，手动把已上传的 keyring 替换为包含新旧公钥的 keyring。用户必须先替换本机 keyring，再移除旧公钥。

## 本地试运行

生成仓库但不上传：

```bash
node apt/publish.mjs \
  --release-tag v0.2.2-rc.1-linux.1 \
  --deb apps/desktop/.desktop-build/targets/linux-x64/artifacts/deepseek-harness-0.2.2-rc.1-linux-amd64.deb \
  --dry-run --output /tmp/dsh-apt-dry-run --unsigned
```

签名版试运行需要先导入密钥并设置 `APT_GPG_KEY_ID`：

```bash
APT_GPG_KEY_ID=<fingerprint> node apt/publish.mjs \
  --release-tag v0.2.2-rc.1-linux.1 \
  --deb <path-to-deb> \
  --dry-run --output /tmp/dsh-apt-dry-run
```

Debian/Ubuntu 的 `apt-ftparchive` 来自 `apt-utils`。试运行会打印一条指向输出目录的 `deb` 源，供本地 `apt-get update` 使用。

## 验证

工作流会用 `apt-get update` 和 `apt-cache policy` 验证公网仓库。手动检查时使用一次性机器或容器：

```bash
sudo apt update
apt-cache policy deepseek-harness
sudo apt install deepseek-harness
```

健康的签名仓库不会出现 `NO_PUBKEY`、`BADSIG` 或 `EXPKEYSIG` 错误。包版本会带 Linux 修订号，例如 `0.2.2~rc.1-linux.1`。

## 恢复

- 对同一个 release 重跑工作流；安装包和索引合并是幂等的。
- 如果某个版本已经以错误字节发布，发布新的 `-linux.<n>`，不要原地替换资产。
- 如果 `Packages` 资产丢失，按顺序重新发布各版本，或者删除并重建 `apt` release 后重新发布所有保留版本。tag 必须保持不变。
- 当前索引仍引用某个旧 `.deb` 时，不要删除它。仓库会有意保留所有版本。

## 安全

用户安装公钥后，签名密钥保护更新通道。第一次下载公钥仍然要信任这个 GitHub 仓库，因此请在 release notes 或 README 中公布指纹，并审查密钥变更。

自动签名意味着任何能在这个仓库发布 release 的人都能往通道里加包。如果 release 权限将来共享，请增加受保护的 GitHub Environment，或者改回手动触发。

Linux 桌面构建本身没有代码签名。仓库签名保护 APT 索引和包哈希，不改变应用二进制的代码签名状态。
