// widgets/bar/modules/ActiveWindow.tsx
import { Gtk } from "ags/gtk4";
import { createComputed } from "ags";
import Gio from "gi://Gio?version=2.0";
import { compositor } from "utils/compositor/detector";
import { getAppIcon } from "utils/clients";

export default function ActiveWindow() {
  const focusedClient = compositor.focusedClient;

  const isVisible = focusedClient((c) => !!c?.title);

  const windowTitle = createComputed([focusedClient], (client) => {
    if (!client || !client.title) return "";
    const title = client.title.trim();
    return title.length > 24 ? title.slice(0, 22) + "…" : title;
  });

  const appIcon = createComputed([focusedClient], (client) => {
    if (!client || !client.class) return "application-x-executable-symbolic";
    return getAppIcon(client.class, true);
  });

  return (
    <box
      visible={isVisible}
      cssClasses={["bar-active-window"]}
      spacing={5}
      valign={Gtk.Align.CENTER}
    >
      <image gicon={appIcon((icon) => Gio.icon_new_for_string(icon))} cssClasses={["active-window-icon"]} />
      <label cssClasses={["active-window-title"]} label={windowTitle} />
    </box>
  );
}
