import { Gtk } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";
import { For, onCleanup } from "ags";
import Notifd from "gi://AstalNotifd";
import { notificationManager } from "utils/notifd";
import { BaseNotification } from "widgets/notifications/modules/Notification.tsx";

const NOTIFICATION_SCROLL_MAX_HEIGHT = 420;
const DEFAULT_SCROLL_WIDTH = 340;

export const NotificationList = () => {
  const notifd = Notifd.get_default();

  const {
    limitedActiveNotifications,
    newNotifications,
    readNotifications,
    hasNotifications,
    hasNewNotifications,
    hasReadNotifications,
    moreNotificationsInfo,
    unreadCount,
  } = notificationManager;

  let scrollWidget: Gtk.ScrolledWindow | null = null;
  let cardsWidget: Gtk.Box | null = null;
  let measureIdleId: number | null = null;

  const cancelMeasureIdle = () => {
    if (measureIdleId !== null) {
      GLib.source_remove(measureIdleId);
      measureIdleId = null;
    }
  };

  const updateScrollMinHeight = () => {
    if (!scrollWidget || !cardsWidget) return;
    if (!hasNotifications.get()) {
      if (scrollWidget.get_min_content_height() !== 0) {
        scrollWidget.set_min_content_height(0);
      }
      return;
    }
    const allocWidth = scrollWidget.get_allocated_width();
    const forWidth = allocWidth > 100 ? allocWidth : DEFAULT_SCROLL_WIDTH;
    const [, naturalHeight] = cardsWidget.measure(
      Gtk.Orientation.VERTICAL,
      forWidth,
    );
    const target = Math.min(
      NOTIFICATION_SCROLL_MAX_HEIGHT,
      Math.max(0, Math.ceil(naturalHeight)),
    );
    if (scrollWidget.get_min_content_height() !== target) {
      scrollWidget.set_min_content_height(target);
    }
  };

  const scheduleMeasure = () => {
    cancelMeasureIdle();
    measureIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      measureIdleId = null;
      updateScrollMinHeight();
      return GLib.SOURCE_REMOVE;
    });
  };

  const unsubLimited = limitedActiveNotifications.subscribe(() => {
    scheduleMeasure();
  });

  onCleanup(() => {
    cancelMeasureIdle();
    unsubLimited();
    scrollWidget = null;
    cardsWidget = null;
  });

  const handleStoredAction = (id: number, action: string) => {
    try {
      const live = notifd.get_notification(id);
      if (live) {
        live.invoke(action);
      }
    } catch (error) {
      console.error("Error invoking stored notification action:", error);
    }
    notificationManager.dismissNotification(id);
  };

  const handleStoredDismiss = (id: number) => {
    notificationManager.dismissNotification(id);
  };

  return (
    <box
      orientation={Gtk.Orientation.VERTICAL}
      cssClasses={["system-menu-list", "notification-center"]}
      hexpand={true}
      spacing={8}
    >
      {/* Empty state */}
      <box
        cssClasses={["notification-empty"]}
        visible={hasNotifications((has) => !has)}
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}
        hexpand={true}
      >
        <label
          label="No notifications"
          cssClasses={["empty-label"]}
          halign={Gtk.Align.CENTER}
          hexpand={true}
        />
      </box>

      {/* Scrollable Notification Cards */}
      <Gtk.ScrolledWindow
        cssClasses={["notification-scroll"]}
        visible={hasNotifications}
        hexpand={true}
        hscrollbarPolicy={Gtk.PolicyType.NEVER}
        vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
        propagateNaturalHeight={true}
        maxContentHeight={NOTIFICATION_SCROLL_MAX_HEIGHT}
        overlayScrolling={true}
        $={(self) => {
          scrollWidget = self;
          updateScrollMinHeight();
          scheduleMeasure();

          const mapId = self.connect("map", () => {
            updateScrollMinHeight();
            scheduleMeasure();
          });

          onCleanup(() => {
            self.disconnect(mapId);
          });
        }}
      >
        <box
          orientation={Gtk.Orientation.VERTICAL}
          cssClasses={["notification-cards"]}
          hexpand={true}
          spacing={8}
          $={(self) => {
            cardsWidget = self;
            if (scrollWidget) {
              updateScrollMinHeight();
            }
          }}
        >
          {/* New Notifications Section */}
          <box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={["notification-section"]}
            visible={hasNewNotifications}
            hexpand={true}
            spacing={6}
          >
            <label
              label="New"
              xalign={0}
              halign={Gtk.Align.START}
              cssClasses={["section-label", "notification-section-label"]}
            />
            <box
              orientation={Gtk.Orientation.VERTICAL}
              spacing={6}
              hexpand={true}
            >
              <For each={newNotifications}>
                {(notification) => (
                  <BaseNotification
                    notification={notification}
                    variant="stored"
                    onAction={handleStoredAction}
                    onDismiss={handleStoredDismiss}
                    showDismissButton={true}
                    cssClasses={["notification"]}
                  />
                )}
              </For>
            </box>
          </box>

          {/* Earlier Notifications Section */}
          <box
            orientation={Gtk.Orientation.VERTICAL}
            cssClasses={["notification-section"]}
            visible={hasReadNotifications}
            hexpand={true}
            spacing={6}
          >
            <label
              label="Earlier"
              xalign={0}
              halign={Gtk.Align.START}
              cssClasses={["section-label", "notification-section-label"]}
            />
            <box
              orientation={Gtk.Orientation.VERTICAL}
              spacing={6}
              hexpand={true}
            >
              <For each={readNotifications}>
                {(notification) => (
                  <BaseNotification
                    notification={notification}
                    variant="stored"
                    onAction={handleStoredAction}
                    onDismiss={handleStoredDismiss}
                    showDismissButton={true}
                    cssClasses={["notification", "notification-read"]}
                  />
                )}
              </For>
            </box>
          </box>
        </box>
      </Gtk.ScrolledWindow>

      {/* Pinned Footer: Show More + Clear All / Mark Read (never clipped) */}
      <box
        orientation={Gtk.Orientation.VERTICAL}
        cssClasses={["notification-footer"]}
        visible={hasNotifications}
        hexpand={true}
        spacing={6}
      >
        <button
          cssClasses={["more-notifications-button"]}
          visible={moreNotificationsInfo((info) => info.hasMore)}
          hexpand={true}
          focusable={false}
          onClicked={() => {
            notificationManager.showMoreNotifications();
          }}
        >
          <label
            label={moreNotificationsInfo(
              (info) => `${info.moreCount} more notifications — Show more`,
            )}
            cssClasses={["more-text"]}
            halign={Gtk.Align.CENTER}
            hexpand={true}
          />
        </button>

        <box cssClasses={["notification-controls"]} hexpand={true} spacing={6}>
          <button
            halign={Gtk.Align.START}
            cssClasses={["clear-all-button"]}
            focusable={false}
            onClicked={() => {
              notificationManager.clearAllNotifications();
            }}
            tooltipText="Clear all notifications"
          >
            <box spacing={5} valign={Gtk.Align.CENTER}>
              <image iconName="edit-clear-all-symbolic" pixelSize={14} />
              <label label="Clear all" />
            </box>
          </button>

          <box hexpand={true} />

          <button
            cssClasses={["mark-read-button"]}
            halign={Gtk.Align.END}
            hexpand={false}
            focusable={false}
            visible={unreadCount((count) => count > 0)}
            onClicked={() => {
              notificationManager.markAllAsSeen();
            }}
            tooltipText="Mark all as read"
          >
            <box spacing={5} valign={Gtk.Align.CENTER}>
              <image iconName="object-select-symbolic" pixelSize={14} />
              <label label="Mark read" />
            </box>
          </button>
        </box>
      </box>
    </box>
  );
};
