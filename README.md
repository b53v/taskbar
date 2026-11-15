# Taskbar

A customized GTK4 desktop bar and shell for Hyprland, built with AGS / Astal, GJS, SCSS, and Matugen theming.

Repository: https://github.com/b53v/taskbar

## Highlights

- **Status Bar & Modules**: Workspaces, active window/clients, media player status, hardware telemetry (CPU, memory, disk, GPU, network), volume, notifications button, system tray, and clock.
- **Popups & Overlays**: Picker (apps, clipboard, wallpapers), system menu & notification center, music player popup, OSD, logout menu, and native video/scene wallpaper support.
- **Matugen Dynamic Styling**: SCSS styling under `style/` with automatic contrast adaptation (`_wallpaper-contrast.scss`, `_glass.scss`) and live stylesheet reload.
- **Low-Memory Launcher (`start-ags-lite.sh`)**:
  - Incrementally bundles `app.ts` to `$XDG_RUNTIME_DIR/ags.js` only when TypeScript sources change and executes `gjs -m` directly (no persistent `ags run` Go wrapper).
  - Sets `GSK_RENDERER=cairo` for GTK4 so the bar avoids loading per-process GL/Vulkan GPU shader heaps.
  - Skips redundant startup `sass` compilation when `style/main.css` already exists cleanly, while preserving `.scss` hot-reload.
  - Caps `wallpaper.cache-size` at `12`, clears thumbnail cache when hiding the picker, and schedules low-priority GJS `System.gc()` sweeps.

## Quick Start

```bash
git clone https://github.com/b53v/taskbar.git ~/.config/ags
chmod +x ~/.config/ags/start-ags-lite.sh
~/.config/ags/start-ags-lite.sh
```

In Hyprland (`Startup_Apps.conf`):

```ini
exec-once = $HOME/.config/ags/start-ags-lite.sh
```

## IPC Commands

The running instance registers as `taskbar`:

```bash
ags list
ags request -i taskbar picker
ags request -i taskbar system-menu
ags request -i taskbar music-player
ags request -i taskbar logout
ags request -i taskbar reload-css
ags request -i taskbar wall-rand
ags request -i taskbar gc
```

## Directory Layout

- `app.ts` — AGS entry point (`instanceName: "taskbar"`), request handler, and startup/GC lifecycle
- `options.ts` — Configurable options (`bar.*`, `wallpaper.*`, `system-menu.*`, etc.)
- `start-ags-lite.sh` — Incremental bundler and low-memory `gjs -m` launcher
- `widgets/` — Bar modules, picker, system menu, notifications, music player, OSD, logout menu, wallpaper
- `utils/` — Compositor integration, config manager, wallpaper/thumbnail managers, system monitors, Wi-Fi/Bluetooth/MPRIS helpers
- `style/` — Modular SCSS stylesheets and compiled `main.css`
- `matugen/` — Matugen templates for GTK, AGS SCSS, Hyprland, and Hyprlock
- `tests/` — Regression and theme/contrast test scripts
