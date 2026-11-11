import { describe, expect, it } from 'vitest'
import { aptAssetName, mergePackages, normalizeDebVersion, parsePackages, parseReleaseTag } from '../apt/publish.mjs'

describe('APT release tags', () => {
  it('extracts the upstream version and the Linux packaging revision', () => {
    expect(parseReleaseTag('v0.2.1-rc.2-linux.2')).toEqual({
      appVersion: '0.2.1-rc.2',
      revision: 'linux.2',
    })
  })

  it('rejects releases without a Linux revision', () => {
    expect(() => parseReleaseTag('v0.2.1-rc.2')).toThrow(/linux/)
  })
})

describe('APT Debian versions', () => {
  it('appends the Linux packaging revision', () => {
    expect(normalizeDebVersion('0.2.1~rc.2', 'linux.2')).toBe('0.2.1~rc.2-linux.2')
  })

  it('is idempotent for an already normalized version', () => {
    expect(normalizeDebVersion('0.2.1~rc.2-linux.2', 'linux.2')).toBe('0.2.1~rc.2-linux.2')
  })

  it('rejects an existing different Debian revision', () => {
    expect(() => normalizeDebVersion('0.2.1~rc.2-1', 'linux.2')).toThrow(/already carries/)
  })
})

describe('APT release asset names', () => {
  it('replaces characters GitHub rewrites while keeping the control version intact', () => {
    expect(aptAssetName('deepseek-harness', '0.2.1~rc.2-linux.2', 'amd64')).toBe(
      'deepseek-harness_0.2.1.rc.2-linux.2_amd64.deb',
    )
  })
})

describe('APT Packages merging', () => {
  const first = [
    'Package: deepseek-harness',
    'Version: 0.2.1~rc.2-linux.1',
    'Architecture: amd64',
    'SHA256: a',
    '',
  ].join('\n')
  const second = [
    'Package: deepseek-harness',
    'Version: 0.2.1~rc.2-linux.2',
    'Architecture: amd64',
    'SHA256: b',
    '',
  ].join('\n')

  it('keeps every version and appends the new stanza', () => {
    const merged = mergePackages(first, second)
    expect(parsePackages(merged)).toHaveLength(2)
    expect(merged).toContain('0.2.1~rc.2-linux.1')
    expect(merged).toContain('0.2.1~rc.2-linux.2')
  })

  it('replaces an identical version instead of duplicating it', () => {
    const merged = mergePackages(first, first)
    expect(parsePackages(merged)).toHaveLength(1)
  })

  it('rejects the same version with different bytes', () => {
    const changed = first.replace('SHA256: a', 'SHA256: c')
    expect(() => mergePackages(first, changed)).toThrow(/different bytes/)
  })
})
