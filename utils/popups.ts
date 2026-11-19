import { createRoot } from "ags";
import app from "ags/gtk4/app";
import { Gtk } from "ags/gtk4";

export type PopupName =
  | "system-menu"
  | "music-player"
  | "picker"
  | "logout-menu";

const popupLoaders: Record<
  PopupName,
  () => Promise<{ default: () => unknown }>
> = {
  "system-menu": () => import("../widgets/system-menu/main.tsx"),
  "music-player": () => import("../widgets/music/main.tsx"),
  picker: () => import("../widgets/picker/main.tsx"),
  "logout-menu": () => import("../widgets/logout-menu/main.tsx"),
};

const inFlight = new Map<PopupName, Promise<void>>();

/**
 * Lazily import and construct a popup window on first access so startup only
 * mounts always-present shell surfaces.
 */
export async function ensurePopup(name: PopupName): Promise<void> {
  if (app.get_window(name)) return;

  let pending = inFlight.get(name);
  if (!pending) {
    pending = (async () => {
      const mod = await popupLoaders[name]();
      if (app.get_window(name)) return;
      createRoot((dispose) => {
        const win = mod.default() as Gtk.Window | undefined;
        win?.connect("destroy", dispose);
      });
    })().finally(() => {
      inFlight.delete(name);
    });
    inFlight.set(name, pending);
  }

  await pending;
}

/**
 * Ensure a popup window is instantiated, then toggle its visibility.
 */
export async function togglePopup(name: PopupName): Promise<void> {
  await ensurePopup(name);
  app.toggle_window(name);
}
