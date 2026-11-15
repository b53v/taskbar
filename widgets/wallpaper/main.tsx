import app from "ags/gtk4/app";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import options from "options";

const SCRIPT = `${GLib.get_user_config_dir()}/ags/scripts/video-wallpaper.js`;
const LAYER_SHELL_LIB = "/usr/lib/libgtk4-layer-shell.so.0";

let videoProcess: Gio.Subprocess | null = null;

function getPid(): number {
  try {
    const [ok, contents] = GLib.file_get_contents("/proc/self/stat");
    if (!ok) return 0;
    return Number(new TextDecoder().decode(contents).split(" ")[0]);
  } catch {
    return 0;
  }
}

function stopVideoProcess(): void {
  const proc = videoProcess;
  videoProcess = null;
  if (!proc) return;
  try {
    proc.force_exit();
  } catch (error) {
    console.error("Failed to stop video wallpaper process:", error);
  }
}

export function stopVideoWallpaper(): void {
  stopVideoProcess();
}

function startVideoProcess(path: string): void {
  if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return;

  const gjs = GLib.find_program_in_path("gjs");
  if (!gjs) {
    console.error("gjs is required for the native video wallpaper");
    return;
  }

  try {
    const launcher = new Gio.SubprocessLauncher({
      flags:
        Gio.SubprocessFlags.STDOUT_SILENCE |
        Gio.SubprocessFlags.STDERR_SILENCE,
    });

    // gtk4-layer-shell must come before libwayland in the link order. The AGS
    // process already links it correctly, but a standalone gjs process does
    // not, so preload it there.
    if (GLib.file_test(LAYER_SHELL_LIB, GLib.FileTest.EXISTS)) {
      launcher.setenv("LD_PRELOAD", LAYER_SHELL_LIB, true);
    }

    videoProcess = launcher.spawnv([
      gjs,
      SCRIPT,
      path,
      `${getPid()}`,
    ]);
  } catch (error) {
    console.error("Failed to start video wallpaper process:", error);
    videoProcess = null;
  }
}

/** Switch the desktop video live and persist the choice in config.json. */
export function setVideoWallpaper(path: string | null): void {
  const value = path ?? "";
  options["wallpaper.video"].value = value;
  if (value) options["wallpaper.we"].value = "";

  stopVideoProcess();
  if (value) startVideoProcess(value);
}

export default function Wallpaper() {
  const path = options["wallpaper.video"].get();
  if (path) setVideoWallpaper(path);
}

app.connect("shutdown", () => stopVideoProcess());
