<div align="center">

# Taskbar

GTK4 status bar and desktop shell for Hyprland, built with [AGS / Astal](https://github.com/Aylur/astal) and [Matugen](https://github.com/InioX/matugen).

<p>
  <img src="https://img.shields.io/badge/Hyprland-Wayland-00B4D8?style=for-the-badge&logo=hyprland&logoColor=white" alt="Hyprland" />
  <img src="https://img.shields.io/badge/GTK4-Cairo-4A86CF?style=for-the-badge&logo=gnome&logoColor=white" alt="GTK4" />
  <img src="https://img.shields.io/badge/AGS-Astal-7C3AED?style=for-the-badge&logo=typescript&logoColor=white" alt="AGS Astal" />
  <img src="https://img.shields.io/badge/Theming-Matugen-F59E0B?style=for-the-badge&logo=materialdesign&logoColor=white" alt="Matugen" />
</p>

<p>
  <img src="https://img.shields.io/github/repo-size/b53v/taskbar?style=flat-square&color=60A5FA" alt="Repo Size" />
  <img src="https://img.shields.io/github/last-commit/b53v/taskbar/main?style=flat-square&color=34D399" alt="Last Commit" />
  <a href="LICENSE"><img src="https://img.shields.io/github/license/b53v/taskbar?style=flat-square&color=A78BFA" alt="License" /></a>
</p>

<br />

<img src="assets/screenshots/bar.png?v=4" alt="Taskbar" width="100%" />

</div>

## Screenshots

<table>
  <tr>
    <td align="center" width="50%">
      <img src="assets/screenshots/desktop.webp?v=4" alt="Desktop" width="100%" />
      <br />
      <sub>Desktop</sub>
    </td>
    <td align="center" width="50%">
      <img src="assets/screenshots/logout-menu.webp?v=4" alt="Logout Menu" width="100%" />
      <br />
      <sub>Logout Menu</sub>
    </td>
  </tr>
</table>

## Features

- **Bar**: OS icon, CPU/RAM/GPU stats, workspaces, collapsible tray, volume, notifications, network/BT, clock
- **Popups**: System menu (with per-app volume mixer), notification center, live toasts, logout menu, OSD
- **Theming**: Matugen colors with automatic light/dark bar text based on the wallpaper
- **Liquid Glass Optics**: Optional Hyprland plugin ([`hypr-plugin/hyprbar-ca/`](hypr-plugin/hyprbar-ca/)) adding whole-glass chromatic aberration + subtle 3D convex dome across the bar, popups, Rofi, and Fcitx5 IM popups
- **Performance**: Launches via [`start-ags-lite.sh`](start-ags-lite.sh) (`gjs -m` + `GSK_RENDERER=cairo`, no `ags run` wrapper) with lazy-loaded popups (`~118 MiB` PSS idle)

## Setup

```bash
git clone https://github.com/b53v/taskbar.git ~/.config/ags
chmod +x ~/.config/ags/start-ags-lite.sh
~/.config/ags/start-ags-lite.sh
```

Hyprland autostart:

```ini
exec-once = $HOME/.config/ags/start-ags-lite.sh
```

Optional Liquid Glass chromatic aberration plugin (Hyprland C++ plugin):

```bash
~/.config/ags/hypr-plugin/hyprbar-ca/build.sh
# Add to hyprland.conf / UserDecorations.conf:
# plugin = ~/.config/ags/hypr-plugin/hyprbar-ca/hyprbar-ca-v2.so
```

## IPC

```bash
ags request -i taskbar system-menu
ags request -i taskbar logout
ags request -i taskbar reload-css
ags request -i taskbar set-video-wallpaper /path/to/video.mp4
ags request -i taskbar set-we-wallpaper /path/to/project
ags request -i taskbar clear-wallpapers
ags request -i taskbar gc
```
