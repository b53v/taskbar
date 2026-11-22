// Run through tests/run-regressions.py so config/cache writes are isolated.
import app from "ags/gtk4/app";
import { createRoot, onCleanup } from "ags";
import { Gtk } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";
import { readFileAsync } from "ags/file";
import { HardwareMonitor } from "utils/sysmon/base";
import SystemMonitor from "utils/sysmon";
import { notificationManager } from "utils/notifd/manager";
import { compositor } from "utils/compositor/detector";
import options from "options";
import {
  HyprlandWorkspaces,
  PILL_DOT_WIDTH,
  PILL_FOCUSED_WIDTH,
  computeWorkspaceState,
  stepCriticallyDampedSpring,
  workspaceContentWidth,
} from "widgets/bar/modules/Workspaces";
import Progress from "widgets/osd/modules/Progress";
import { SysTray } from "widgets/bar/modules/SysTray";
import { NotificationBox } from "widgets/system-menu/modules/notification-center/main";
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
  assert(sysmon.cpu.intervalId === null && sysmon.memory.intervalId === null && sysmon.gpu.intervalId === null, "monitors started without consumers");
  const release = sysmon.retainCore();
  while (sysmon.coreStarting) await sleep(20);
  assert(sysmon.cpu.intervalId !== null && sysmon.memory.intervalId !== null, "core lease did not start CPU/memory");
  release();
  assert(sysmon.cpu.intervalId === null && sysmon.memory.intervalId === null && sysmon.gpu.intervalId === null && sysmon.thresholdTimer === null, "core release left timers running");
  print("PASS: monitor leases and timer cleanup");

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
    const dots = <HyprlandWorkspaces /> as Gtk.Widget;
    const osd = <Progress visible={false} setVisible={() => {}} /> as Gtk.Widget;
    const notifications = <NotificationBox /> as Gtk.Widget;
    const systray = <SysTray /> as Gtk.Box;
    assert(dots && osd && notifications && systray, "widget construction failed");
    const revealer = systray.get_first_child() as Gtk.Revealer;
    const toggle = revealer?.get_next_sibling() as Gtk.Button;
    const toggleIcon = toggle?.get_child() as Gtk.Image;
    assert(
      revealer instanceof Gtk.Revealer &&
        !revealer.get_reveal_child() &&
        revealer.get_transition_type() === Gtk.RevealerTransitionType.SLIDE_LEFT &&
        revealer.get_transition_duration() === 180,
      "SysTray revealer defaults failed",
    );
    assert(
      toggle instanceof Gtk.Button &&
        toggle.has_css_class("tray-toggle") &&
        !toggle.has_css_class("expanded") &&
        toggleIcon?.get_icon_name() === "pan-start-symbolic",
      "SysTray toggle initial state failed",
    );
    toggle.emit("clicked");
    assert(
      revealer.get_reveal_child() &&
        toggle.has_css_class("expanded") &&
        toggleIcon?.get_icon_name() === "pan-end-symbolic",
      "SysTray failed to expand on toggle click",
    );
    toggle.emit("clicked");
    assert(
      !revealer.get_reveal_child() &&
        !toggle.has_css_class("expanded") &&
        toggleIcon?.get_icon_name() === "pan-start-symbolic",
      "SysTray failed to collapse on second toggle click",
    );
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
  print("PASS: widget construction, active title/workspace reactivity");

  const wsSingleOccupied = computeWorkspaceState([{ id: 1, occupied: true }], { id: 1 });
  assert(
    wsSingleOccupied.maxVisible === 1 &&
      wsSingleOccupied.states[0] === "focused" &&
      wsSingleOccupied.states.slice(1).every((s) => s === "hidden"),
    "min-1 rule failed when only workspace 1 is occupied and focused",
  );
  const wsAllEmpty = computeWorkspaceState([], { id: 1 });
  assert(
    wsAllEmpty.maxVisible === 1 &&
      wsAllEmpty.states[0] === "focused" &&
      wsAllEmpty.states.slice(1).every((s) => s === "hidden"),
    "min-1 rule failed when all workspaces are empty",
  );
  const wsFocusEmpty2 = computeWorkspaceState([{ id: 1, occupied: true }], { id: 2 });
  assert(
    wsFocusEmpty2.maxVisible === 2 &&
      wsFocusEmpty2.states[0] === "occupied" &&
      wsFocusEmpty2.states[1] === "focused" &&
      wsFocusEmpty2.states.slice(2).every((s) => s === "hidden"),
    "workspace 2 did not appear when focused while empty",
  );
  const wsCollapseBack = computeWorkspaceState(
    [{ id: 1, occupied: true }, { id: 2, occupied: false }],
    { id: 1 },
  );
  assert(
    wsCollapseBack.maxVisible === 1 &&
      wsCollapseBack.states[0] === "focused" &&
      wsCollapseBack.states[1] === "hidden",
    "empty workspace 2 did not collapse back to min-1",
  );
  const wsSequential4 = computeWorkspaceState(
    [{ id: 1, occupied: false }, { id: 4, occupied: true }],
    { id: 1 },
  );
  assert(
    wsSequential4.maxVisible === 4 &&
      wsSequential4.states.slice(0, 4).join(",") === "focused,empty,empty,occupied" &&
      wsSequential4.states.slice(4).every((s) => s === "hidden"),
    "sequential intermediate slots failed for occupied workspace 4",
  );
  const wsSpecial = computeWorkspaceState([{ id: 1, occupied: true }], { id: -98 });
  assert(
    wsSpecial.maxVisible === 1 && wsSpecial.states[0] === "occupied",
    "special workspace id broke min-1 rule",
  );
  for (let n = 1; n <= 10; n++) {
    const w = workspaceContentWidth(n);
    assert(w % 2 === 0 && w >= 13 + 15 * n && w <= 14 + 15 * n, `unexpected even content width for ${n}: ${w}`);
  }

  const shrink = { value: PILL_FOCUSED_WIDTH, velocity: 0 };
  const grow = { value: PILL_DOT_WIDTH, velocity: 0 };
  let active = true;
  let steps = 0;
  while (active && steps < 240) {
    const a = stepCriticallyDampedSpring(shrink, PILL_DOT_WIDTH, 32, 1 / 240, 0.01, 0.05);
    const b = stepCriticallyDampedSpring(grow, PILL_FOCUSED_WIDTH, 32, 1 / 240, 0.01, 0.05);
    assert(
      Math.abs(shrink.value + grow.value - (PILL_FOCUSED_WIDTH + PILL_DOT_WIDTH)) < 1e-9,
      "total width was not conserved during focus switch spring",
    );
    assert(
      shrink.value >= PILL_DOT_WIDTH - 1e-9 && grow.value <= PILL_FOCUSED_WIDTH + 1e-9,
      "critically-damped spring overshot target",
    );
    active = a || b;
    steps++;
  }
  assert(
    !active &&
      shrink.value === PILL_DOT_WIDTH &&
      shrink.velocity === 0 &&
      grow.value === PILL_FOCUSED_WIDTH &&
      grow.velocity === 0,
    "focus switch spring did not settle cleanly",
  );
  print("PASS: min-1 workspace state, even-width centering, critically-damped spring conservation/settle");
  sysmon.destroy();
  void app;
}

await test();
print("All regression checks passed");
