// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { DESKTOP_IPC } from '../src/ipc.ts'
import { syncTitleBarAppearance } from '../src/preload-titlebar.ts'

const send = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ ipcRenderer: { send } }))
vi.mock('../src/preload-menu.ts', () => ({ installCaptionMenu: () => ({ update: vi.fn(), dispose: vi.fn() }) }))

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'))
  document.documentElement.removeAttribute('data-desktop-titlebar')
  document.documentElement.style.removeProperty('--dsh-desktop-titlebar-height')
  document.documentElement.lang = 'en'
  document.body.removeAttribute('data-ds-dark-theme')
  vi.restoreAllMocks()
  send.mockClear()
})

it('does not install a caption row on macOS', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  syncTitleBarAppearance()
  expect(document.documentElement.hasAttribute('data-desktop-titlebar')).toBe(false)
  expect(send).not.toHaveBeenCalled()
})

it('keeps the fallback caption colors when the renderer exposes no 2D context', () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  syncTitleBarAppearance()
  expect(document.documentElement.hasAttribute('data-desktop-titlebar')).toBe(true)
  expect(document.querySelector('span')).toBeNull()
  expect(send).not.toHaveBeenCalled()
})

it.each(['win32', 'linux'] as const)('marks the %s caption row and publishes its palette', async (platform) => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation(() => ({
    backgroundColor: document.body.hasAttribute('data-ds-dark-theme') ? 'oklch(0.2 0 0)' : 'hsl(0 0% 100%)',
    color: 'black',
  }) as CSSStyleDeclaration)
  const context = {
    fillStyle: '', clearRect: vi.fn(), fillRect: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(context.fillStyle === 'black'
      ? [0, 0, 0, 255] : context.fillStyle.startsWith('oklch') ? [27, 27, 28, 255] : [255, 255, 255, 255]) }),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never)
  document.documentElement.lang = 'en'
  syncTitleBarAppearance()
  expect(send).not.toHaveBeenCalled()
  expect(document.documentElement.hasAttribute('data-desktop-titlebar')).toBe(true)
  window.dispatchEvent(new Event('DOMContentLoaded'))
  expect(document.documentElement.style.getPropertyValue('--dsh-desktop-titlebar-height')).toBe('40px')
  expect(send).toHaveBeenLastCalledWith(DESKTOP_IPC.titleBarAppearance, 'en', 'rgba(255, 255, 255, 1)', 'rgba(0, 0, 0, 1)')
  document.documentElement.lang = 'zh-CN'
  document.body.setAttribute('data-ds-dark-theme', '')
  await vi.waitFor(() => { expect(send).toHaveBeenLastCalledWith(DESKTOP_IPC.titleBarAppearance, 'zh-CN', 'rgba(27, 27, 28, 1)', 'rgba(0, 0, 0, 1)') })
  window.dispatchEvent(new Event('pagehide'))
  send.mockClear()
  document.documentElement.lang = 'en'
  await new Promise<void>((resolve) => { queueMicrotask(resolve) })
  expect(send).not.toHaveBeenCalled()
})
