import app from "ags/gtk4/app";
import { For, createBinding, createComputed } from "ags";
import { Astal, Gdk, Gtk } from "ags/gtk4";
import { SysTray, hasTrayItems } from "./modules/SysTray.tsx";
import Separator from "./modules/Separator.tsx";
import { HyprlandWorkspaces } from "./modules/Workspaces.tsx";
import Volume from "./modules/Volume.tsx";
import NotificationButton from "./modules/NotificationButton.tsx";
import Hardware from "./modules/Hardware.tsx";
import SystemInfo from "./modules/SystemInfo/main.tsx";
import Time from "./modules/Time.tsx";
import OsIcon from "./modules/OsIcon.tsx";
import options from "options.ts";

function Bar({ gdkmonitor, ...props }: any) {
  const { TOP, LEFT, RIGHT, BOTTOM } = Astal.WindowAnchor;

  const marginTop = createComputed(
    [options["bar.style"], options["bar.position"]],
    (style, position) => {
      if (style === "corners") return 0;
      return position === "top" ? 6 : 0;
    },
  );

  const marginBottom = createComputed(
    [options["bar.style"], options["bar.position"]],
    (style, position) => {
      if (style === "corners") return 0;
      return position === "bottom" ? 6 : 0;
    },
  );

  const horizontalMargin = createComputed([options["bar.style"]], (style) =>
    style === "corners" ? 0 : 6,
  );

  return (
    <window
      visible
      name="bar"
      namespace="bar"
      cssClasses={createComputed(
        [options["bar.style"], options["bar.ink"]],
        (style, ink) => [
          "Bar",
          `bar-style-${style ?? "expanded"}`,
          `bar-ink-${ink ?? "auto"}`,
        ],
      )}
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      application={app}
      anchor={options["bar.position"]((pos) => {
        switch (pos) {
          case "top":
            return TOP | LEFT | RIGHT;
          case "bottom":
            return BOTTOM | LEFT | RIGHT;
          default:
            return TOP | LEFT | RIGHT;
        }
      })}
      marginTop={marginTop}
      marginLeft={horizontalMargin}
      marginRight={horizontalMargin}
      marginBottom={marginBottom}
      {...props}
    >
      <overlay>
        <centerbox hexpand cssClasses={["centerbox"]}>
          {/* Left: App Context & Hardware Telemetry */}
          <box halign={Gtk.Align.START} valign={Gtk.Align.CENTER} $type="start" spacing={4}>
            <box valign={Gtk.Align.CENTER} visible={options["bar.modules.os-icon.enable"]}>
              <OsIcon />
            </box>
            {/* Keep the original compact layout: no additional title/icon strip. */}
            <Separator />
            <Hardware />
          </box>

          {/* Center: Standalone Workspace Pill Island (Zero jitter, pure fluid sliding) */}
          <box $type="center" halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
            <HyprlandWorkspaces />
          </box>

          {/* Right: Apps Tray, Quick Controls & Time */}
          <box halign={Gtk.Align.END} valign={Gtk.Align.CENTER} $type="end" spacing={2}>
            <SysTray />
            <Separator visible={hasTrayItems} />
            <Volume />
            <NotificationButton />
            <SystemInfo />
            <Separator />
            <Time />
          </box>
        </centerbox>
      </overlay>
    </window>
  );
}

function MonitorSetup({ monitor }: { monitor: Gdk.Monitor }) {
  return <Bar gdkmonitor={monitor} />;
}

export default function () {
  const monitors = createBinding(app, "monitors");
  return (
    <For each={monitors} cleanup={(win) => (win as Gtk.Window).destroy()}>
      {(monitor) => <MonitorSetup monitor={monitor} />}
    </For>
  );
}
