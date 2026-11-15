import { Astal, Gtk } from "ags/gtk4";
import Notifd from "gi://AstalNotifd";
import { createBinding, createComputed, For } from "ags";
import { gdkmonitor } from "utils/monitors.ts";
import options from "options.ts";
import { NotificationWidget } from "./modules/LiveNotification.tsx";

export default function Notifications() {
  const notifd = Notifd.get_default();
  const { TOP, RIGHT } = Astal.WindowAnchor;

  const notifications = createBinding(notifd, "notifications");
  const recentNotifications = createComputed(
    [notifications],
    (notifs) => notifs.slice(0, 6),
  );
  const isDndMode = createBinding(notifd, "dont-disturb");

  const shouldShowWindow = createComputed(
    [notifications, isDndMode],
    (notifs, dndEnabled) => {
      // Hide window completely when DND is on or no notifications
      return !dndEnabled && notifs.length > 0;
    },
  );

  return (
    <window
      name="notifications"
      namespace="notifications"
      layer={Astal.Layer.OVERLAY}
      gdkmonitor={gdkmonitor}
      anchor={TOP | RIGHT}
      $={(self) => {
        self.set_default_size(1, 1);
      }}
      visible={shouldShowWindow}
    >
      <box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["notifications", "popup-glass-light"]}
      >
        <For each={recentNotifications}>
          {(notification) => <NotificationWidget notification={notification} />}
        </For>
      </box>
    </window>
  );
}
