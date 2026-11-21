import app from "ags/gtk4/app";
import { Gtk } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";
import {
  createState,
  createComputed,
  onCleanup,
  createBinding,
  With,
} from "ags";
import { notificationManager } from "utils/notifd";
import { NotificationList } from "./modules/NotificationList.tsx";
import Notifd from "gi://AstalNotifd";

const REVEALER_DURATION_MS = 180;
const TEARDOWN_FALLBACK_MS = REVEALER_DURATION_MS + 40;

export const NotificationBox = () => {
  const notifd = Notifd.get_default();
  const isDndMode = createBinding(notifd, "dont-disturb");
  const [isExpanded, setIsExpanded] = createState(false);
  const [shouldRenderList, setShouldRenderList] = createState(false);

  const {
    limitedActiveNotifications: activeNotifications,
    hasNotifications,
    unreadCount,
  } = notificationManager;

  let teardownTimerId: number | null = null;

  const cancelTeardownTimer = () => {
    if (teardownTimerId !== null) {
      GLib.source_remove(teardownTimerId);
      teardownTimerId = null;
    }
  };

  const teardownList = () => {
    cancelTeardownTimer();
    if (!isExpanded.get()) {
      setShouldRenderList(false);
      notificationManager.resetVisibleNotifications();
    }
  };

  const collapseNow = () => {
    cancelTeardownTimer();
    if (isExpanded.get()) {
      setIsExpanded(false);
    }
    if (shouldRenderList.get()) {
      setShouldRenderList(false);
      notificationManager.resetVisibleNotifications();
    }
  };

  const toggleExpanded = () => {
    const opening = !isExpanded.get();
    if (opening) {
      cancelTeardownTimer();
      notificationManager.resetVisibleNotifications();
      notificationManager.markManyAsSeen(
        activeNotifications.get().map((n) => n.id),
      );
      setShouldRenderList(true);
      setIsExpanded(true);
    } else {
      setIsExpanded(false);
      cancelTeardownTimer();
      teardownTimerId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        TEARDOWN_FALLBACK_MS,
        () => {
          teardownTimerId = null;
          teardownList();
          return GLib.SOURCE_REMOVE;
        },
      );
    }
  };

  const notificationIcon = createComputed(() => {
    if (isDndMode()) {
      return "notifications-disabled-symbolic";
    }
    if (!hasNotifications()) return "preferences-system-notifications-symbolic";
    if (unreadCount() > 0) return "mail-message-new-symbolic";
    return "mail-unread-symbolic";
  });

  const toggleDndMode = () => {
    const currentDnd = notifd.get_dont_disturb();
    notifd.set_dont_disturb(!currentDnd);
  };

  const dndButtonClasses = createComputed(() =>
    hasNotifications() && !isDndMode() ? ["button"] : ["button-disabled"],
  );

  return (
    <box
      cssClasses={["toggle", "notification-toggle-box"]}
      orientation={Gtk.Orientation.VERTICAL}
      hexpand={true}
    >
      {/* Notification Toggle Header */}
      <box cssClasses={["toggle-header"]} hexpand={true}>
        <button
          cssClasses={dndButtonClasses}
          onClicked={toggleDndMode}
          tooltipText={isDndMode((dnd) =>
            dnd ? "Disable Do Not Disturb" : "Enable Do Not Disturb",
          )}
        >
          <image iconName={notificationIcon} />
        </button>

        <button hexpand={true} onClicked={toggleExpanded}>
          <box hexpand={true} valign={Gtk.Align.CENTER}>
            <label xalign={0} label="Notifications" />
            <label
              label="DND"
              cssClasses={["dnd-indicator"]}
              visible={isDndMode}
            />
            <label
              label={unreadCount((count) => count.toString())}
              cssClasses={["unread-badge"]}
              visible={unreadCount((count) => count > 0)}
            />
            <image
              iconName="pan-end-symbolic"
              halign={Gtk.Align.END}
              hexpand={true}
              cssClasses={isExpanded((expanded) =>
                expanded
                  ? ["arrow-indicator", "arrow-down"]
                  : ["arrow-indicator"],
              )}
            />
          </box>
        </button>
      </box>

      {/* Notifications List Revealer (lazily mounted only while expanded) */}
      <revealer
        transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
        transitionDuration={REVEALER_DURATION_MS}
        revealChild={isExpanded}
        $={(self) => {
          const childRevealedId = self.connect(
            "notify::child-revealed",
            () => {
              if (!self.reveal_child && !self.child_revealed) {
                teardownList();
              }
            },
          );

          const windowListener = app.connect("window-toggled", (_, window) => {
            if (window.name === "system-menu" && !window.visible) {
              collapseNow();
            }
          });

          onCleanup(() => {
            cancelTeardownTimer();
            self.disconnect(childRevealedId);
            app.disconnect(windowListener);
          });
        }}
      >
        <box orientation={Gtk.Orientation.VERTICAL} hexpand={true}>
          <With value={shouldRenderList}>
            {(render) => (render ? <NotificationList /> : null)}
          </With>
        </box>
      </revealer>
    </box>
  );
};

export default NotificationBox;
