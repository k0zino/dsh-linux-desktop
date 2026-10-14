# AUR 打包：deepseek-harness-desktop-bin

[English](README.md) | 中文

将本仓库 Release 中的 `.pacman` 产物重打包为标准 AUR `-bin` 包的 PKGBUILD。

## 本地安装（不经过 AUR）

```sh
cd aur/deepseek-harness-desktop-bin
makepkg -si   # 自动从 GitHub Release 下载 .pacman 并打包安装
```

## 发布到 AUR 的现状

AUR 上已存在同名包 [`deepseek-harness-desktop-bin`](https://aur.archlinux.org/packages/deepseek-harness-desktop-bin)（维护者 czyt），但其源是另一个 fork（ZacharyZhang-NY/deepseek-harness）的**未打补丁**构建——该 fork 相对上游 `ahead: 0`，即纯上游源码直接打包，缺少本仓库的三个运行时修复（asar 探针改写、sharp WASM 后端、图标集成），文档转换与图像处理功能在其中是坏的。

AUR 不允许重复上架同软件包，发布路径只有两条：

1. **协作（推荐）**：注册 AUR 账号后在 czyt 的包页面留言，建议将 source 切换到本仓库 Release（或申请成为共同维护者）。
2. **接管**：若对方长期不更新，可在 aur-requests 发起 orphan 请求后接管。

注册账号并添加 SSH 公钥（`~/.ssh/id_rsa.pub`）后，推送命令：

```sh
git clone ssh://aur@aur.archlinux.org/deepseek-harness-desktop-bin.git
cp PKGBUILD .SRCINFO deepseek-harness-desktop-bin/
cd deepseek-harness-desktop-bin && git add . && git commit -m "Switch source to fixed Linux build" && git push
```

注意：直接推送会覆盖对方仓库，仅在自己成为维护者/共同维护者后操作。
