# Agent Note: The Linux desktop caption row

Status: implemented

English | [中文](2026-10-29-linux-desktop-caption.zh.md)

## Problem

The Linux main window kept the native GTK client-side decorations: a separate titlebar above the application, GTK3-styled controls, and square window corners. Electron 44 made frameless windows viable on Linux — it rounds their corners when the desktop environment supports client-side decorations and draws the Window Controls Overlay (WCO) buttons with the system theme's icons ([electron#51459](https://github.com/electron/electron/pull/51459), [electron#52531](https://github.com/electron/electron/pull/52531)). Reaching that presentation requires a frameless window and a caption row that reserves the controls' space, which only Windows had.

## Decision

The Linux main window is created with `titleBarStyle: 'hidden'` and `titleBarOverlay`, using the same 40-DIP caption height as Windows. The desktop caption marker and its CSS variables are platform-neutral (`data-desktop-titlebar`, `--dsh-desktop-titlebar-height`, `--dsh-desktop-content-radius`, `--dsh-desktop-sidebar-width`, `--dsh-desktop-menu-start`), and both platform preloads publish them. Layout, sidebar, fullscreen-panel, settings, and theme rules read only the shared marker, so Windows and Linux share one caption presentation while macOS keeps its inset traffic lights.

A frameless Linux window has no native menu bar, so the Linux preload also mounts the caption Application and Edit entries that open validated native popup menus in the main process. The fullscreen relay now includes Linux, letting the shared CSS drop caption clearance while the native controls are hidden, and the isolated update view starts below the caption there. Caption colors follow the application palette through the renamed `titleBarAppearance` IPC channel and `setTitleBarOverlay`.

## Alternatives considered

Keeping the native GTK frame preserves the menu bar and needs no listing changes, but it keeps GTK3 titlebar chrome and square corners and cannot place content beside the controls. Publishing a Linux-only marker would duplicate every caption rule and force each client package to know two platforms for one presentation. Custom HTML window controls would give the application full control of the caption, but they would replace the desktop's own buttons, keyboard behavior, and theme icons — the reason the WCO path exists.

## Consequences

The Linux window is frameless, so the desktop environment draws its own control icons and rounds the corners when it supports client-side decorations; a desktop environment without that support keeps square corners. The caption row consumes 40 DIP above the content and hosts the drag region. Linux loses the Alt-revealed native menu row and gains the Desktop-owned caption menus instead. Caption colors and menu language follow the application document; sender validation still rejects foreign frames, unknown menu names, and invalid anchors. Ordinary Web documents receive no marker and keep their own rail, and macOS presentation is unchanged.

## Testing

Desktop startup tests cover the per-platform window options, the fullscreen relay, caption color messages, and menu sender validation. Preload tests cover the caption marker and palette publishing on Windows and Linux and its absence on macOS. Client layout, sidebar, fullscreen-panel, settings, theme, and dockkit suites cover the shared marker and its clearance variables. Manual verification on GNOME Wayland confirmed the rounded frameless window and the system-themed controls.
