# Agent Note: Linux 桌面顶栏

Status: implemented

[English](2026-10-29-linux-desktop-caption.md) | 中文

## Problem

Linux 主窗口沿用原生 GTK 客户端装饰：应用上方多一条独立标题栏，控件为 GTK3 样式，窗口四角为直角。Electron 44 让 Linux 上的无边框窗口变得可用——当桌面环境支持客户端装饰时绘制圆角，并用系统主题图标绘制 Window Controls Overlay（WCO）按钮（[electron#51459](https://github.com/electron/electron/pull/51459)、[electron#52531](https://github.com/electron/electron/pull/52531)）。要获得这种呈现，窗口必须无边框，并且需要一条为控件预留空间的顶栏，而此前只有 Windows 具备该结构。

## Decision

Linux 主窗口以 `titleBarStyle: 'hidden'` 和 `titleBarOverlay` 创建，顶栏高度与 Windows 相同，为 40 DIP。桌面顶栏标记及其 CSS 变量改为平台中立（`data-desktop-titlebar`、`--dsh-desktop-titlebar-height`、`--dsh-desktop-content-radius`、`--dsh-desktop-sidebar-width`、`--dsh-desktop-menu-start`），两个平台的 preload 都会发布它们。布局、侧栏、全屏面板、设置和主题规则只读取共享标记，因此 Windows 与 Linux 共用同一套顶栏呈现，macOS 保留其内嵌红绿灯按钮。

无边框的 Linux 窗口没有原生菜单栏，因此 Linux preload 也挂载顶栏中的“应用”和“编辑”入口，由主进程打开经过校验的原生弹出菜单。全屏状态转发现在包含 Linux，让共享 CSS 在原生控件隐藏时去掉顶栏避让；隔离的更新视图在该平台也从顶栏下方开始。顶栏颜色通过改名的 `titleBarAppearance` IPC 通道和 `setTitleBarOverlay` 跟随应用调色板。

## Alternatives considered

保留原生 GTK 边框可以保留菜单栏且无需改动布局，但会保留 GTK3 标题栏外观和直角，并且无法把内容放到控件旁边。只发布 Linux 专用标记会复制全部顶栏规则，并让每个客户端包为同一种呈现感知两个平台。自定义 HTML 窗口控件可以让应用完全控制顶栏，但会取代桌面自身的按钮、键盘行为和主题图标——这正是 WCO 方案存在的理由。

## Consequences

Linux 窗口为无边框，桌面环境绘制自己的控件图标，并在支持客户端装饰时绘制圆角；不支持该能力的桌面环境仍为直角。顶栏在内容上方占用 40 DIP，并承载拖拽区域。Linux 不再有按 Alt 唤出的原生菜单行，改为使用 Desktop 拥有的顶栏菜单。顶栏颜色和菜单语言跟随应用文档；发送方校验仍会拒绝外部 frame、未知菜单名和非法锚点。普通 Web 文档不会获得该标记并保留自身侧轨，macOS 呈现不变。

## Testing

桌面启动测试覆盖各平台窗口选项、全屏转发、顶栏颜色消息和菜单发送方校验。preload 测试覆盖 Windows 与 Linux 的顶栏标记和调色板发布，以及 macOS 上不发布。客户端布局、侧栏、全屏面板、设置、主题和 dockkit 套件覆盖共享标记及其避让变量。在 GNOME Wayland 上的人工验证确认了无边框圆角窗口和系统主题控件。
