// widgets/bar/modules/NotificationButton.tsx
import { Gtk } from "ags/gtk4";
import app from "ags/gtk4/app";
import Notifd from "gi://AstalNotifd";
import { createBinding, createComputed } from "ags";
import { notificationManager } from "utils/notifd";

export default function NotificationButton() {
  const notifd = Notifd.get_default();
  const isDnd = createBinding(notifd, "dont-disturb");
  const { unreadCount } = notificationManager;

  const iconName = createComputed([isDnd, unreadCount], (dnd, unread) => {
    if (dnd) return "notifications-disabled-symbolic";
    if (unread > 0) return "mail-message-new-symbolic";
    return "preferences-system-notifications-symbolic";
  });

  return (
    <button
      cssClasses={["bar-notifications"]}
      tooltipText="Notifications (Click to open, Right click for DND)"
      onClicked={() => {
        app.toggle_window("system-menu");
      }}
      $={(self) => {
        const gesture = new Gtk.GestureClick();
        gesture.set_button(3); // Right click for DND toggle
        gesture.connect("pressed", () => {
          notifd.set_dont_disturb(!notifd.get_dont_disturb());
        });
        self.add_controller(gesture);
      }}
    >
      <image iconName={iconName} />
    </button>
  );
}
