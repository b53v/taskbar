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
  private maxVisibleState: Accessor<number>;
  private setMaxVisibleState: ReturnType<typeof createState<number>>[1];
  private notifd = Notifd.get_default();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private writing = false;
  private persistDirty = false;
  private expiryTimer: ReturnType<typeof setInterval>;

  readonly activeNotifications: Accessor<StoredNotification[]>;
  readonly limitedActiveNotifications: Accessor<StoredNotification[]>;
  readonly newNotifications: Accessor<StoredNotification[]>;
  readonly readNotifications: Accessor<StoredNotification[]>;
  readonly unreadCount: Accessor<number>;
  readonly hasNotifications: Accessor<boolean>;
  readonly hasNewNotifications: Accessor<boolean>;
  readonly hasReadNotifications: Accessor<boolean>;
  readonly moreNotificationsInfo: Accessor<{
    hasMore: boolean;
    moreCount: number;
  }>;

  constructor() {
    const [notificationState, setNotificationState] = createState<
      StoredNotification[]
    >([]);
    this.notificationState = notificationState;
    this.setNotificationState = setNotificationState;

    const initialLimit = this.normalizeVisibleLimit(
      options["notification-center.max-notifications"].get(),
    );
    const [maxVisibleState, setMaxVisibleState] =
      createState<number>(initialLimit);
    this.maxVisibleState = maxVisibleState;
    this.setMaxVisibleState = setMaxVisibleState;

    this.activeNotifications = this.notificationState;
    this.limitedActiveNotifications = createComputed(() =>
      this.notificationState().slice(0, this.maxVisibleState()),
    );
    this.newNotifications = this.limitedActiveNotifications((notifications) =>
      notifications.filter((n) => !n.seen),
    );
    this.readNotifications = this.limitedActiveNotifications((notifications) =>
      notifications.filter((n) => n.seen),
    );
    this.unreadCount = this.activeNotifications((notifications) => {
      let count = 0;
      for (const n of notifications) {
        if (!n.seen) count++;
      }
      return count;
    });
    this.hasNotifications = this.activeNotifications(
      (notifications) => notifications.length > 0,
    );
    this.hasNewNotifications = this.newNotifications(
      (notifications) => notifications.length > 0,
    );
    this.hasReadNotifications = this.readNotifications(
      (notifications) => notifications.length > 0,
    );
    this.moreNotificationsInfo = createComputed(() => {
      const totalCount = this.activeNotifications().length;
      const shownCount = this.limitedActiveNotifications().length;
      return {
        hasMore: totalCount > shownCount,
        moreCount: Math.max(0, totalCount - shownCount),
      };
    });

    this.loadPersistedNotifications();
    this.setupNotificationListeners();
    for (const key of [
      "notification-center.history-limit",
      "notification-center.history-days",
    ] as const) {
      onCleanup(
        options[key].subscribe(() => {
          if (this.updateState()) {
            this.persistNotifications();
          }
        }),
      );
    }
    onCleanup(
      options["notification-center.max-notifications"].subscribe(() => {
        this.setMaxVisibleNotifications(
          options["notification-center.max-notifications"].get(),
        );
      }),
    );
    this.expiryTimer = setInterval(
      () => {
        if (this.needsPruning() && this.updateState()) {
          this.persistNotifications();
        }
      },
      60 * 60 * 1000,
    );
    onCleanup(() => {
      clearInterval(this.expiryTimer);
      if (this.persistTimer) clearTimeout(this.persistTimer);
      void this.flushNotifications();
    });
  }

  private normalizeVisibleLimit(limit: number): number {
    return Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 4;
  }

  private getHistoryLimit(): number {
    const limit = options["notification-center.history-limit"].get();
    return Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 200;
  }

  private getExpiryCutoff(): number {
    const days = options["notification-center.history-days"].get();
    return Date.now() - (Number.isFinite(days) ? Math.max(1, days) : 30) * 86400_000;
  }

  private needsPruning(): boolean {
    const limit = this.getHistoryLimit();
    if (this.notifications.size > limit) return true;
    const cutoff = this.getExpiryCutoff();
    for (const notification of this.notifications.values()) {
      if (notification.time < cutoff) return true;
    }
    return false;
  }

  dismissNotification(id: number): void {
    if (this.notifications.delete(id)) {
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
    const normalized = this.normalizeVisibleLimit(limit);
    if (this.maxVisibleState.get() !== normalized) {
      this.setMaxVisibleState(normalized);
    }
  }

  showMoreNotifications(): void {
    const step = this.normalizeVisibleLimit(
      options["notification-center.max-notifications"].get(),
    );
    this.setMaxVisibleNotifications(this.maxVisibleState.get() + step);
  }

  resetVisibleNotifications(): void {
    this.setMaxVisibleNotifications(
      options["notification-center.max-notifications"].get(),
    );
  }

  clearVisibleNotifications() {
    const visibleNotifications = this.limitedActiveNotifications.get();
    let changed = false;
    for (const notification of visibleNotifications) {
      if (this.notifications.delete(notification.id)) {
        changed = true;
      }
    }
    if (changed) {
      this.updateState();
      this.persistNotifications();
    }
  }

  clearAllNotifications() {
    if (this.notifications.size === 0) return;
    this.notifications.clear();
    this.updateState();
    this.persistNotifications();
  }

  private setupNotificationListeners(): void {
    const addedId = this.notifd.connect("notified", (_, notificationId) => {
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

  private updateState(): boolean {
    const limit = this.getHistoryLimit();
    const cutoff = this.getExpiryCutoff();
    const prevSize = this.notifications.size;
    const sortedNotifications = Array.from(this.notifications.values())
      .filter((notification) => notification.time >= cutoff)
      .sort((a, b) => b.time - a.time)
      .slice(0, limit);
    const pruned = sortedNotifications.length !== prevSize;
    if (pruned) {
      this.notifications = new Map(
        sortedNotifications.map((notification) => [notification.id, notification]),
      );
    }
    this.setNotificationState(sortedNotifications);
    return pruned;
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
          if (this.updateState()) {
            this.persistNotifications();
          }
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
