# AUR packaging: deepseek-harness-desktop-bin

English | [中文](README.zh.md)

A PKGBUILD that repackages the `.pacman` artifact from this repo's Releases as a standard AUR `-bin` package.

## Local installation (without the AUR)

```sh
cd aur/deepseek-harness-desktop-bin
makepkg -si   # 自动从 GitHub Release 下载 .pacman 并打包安装
```

## Status of publishing to the AUR

A package named [`deepseek-harness-desktop-bin`](https://aur.archlinux.org/packages/deepseek-harness-desktop-bin) already exists on the AUR (maintainer czyt), but its source is an **unpatched** build from another fork (ZacharyZhang-NY/deepseek-harness) — that fork is `ahead: 0` relative to upstream, i.e. plain upstream sources packaged as-is, missing this repo's three runtime fixes (the asar probe rewrite, the sharp WASM backend, and the icon integration); document conversion and image processing are broken in it.

The AUR does not allow duplicate packages, so there are only two publication paths:

1. **Collaborate (recommended)**: register an AUR account and leave a comment on czyt's package page suggesting switching the source to this repo's Releases (or request co-maintainership).
2. **Take over**: if the maintainer does not update for a long time, file an orphan request in aur-requests and take over.

After registering an account and adding an SSH public key (`~/.ssh/id_rsa.pub`), push with:

```sh
git clone ssh://aur@aur.archlinux.org/deepseek-harness-desktop-bin.git
cp PKGBUILD .SRCINFO deepseek-harness-desktop-bin/
cd deepseek-harness-desktop-bin && git add . && git commit -m "Switch source to fixed Linux build" && git push
```

Note: pushing directly overwrites the other party's repository; only do this after becoming the maintainer or co-maintainer.
