import app from "ags/gtk4/app";
import { execAsync } from "ags/process";
import { monitorFile, readFile, writeFileAsync } from "ags/file";
import GLib from "gi://GLib?version=2.0";
import System from "system";
import { picker } from "utils/picker";
import options from "options";
import { CssReloader } from "utils/cssReload";
import { StyleProvider } from "utils/styleProvider";
import {
  setVideoWallpaper,
  stopVideoWallpaper,
} from "./widgets/wallpaper/main.tsx";
import WeWallpaper, {
  setWeWallpaper,
  stopWeWallpaper,
} from "utils/weWallpaper";

// Widgets
import {
  Bar,
  SystemMenu,
  OnScreenDisplay,
  LogoutMenu,
  PickerWindow,
  MusicPlayer,
  Notifications,
  Wallpaper,
} from "./widgets";

// Style paths
const scss = `${GLib.get_user_config_dir()}/ags/style/main.scss`;
const css = `${GLib.get_user_config_dir()}/ags/style/main.css`;
const icons = `${GLib.get_user_config_dir()}/ags/assets/icons`;
const stylesheet = new StyleProvider();
// Merge file events and explicit requests, and never run two compilers/writers
// at once. Compile to stdout so a failed Sass run cannot replace working CSS.
const cssReloader = new CssReloader(async () => {
  try {
    const compiled = await execAsync(["sass", "--no-charset", "--no-source-map", scss]);
    await writeFileAsync(css, compiled);
    stylesheet.apply(compiled);
  } catch (error) {
    console.error("CSS reload failed; keeping the current style:", error);
    throw error;
  }
});
const reloadCss = () => cssReloader.request();

app.start({
  icons,
  instanceName: "taskbar",
  requestHandler(argv: string[], res: (response: any) => void) {
    const request = argv[0];
    switch (request) {
      case "picker":
        app.toggle_window("picker");
        res("picker toggled");
        break;
      case "logout":
        app.toggle_window("logout-menu");
        res("logout menu toggled");
        break;
      case "reload-css":
        reloadCss().then(
          () => res("css reloaded"),
          (error) => res(`css reload failed: ${error}`),
        );
        break;
      case "wall-rand":
        picker.random("wp");
        res("random wallpaper set");
        break;
      case "set-video-wallpaper":
        stopWeWallpaper();
        options["bar.ink"].value = (argv[1] ?? "") ? "dynamic" : "auto";
        setVideoWallpaper(argv[1] ?? "");
        res("video wallpaper set");
        break;
      case "set-we-wallpaper":
        stopVideoWallpaper();
        options["bar.ink"].value = (argv[1] ?? "") ? "dynamic" : "auto";
        setWeWallpaper(argv[1] ?? "");
        res("we wallpaper set");
        break;
      case "clear-wallpapers":
        stopVideoWallpaper();
        stopWeWallpaper();
        options["wallpaper.video"].value = "";
        options["wallpaper.we"].value = "";
        options["bar.ink"].value = "auto";
        res("wallpapers cleared");
        break;
      case "gc":
        System.gc();
        res("gc requested");
        break;
      case "music-player":
      case "music":
        app.toggle_window("music-player");
        res("music-player toggled");
        break;
      case "notifications":
      case "system-menu":
        app.toggle_window("system-menu");
        res("system-menu toggled");
        break;
      default:
        res("not found");
    }
  },
  main() {
    let cssLoaded = false;
    if (GLib.file_test(css, GLib.FileTest.EXISTS)) {
      try {
        stylesheet.apply(readFile(css));
        cssLoaded = true;
      } catch (error) {
        console.warn("Ignoring invalid cached CSS:", error);
      }
    }
    // Compile CSS only if missing/invalid, and keep watching SCSS for hot-reload
    if (!cssLoaded) {
      void reloadCss().catch(() => {});
    }
    monitorFile(`${GLib.get_user_config_dir()}/ags/style`, (path) => {
      if (path.endsWith(".scss")) void reloadCss().catch(() => {});
    });

    // Video/scene backdrops change under the bar, so use the shadowed white
    // video ink. Static images keep Matugen's auto light/dark ink.
    options["bar.ink"].value =
      options["wallpaper.we"].get() || options["wallpaper.video"].get()
        ? "dynamic"
        : "auto";

    // Initialize widgets
    if (options["wallpaper.we"].get()) WeWallpaper();
    else Wallpaper();
    Bar();
    Notifications();
    OnScreenDisplay();
    SystemMenu();
    MusicPlayer();
    PickerWindow();
    LogoutMenu();

    // Post-startup and low-priority periodic GC to curb GJS heap growth.
    GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 2, () => {
      System.gc();
      return GLib.SOURCE_REMOVE;
    });
    GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 120, () => {
      System.gc();
      return GLib.SOURCE_CONTINUE;
    });
  },
});
