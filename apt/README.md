# APT repository

English | [中文](README.zh.md)

The rolling `apt` GitHub Release hosts a signed flat APT repository. User installation commands live in the root README; this page covers publishing, signing, and recovery.

## Layout

The `apt` release contains one flat repository and every `.deb` it has ever served:

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

The source URL is fixed:

```text
https://github.com/k0zino/dsh-linux-desktop/releases/download/apt
```

GitHub rewrites some characters in release asset names, so the `.deb` filename uses `.` where the Debian version uses `~`. APT reads the package version from the control file, not from the filename.

The release stays at the same tag and is marked prerelease so it does not become the repository's latest release. Do not delete it; user machines keep this URL.

## Publishing

The workflow runs automatically when a GitHub Release is published. Automatic runs start after `APT_GPG_KEY_ID` is configured; use manual dispatch for the first backfill and for retries. After configuring the signing key, dispatch the workflow once for the current release to create the `apt` release.

The workflow:

1. Waits up to 15 minutes for the selected release to contain a `.deb`.
2. Adds the release tag's `-linux.<n>` revision to the Debian package version.
3. Replaces only the `.deb` control archive so the data archive bytes stay identical.
4. Merges the new package into the existing `Packages` index and keeps every earlier version.
5. Signs `Release` and uploads the package and index to the `apt` release.
6. Runs `apt-get update` against the published URL and checks the new version appears in the repository.

Packaging revisions are required because `linux.1`, `linux.2`, and later rebuilds of one upstream version otherwise share the same `.deb` `Version` and APT cannot distinguish them. The original release asset is never modified.

Manual dispatch inputs:

- `release_tag`: the release containing the `.deb`, for example `v0.2.2-rc.1-linux.1`.
- `apt_tag`: the rolling release tag, default `apt`.

```bash
gh workflow run apt-repo.yml --repo k0zino/dsh-linux-desktop --ref master \
  -f release_tag=v0.2.2-rc.1-linux.1 -f apt_tag=apt
```

The workflow skips releases that do not contain `-linux.` and skips the `apt` release itself. The publisher checks out the default branch, not the release tag, so an old release cannot run an old copy of the script. If another workflow creates the release with the default `GITHUB_TOKEN`, GitHub suppresses the resulting `release` event; dispatch this workflow manually in that case. Creating the release as a draft, uploading its assets, and then publishing it avoids the asset wait.

## Signing key

Create one dedicated signing key. Do not use a personal primary GPG key.

```bash
gpg --full-generate-key
# Choose RSA 4096, sign-only usage, and an expiry of five years or less.
gpg --list-secret-keys --keyid-format=long
```

Export the secret key directly into the GitHub secret without writing a plaintext file:

```bash
gpg --armor --export-secret-keys <fingerprint> | gh secret set APT_GPG_PRIVATE_KEY --repo k0zino/dsh-linux-desktop
```

If you need an offline backup, export it into an encrypted password-manager entry or an encrypted volume. Do not leave a plaintext private key in the repository or `/tmp`.

Configure the remaining values:

```bash
gh secret set APT_GPG_PASSPHRASE --repo k0zino/dsh-linux-desktop
gh variable set APT_GPG_KEY_ID --repo k0zino/dsh-linux-desktop --body <fingerprint>
gh variable set APT_REPO_SIGNING --repo k0zino/dsh-linux-desktop --body true
```

Pass `--repo k0zino/dsh-linux-desktop` explicitly when the clone also has an `upstream` remote; `gh` otherwise resolves the upstream repository. If the key has no passphrase, leave `APT_GPG_PASSPHRASE` unset.

The workflow imports the private key, signs `InRelease` and `Release.gpg`, and uploads the public keyring as `dsh-archive-keyring.gpg`. The private key never enters the repository or the workflow artifacts.

`APT_REPO_SIGNING=false` builds an unsigned repository for testing. Do not use that mode for user-facing releases; the root README commands install and trust the signed keyring.

For rotation, publish a keyring containing both old and new public keys for a transition period. The workflow exports the active signing key, so replace the uploaded keyring with the combined keyring manually before switching the signing secret. Users must replace their installed keyring before the old key is removed.

## Local dry run

Generate the repository without uploading it:

```bash
node apt/publish.mjs \
  --release-tag v0.2.2-rc.1-linux.1 \
  --deb apps/desktop/.desktop-build/targets/linux-x64/artifacts/deepseek-harness-0.2.2-rc.1-linux-amd64.deb \
  --dry-run --output /tmp/dsh-apt-dry-run --unsigned
```

For a signed dry run, import the key and set `APT_GPG_KEY_ID`:

```bash
APT_GPG_KEY_ID=<fingerprint> node apt/publish.mjs \
  --release-tag v0.2.2-rc.1-linux.1 \
  --deb <path-to-deb> \
  --dry-run --output /tmp/dsh-apt-dry-run
```

`apt-ftparchive` comes from `apt-utils` on Debian and Ubuntu. The dry run prints a `deb` line that points at the output directory for a local `apt-get update`.

## Verification

The workflow verifies the published repository with `apt-get update` and `apt-cache policy`. For a manual check, use a disposable machine or container:

```bash
sudo apt update
apt-cache policy deepseek-harness
sudo apt install deepseek-harness
```

A healthy signed repository prints no `NO_PUBKEY`, `BADSIG`, or `EXPKEYSIG` errors. The package version carries the Linux revision, for example `0.2.2~rc.1-linux.1`.

## Recovery

- Rerun the workflow for the same release. The package and index merge are idempotent.
- If a release was published with wrong bytes under an existing version, publish a new `-linux.<n>` release rather than replacing the asset in place.
- If the `Packages` asset is lost, republish releases in order or delete and recreate the `apt` release and republish every retained version. Keep the tag stable.
- Do not delete an old `.deb` while the current index still references it. The repository intentionally keeps all versions.

## Security

The signing key protects the update channel after users install the public keyring. The first download of that keyring still trusts this GitHub repository, so publish its fingerprint in the release notes or README and review key changes.

Automatic signing means anyone who can publish a release in this repository can add a package to the channel. If release access becomes shared, add a protected GitHub Environment or switch back to manual dispatch.

The Linux desktop build itself is not code-signed. Repository signing protects the APT index and package hashes; it does not change the application binary's code-signing status.
