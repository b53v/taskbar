import {
  createState,
  createComputed,
  onCleanup,
  Accessor,
  createRoot,
} from "ags";
import Notifd from "gi://AstalNotifd";
import GLib from "gi://GLib?version=2.0";
import { writeFileAsync } from "ags/file";
import type { StoredNotification } from "./types.ts";
import { liveToStored } from "./adapters.ts";
import options from "options.ts";

export class NotificationManager {
  private notifications = new Map<number, StoredNotification>();
  private notificationState: Accessor<StoredNotification[]>;
  private setNotificationState: ReturnType<
    typeof createState<StoredNotification[]>
  >[1];
  private notifd = Notifd.get_default();
  private maxVisibleNotifications =
    options["notification-center.max-notifications"].get();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private writing = false;
  private persistDirty = false;
  private expiryTimer: ReturnType<typeof setInterval>;

  constructor() {
    const [notificationState, setNotificationState] = createState<
      StoredNotification[]
    >([]);
    this.notificationState = notificationState;
    this.setNotificationState = setNotificationState;
    const visibleLimit = this.maxVisibleNotifications;
    this.maxVisibleNotifications = Number.isFinite(visibleLimit) ? Math.max(1, Math.floor(visibleLimit)) : 4;

    this.loadPersistedNotifications();
    this.setupNotificationListeners();
    for (const key of ["notification-center.history-limit", "notification-center.history-days"] as const) {
      onCleanup(options[key].subscribe(() => {
        this.updateState();
        this.persistNotifications();
      }));
    }
    onCleanup(options["notification-center.max-notifications"].subscribe(() => {
      this.setMaxVisibleNotifications(options["notification-center.max-notifications"].get());
    }));
    this.expiryTimer = setInterval(() => {
      this.updateState();
      this.persistNotifications();
    }, 60 * 60 * 1000);
    onCleanup(() => {
      clearInterval(this.expiryTimer);
      if (this.persistTimer) clearTimeout(this.persistTimer);
      void this.flushNotifications();
    });
  }

  dismissNotification(id: number): void {
    const notification = this.notifications.get(id);
    if (notification) {
      this.notifications.delete(id);
      this.updateState();
      this.persistNotifications();
    }
  }

  markAsSeen(id: number): void {
    this.markManyAsSeen([id]);
  }

  markManyAsSeen(ids: number[]): void {
    let changed = false;
    for (const id of ids) {
      const notification = this.notifications.get(id);
      if (notification && !notification.seen) {
        this.notifications.set(id, { ...notification, seen: true });
        changed = true;
      }
    }
    if (changed) {
      this.updateState();
      this.persistNotifications();
    }
  }

  markAllAsSeen(): void {
    this.markManyAsSeen([...this.notifications.keys()]);
  }

  setMaxVisibleNotifications(limit: number) {
    this.maxVisibleNotifications = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 4;
    this.updateState();
  }

  showMoreNotifications(): void {
    const step = options["notification-center.max-notifications"].get();
    this.setMaxVisibleNotifications(this.maxVisibleNotifications + (Number.isFinite(step) ? Math.max(1, step) : 4));
  }

  resetVisibleNotifications(): void {
    this.setMaxVisibleNotifications(options["notification-center.max-notifications"].get());
  }

  clearVisibleNotifications() {
    const visibleNotifications = this.limitedActiveNotifications.get();
    visibleNotifications.forEach((notification) => {
      this.notifications.delete(notification.id);
    });
    this.updateState();
    this.persistNotifications();
  }

  clearAllNotifications() {
    this.notifications.clear();
    this.updateState();
    this.persistNotifications();
  }

  get activeNotifications() {
    return this.notificationState;
  }

  get limitedActiveNotifications() {
    return this.activeNotifications((notifications) =>
      notifications.slice(0, this.maxVisibleNotifications),
    );
  }

  get newNotifications() {
    return this.limitedActiveNotifications((notifications) =>
      notifications.filter((n) => !n.seen),
    );
  }

  get readNotifications() {
    return this.limitedActiveNotifications((notifications) =>
      notifications.filter((n) => n.seen),
    );
  }

  get unreadCount() {
    return this.activeNotifications(
      (notifications) => notifications.filter((n) => !n.seen).length,
    );
  }

  get hasNotifications() {
    return this.limitedActiveNotifications(
      (notifications) => notifications.length > 0,
    );
  }

  get hasNewNotifications() {
    return this.newNotifications((notifications) => notifications.length > 0);
  }

  get hasReadNotifications() {
    return this.readNotifications((notifications) => notifications.length > 0);
  }

  get moreNotificationsInfo() {
    return createComputed(
      [this.notificationState, this.limitedActiveNotifications],
      (allActive, limited) => {
        const totalCount = allActive.length;
        const shownCount = limited.length;
        return {
          hasMore: totalCount > shownCount,
          moreCount: totalCount - shownCount,
        };
      },
    );
  }

  private setupNotificationListeners(): void {
    const addedId = this.notifd.connect("notified", (_, notificationId) => {
      console.log("Received notification ID:", notificationId);

      const notification = this.notifd.get_notification(notificationId);
      if (notification) {
        this.storeNotification(notification);
      } else {
        console.error(
          "Could not retrieve notification with ID:",
          notificationId,
        );
      }
    });

    onCleanup(() => {
      this.notifd.disconnect(addedId);
    });
  }

  private updateState(): void {
    const limit = options["notification-center.history-limit"].get();
    const days = options["notification-center.history-days"].get();
    const cutoff = Date.now() - (Number.isFinite(days) ? Math.max(1, days) : 30) * 86400_000;
    const sortedNotifications = Array.from(this.notifications.values()).sort(
      (a, b) => b.time - a.time,
    ).filter((notification) => notification.time >= cutoff)
      .slice(0, Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 200);
    this.notifications = new Map(sortedNotifications.map((notification) => [notification.id, notification]));
    this.setNotificationState(sortedNotifications);
  }

  private persistNotifications(): void {
    this.persistDirty = true;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flushNotifications();
    }, 300);
  }

  private async flushNotifications(): Promise<void> {
    if (this.writing) return;
    this.writing = true;
    try {
      const cacheDir = `${GLib.get_user_cache_dir()}/ags`;
      while (this.persistDirty) {
        this.persistDirty = false;
        const data = JSON.stringify(Array.from(this.notifications.entries()));
        await writeFileAsync(`${cacheDir}/notifications.json`, data);
      }
    } catch (error) {
      console.error("Failed to persist notifications:", error);
    } finally {
      this.writing = false;
    }
  }

  private loadPersistedNotifications(): void {
    try {
      const cacheFile = `${GLib.get_user_cache_dir()}/ags/notifications.json`;

      if (GLib.file_test(cacheFile, GLib.FileTest.EXISTS)) {
        const [success, contents] = GLib.file_get_contents(cacheFile);
        if (success) {
          const data = JSON.parse(new TextDecoder().decode(contents));
          this.notifications = new Map(data);
          this.updateState();
          this.persistNotifications();
        }
      }
    } catch (error) {
      console.error("Failed to load persisted notifications:", error);
    }
  }

  private storeNotification(notification: Notifd.Notification): void {
    const stored = liveToStored(notification);
    this.notifications.set(notification.id, stored);
    this.updateState();
    this.persistNotifications();
  }
}

export const notificationManager = createRoot(() => {
  const manager = new NotificationManager();
  return manager;
});
