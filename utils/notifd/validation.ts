import { Gtk, Gdk } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";

export const isIcon = (icon: string): boolean => {
  if (!icon) return false;
  const display = Gdk.Display.get_default();
  if (!display) return false;
  const iconTheme = Gtk.IconTheme.get_for_display(display);
  return iconTheme.has_icon(icon);
};

export const resolveIconFile = (icon: string): string | null => {
  if (!icon) return null;
  let path = icon;
  if (path.startsWith("file://")) {
    try {
      const [filename] = GLib.filename_from_uri(path);
      if (filename) path = filename;
    } catch {
      path = path.replace(/^file:\/\//, "");
    }
  }
  return GLib.file_test(path, GLib.FileTest.IS_REGULAR) ? path : null;
};

export const fileExists = (path: string): boolean =>
  resolveIconFile(path) !== null;
