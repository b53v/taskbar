import { Gdk, Gtk } from "ags/gtk4";
import GdkPixbuf from "gi://GdkPixbuf?version=2.0";
import { isIcon, resolveIconFile } from "utils/notifd";
import type { DisplayNotification } from "utils/notifd";

const DEFAULT_ICON_SIZE = 38;
const MAX_DECODE_SIZE = 96;

export function NotificationIcon(
  notification: DisplayNotification,
  size = DEFAULT_ICON_SIZE,
) {
  const candidates = [
    notification.image,
    notification.appIcon,
    notification.desktopEntry,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    const filePath = resolveIconFile(candidate);
    if (filePath) {
      try {
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
          filePath,
          MAX_DECODE_SIZE,
          MAX_DECODE_SIZE,
          true,
        );
        const texture = Gdk.Texture.new_for_pixbuf(pixbuf);
        return (
          <box
            cssClasses={["thumb-frame"]}
            overflow={Gtk.Overflow.HIDDEN}
            widthRequest={size}
            heightRequest={size}
            halign={Gtk.Align.CENTER}
            valign={Gtk.Align.CENTER}
          >
            <Gtk.Picture
              paintable={texture}
              contentFit={Gtk.ContentFit.COVER}
              canShrink={true}
              widthRequest={size}
              heightRequest={size}
            />
          </box>
        );
      } catch {
        // Fall through to themed icon or next candidate if file decode fails
      }
    }

    if (isIcon(candidate)) {
      return (
        <image
          cssClasses={["thumb-icon"]}
          iconName={candidate}
          pixelSize={size - 2}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
        />
      );
    }
  }

  return null;
}
