/** Default rolling release tag that hosts the APT repository. */
export const DEFAULT_APT_TAG: 'apt'

/** Name of the exported public key asset. */
export const KEYRING_ASSET: 'dsh-archive-keyring.gpg'

/** Release tag split into its upstream-facing version and Linux packaging revision. */
export interface ParsedReleaseTag {
  readonly appVersion: string
  readonly revision: string
}

/**
 * Extract the Linux packaging revision from a release tag.
 * @param tag - Release tag such as `v0.2.1-rc.2-linux.2`.
 * @returns The upstream-facing app version and the `linux.<n>` revision.
 */
export function parseReleaseTag(tag: string): ParsedReleaseTag

/**
 * Add a Debian revision to a package version.
 * @param controlVersion - Version read from the `.deb` control file.
 * @param revision - Linux packaging revision such as `linux.2`.
 * @returns A Debian version that sorts above the original build.
 */
export function normalizeDebVersion(controlVersion: string, revision: string): string

/**
 * Build a release-asset filename that avoids GitHub's asset-name rewriting.
 * @param packageName - Control Package name.
 * @param version - Normalized Debian version.
 * @param architecture - Control Architecture.
 * @returns A safe `.deb` asset name.
 */
export function aptAssetName(packageName: string, version: string, architecture: string): string

/**
 * Parse `Packages` stanzas.
 * @param text - `Packages` file contents.
 * @returns Trimmed stanza strings in file order.
 */
export function parsePackages(text: string): string[]

/**
 * Merge new stanzas into an existing index.
 * @param existing - Current `Packages` contents, or an empty string.
 * @param additions - New stanzas, separated by blank lines.
 * @returns The merged `Packages` contents.
 */
export function mergePackages(existing: string, additions: string): string
