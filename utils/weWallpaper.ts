import app from "ags/gtk4/app";
import { execAsync } from "ags/process";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import options from "options";

const APP_DIR = `${GLib.get_home_dir()}/.local/opt/lwe-root/opt/linux-wallpaperengine`;
const DEPS_DIR = `${GLib.get_home_dir()}/.local/opt/lwe-deps/usr/lib`;
const SCREEN = "DP-1";

let weProcess: Gio.Subprocess | null = null;
let startEpoch = 0;

async function cleanupOrphanWeProcess(): Promise<void> {
  try {
    await execAsync(["pkill", "-f", "^\\./linux-wallpaperengine"]);
  } catch {
    // No orphan: pkill exits non-zero.
  }
}

export function stopWeWallpaper(): void {
  startEpoch++;
  const proc = weProcess;
  weProcess = null;
  if (proc) {
    try {
      proc.force_exit();
    } catch (error) {
      console.error("Failed to stop Almamu wallpaper process:", error);
    }
  } else {
    void cleanupOrphanWeProcess();
  }
}

async function startWeWallpaper(projectDir: string): Promise<void> {
  stopWeWallpaper();
  const epoch = startEpoch;
  if (!projectDir || !GLib.file_test(projectDir, GLib.FileTest.EXISTS)) return;

  const binary = `${APP_DIR}/linux-wallpaperengine`;
  if (!GLib.file_test(binary, GLib.FileTest.EXISTS)) {
    console.error("Almamu binary not found:", binary);
    return;
  }

  await cleanupOrphanWeProcess();
  if (epoch !== startEpoch) return;

  try {
    const launcher = new Gio.SubprocessLauncher({
      flags:
        Gio.SubprocessFlags.STDOUT_SILENCE |
        Gio.SubprocessFlags.STDERR_SILENCE,
    });
    launcher.set_cwd(APP_DIR);
    launcher.setenv(
      "LD_LIBRARY_PATH",
      `${DEPS_DIR}:${APP_DIR}:${APP_DIR}/lib`,
      true,
    );
    launcher.setenv("__GL_THREADED_OPTIMIZATIONS", "0", true);

    weProcess = launcher.spawnv([
      "./linux-wallpaperengine",
      "--screen-root",
      SCREEN,
      "--bg",
      projectDir,
      "--scaling",
      "fill",
      "--layer",
      "bottom",
      "--fps",
      "30",
      "--silent",
    ]);
  } catch (error) {
    console.error("Failed to start Almamu wallpaper process:", error);
    weProcess = null;
  }
}

export function setWeWallpaper(projectDir: string | null): void {
  const value = projectDir ?? "";
  options["wallpaper.we"].value = value;
  if (value) options["wallpaper.video"].value = "";
  void startWeWallpaper(value);
}

export default function WeWallpaper() {
  const path = options["wallpaper.we"].get();
  if (path) void startWeWallpaper(path);
}

app.connect("shutdown", () => stopWeWallpaper());
