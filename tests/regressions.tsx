// Run through tests/run-regressions.py so config/cache writes are isolated.
import app from "ags/gtk4/app";
import { createRoot, onCleanup } from "ags";
import { Gtk } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";
import Gio from "gi://Gio?version=2.0";
import { readFileAsync } from "ags/file";
import { HardwareMonitor } from "utils/sysmon/base";
import SystemMonitor from "utils/sysmon";
import { notificationManager } from "utils/notifd/manager";
import { compositor } from "utils/compositor/detector";
import options from "options";
import ActiveWindow from "widgets/bar/modules/ActiveWindow";
import { HyprlandWorkspaces } from "widgets/bar/modules/Workspaces";
import { Clients } from "widgets/bar/modules/Clients";
import Progress from "widgets/osd/modules/Progress";
import { NotificationBox } from "widgets/system-menu/modules/notification-center/main";
import { getAppIcon } from "utils/clients";
import { CssReloader } from "utils/cssReload";
import { StyleProvider } from "utils/styleProvider";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function test() {
  assert(GLib.get_user_config_dir().startsWith("/tmp/opencode/ags-test-"), "isolated config required");
  let compiles = 0;
  let concurrent = 0;
  let maximumConcurrent = 0;
  const reloader = new CssReloader(async () => {
    compiles++;
    concurrent++;
    maximumConcurrent = Math.max(maximumConcurrent, concurrent);
    await sleep(30);
    concurrent--;
  }, 5);
  await Promise.all([reloader.request(), reloader.request(), reloader.request()]);
  assert(compiles === 1, "CSS burst was not debounced");
  const reload = reloader.request();
  await sleep(15);
  const duringCompile = reloader.request();
  await Promise.all([reload, duringCompile]);
  assert(maximumConcurrent === 1 && Number(compiles) === 3, "CSS compilation overlap or dropped request");
  let fails = true;
  const failingReloader = new CssReloader(async () => { if (fails) throw Error("expected Sass failure"); }, 5);
  const rejected = await Promise.allSettled([failingReloader.request(), failingReloader.request()]);
  assert(rejected.every((result) => result.status === "rejected"), "CSS errors did not reach all requesters");
  fails = false;
  await failingReloader.request();
  print("PASS: CSS debounce, serialization, queued requests, failure recovery");

  const styles = new StyleProvider();
  styles.apply(".contrast-regression { color: white; transition: color 400ms ease-in-out; }");
  styles.apply(".contrast-regression { color: white; transition: color 400ms ease-in-out; }");
  let invalidRejected = false;
  try { styles.apply(".contrast-regression { not-a-gtk-property: true; }"); }
  catch { invalidRejected = true; }
  assert(invalidRejected, "invalid CSS replaced the active provider");
  styles.apply(".contrast-regression { color: black; transition: color 400ms ease-in-out; }");
  styles.destroy();
  print("PASS: validated CSS provider replacement and invalid-style rejection");

  const monitor = new HardwareMonitor();
  let calls = 0;
  let finish!: () => void;
  monitor.update = async () => { calls++; await new Promise<void>((resolve) => { finish = resolve; }); };
  const first = monitor.refresh();
  await monitor.refresh();
  assert(calls === 1, "overlapping hardware refresh was not skipped");
  finish();
  await first;
  monitor.destroy();
  await monitor.refresh();
  assert(calls === 1, "destroyed monitor refreshed");
  print("PASS: hardware refresh serialization/destruction");

  const sysmon = SystemMonitor.get_default() as any;
  assert(sysmon.cpu.intervalId === null && sysmon.disk.intervalId === null, "monitors started without consumers");
  const release = sysmon.retainCore();
  while (sysmon.coreStarting) await sleep(20);
  assert(sysmon.cpu.intervalId !== null, "core lease did not start CPU");
  assert(sysmon.disk.intervalId === null && sysmon.network.intervalId === null, "core lease started unused detail monitors");
  release();
  assert(sysmon.cpu.intervalId === null && sysmon.gpu.intervalId === null && sysmon.thresholdTimer === null, "core release left timers running");
  const releaseDetails = sysmon.retainDetails();
  while (sysmon.detailsStarting || sysmon.coreStarting) await sleep(20);
  assert(sysmon.disk.intervalId !== null && sysmon.network.intervalId !== null, "detail lease did not start timers");
  assert(sysmon.disk.disks.length > 0, "asynchronous disk query returned no disks");
  releaseDetails();
  assert(sysmon.disk.intervalId === null && sysmon.network.redetectionIntervalId === null, "detail release left timers running");
  print("PASS: monitor leases, asynchronous filesystem query, timer cleanup");

  const manager = notificationManager as any;
  manager.clearAllNotifications();
  options["notification-center.history-limit"].value = 6;
  options["notification-center.history-days"].value = 30;
  for (let i = 0; i < 10; i++) {
    manager.storeNotification({ id: i + 1, appName: "Regression", summary: `Test ${i}`, time: Date.now() / 1000 + i, actions: [] });
  }
  manager.storeNotification({ id: 99, appName: "Regression", summary: "Expired", time: Date.now() / 1000 - 31 * 86400, actions: [] });
  assert(manager.activeNotifications.get().length === 6, "history limit/expiry failed");
  assert(!manager.activeNotifications.get().some((n: any) => n.id === 99), "expired notification retained");
  assert(manager.limitedActiveNotifications.get().length === 4, "visible limit changed");
  manager.showMoreNotifications();
  assert(manager.limitedActiveNotifications.get().length === 6, "show more failed");
  manager.markAllAsSeen();
  assert(manager.unreadCount.get() === 0, "mark all left unread history");
  manager.resetVisibleNotifications();
  assert(manager.limitedActiveNotifications.get().length === 4, "visible limit reset failed");
  await sleep(700);
  const persisted = JSON.parse(await readFileAsync(`${GLib.get_user_cache_dir()}/ags/notifications.json`));
  assert(persisted.length === 6 && persisted.every((entry: any) => entry[1].seen), "asynchronous persistence did not write final state");
  print("PASS: bounded notification history, expiry, show more, batch read, persistence");

  let dispose!: () => void;
  createRoot((cleanup) => {
    dispose = cleanup;
    const active = <ActiveWindow /> as Gtk.Widget;
    assert(active.visible === !!compositor.focusedClient.get()?.title, "active window visibility differs from focused client");
    const clients = <Clients /> as Gtk.Widget;
    const dots = <HyprlandWorkspaces /> as Gtk.Widget;
    const osd = <Progress visible={false} setVisible={() => {}} /> as Gtk.Widget;
    const notifications = <NotificationBox /> as Gtk.Widget;
    assert(clients && dots && osd && notifications, "widget construction failed");
    const adapter = compositor as any;
    let titles = 0;
    let workspaces = 0;
    const titleUnsub = compositor.focusedClient.subscribe(() => { compositor.focusedClient.get(); titles++; });
    const workspaceUnsub = compositor.workspaces.subscribe(() => { compositor.workspaces.get(); workspaces++; });
    onCleanup(titleUnsub);
    onCleanup(workspaceUnsub);
    const client = adapter.hyprland.get_focused_client();
    if (client) {
      client.notify("title");
      assert(titles > 0, "nested title notification did not propagate");
    }
    const ws = adapter.hyprland.get_workspaces()[0];
    if (ws) {
      ws.notify("clients");
      assert(workspaces > 0, "nested workspace clients notification did not propagate");
    }
  });
  dispose();
  Gio.icon_new_for_string(getAppIcon("application-x-executable-symbolic", true));
  assert(!getAppIcon("application-x-executable-symbolic", true).endsWith("-symbolic-symbolic"), "duplicated symbolic suffix");
  print("PASS: widget construction, active title/workspace reactivity, icon fallback");
  sysmon.destroy();
  void app;
}

await test();
print("All regression checks passed");
