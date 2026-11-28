import GLib from "gi://GLib?version=2.0";
import { initializeConfig, defineOption } from "./utils/config";

const options = initializeConfig(
  `${GLib.get_user_config_dir()}/ags/config.json`,
  {
    "app.audio": defineOption("pwvucontrol"),
    "app.bluetooth": defineOption("overskride"),
    "app.resource-monitor": defineOption("resources"),
    "app.wifi": defineOption(
      "XDG_CURRENT_DESKTOP=GNOME gnome-control-center wifi",
    ),
    "bar.position": defineOption("top"), // "top", "bottom"
    "bar.style": defineOption("expanded"), // "floating" or "expanded"
    // "auto": Matugen light/dark ink; "dynamic": white ink + dark halo for
    // video/scene backdrops whose frames change under the bar.
    "bar.ink": defineOption("auto"),
    "bar.modules.os-icon.type": defineOption("arch-symbolic"),
    "bar.modules.os-icon.enable": defineOption(true),
    "bar.modules.media.enable": defineOption(true),
    "hardware-monitor.notifications.enable": defineOption(true),
    "hardware-monitor.thresholds.cpu-temp": defineOption(85),
    "hardware-monitor.thresholds.gpu-temp": defineOption(85),
    "hardware-monitor.thresholds.memory": defineOption(0.95),
    "notification-center.max-notifications": defineOption(4),
    "notification-center.history-limit": defineOption(200),
    "notification-center.history-days": defineOption(30),
    "system-menu.modules.bluetooth-advanced.enable": defineOption(true),
    "system-menu.modules.wifi-advanced.enable": defineOption(true),
    // Optional native layer-shell video wallpaper (empty = disabled).
    "wallpaper.video": defineOption(""),
    // Optional native Wallpaper Engine project directory (Almamu renderer).
    "wallpaper.we": defineOption(""),
  },
);

export default options;
