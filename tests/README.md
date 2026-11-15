# Local regression checks

Run from the AGS project directory in a running Hyprland session:

```sh
python tests/run-regressions.py
```

Requires the existing `ags`, `gjs`, GTK4/Astal libraries and Python 3. It uses a
temporary config/cache under `/tmp/opencode`, never the live notification cache.
It does not start another shell or restart the running one. Filesystem and GPU
sampling are exercised against the local hardware; application focus and device
connection state are not changed.

Coverage:

- CSS request debounce, serial execution, queued requests and failure recovery.
- Hardware update non-reentrancy, consumer leases and timer cleanup.
- Asynchronous disk information queries.
- Notification age/count limits, show more/reset, batch read and async persistence.
- Widget construction and nested Hyprland title/workspace notifications.
- Symbolic icon fallback.

Manual checks after restarting AGS:

1. Change tabs in the same browser window; the active title should update.
2. Move/close windows on an existing workspace; occupancy should update.
3. Repeatedly scan Bluetooth devices, then connect/disconnect once; only one OSD
   should be shown. Repeat with a device that was present at shell startup.
4. Switch wallpapers/themes rapidly; the bar should remain responsive. A broken
   SCSS edit should leave the last successful style active; fixing it should reload.
5. Open notification history and mark all read. The unread
   badge should clear even when there are more than four notifications.

The live bar retains its original compact layout: the optional active title and
client icon strip are not mounted. Hardware labels use their original natural
widths. The notification list keeps its original layout and more-history label;
the manager's show-more/reset operations are only exercised in the regression
tests, not exposed by additional UI controls.

## New history settings

`options.ts` defines these defaults (they can be overridden in `config.json`):

```json
{
  "notification-center.max-notifications": 4,
  "notification-center.history-limit": 200,
  "notification-center.history-days": 30
}
```

The first setting is the initial page size; the other two bound persisted history.
Notifications older than the retention window or beyond the count limit are
pruned at startup, on updates and during hourly maintenance. Writes are debounced
by 300 ms and serialized. An abrupt process kill within that window can lose the
latest updates.

CPU/RAM polling remains at 3 seconds. GPU polling is 10 seconds; disk polling is
30 seconds and only runs while the detailed hardware widget is mapped. Configured
`app.resource-monitor` is preferred, with the existing kitty/btop launch retained
as a fallback when that executable is unavailable. Volume middle-click uses
`app.audio`.

## Wallpaper contrast and theme fading

```sh
python tests/wallpaper-contrast.py
python tests/theme-transition.py
```

The first uses synthetic images and an isolated config to check local contrast,
mixed light/dark backgrounds, mode hysteresis, manual overrides, atomic SCSS
output and shell integration (AGS/Matugen are mocked). The analyzer uses the
existing top 5% image strip; it does not capture desktop pixels or run per frame.
It accounts for left/center/right zones and applies a glyph-only opposite-color
rim when neither black nor white ink gives reliable contrast across the strip.
The glass fill, fonts, sizes and layout are unchanged. This is a heuristic, not
a guarantee of WCAG contrast on every pixel, crop or monitor arrangement.

The second needs the installed `gtk4-broadwayd` and `chromium`. It compiles both
theme modes with/without the stronger rim, then uses a private Broadway display
and headless browser to assert intermediate text/icon colors during the 400ms
transition, final colors, unchanged label geometry, and invalid-CSS recovery.
It does not create a window on the real desktop or switch the live theme.

After activation, manually switch a bright/dark/mixed wallpaper and check
readability of the left telemetry, center workspaces and right clock. Theme
changes fade colors/shadows only; the existing 180ms workspace movement remains.
