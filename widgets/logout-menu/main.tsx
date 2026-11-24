import { execAsync } from "ags/process";
import app from "ags/gtk4/app";
import { Astal, Gdk, Gtk } from "ags/gtk4";
import { onCleanup } from "ags";
import { gdkmonitor } from "utils/monitors.ts";
import options from "options.ts";

function hide() {
  app.get_window("logout-menu")?.hide();
  app.get_window("logout-backdrop")?.hide();
}

function LogoutButton(icon: string, title: string, command: string) {
  return (
    <button
      cssClasses={["logout-btn"]}
      onClicked={() => {
        hide();
        execAsync(["sh", "-c", command]);
      }}
    >
      <box
        orientation={Gtk.Orientation.VERTICAL}
        valign={Gtk.Align.CENTER}
        halign={Gtk.Align.CENTER}
        spacing={3}
      >
        <label cssClasses={["logout-icon"]} label={icon} />
        <label cssClasses={["logout-text"]} label={title} />
      </box>
    </button>
  );
}

export default function LogoutMenu() {
  const { TOP, BOTTOM, LEFT, RIGHT, NONE } = Astal.WindowAnchor;

  // Lightweight fullscreen unblurred scrim underneath the centered glass dock.
  // Because Hyprland WindowRules only match ^logout-menu$, this stays unblurred
  // with zero shader cost while catching click-outside dismissals.
  const backdrop = (
    <window
      name="logout-backdrop"
      namespace="logout-backdrop"
      layer={Astal.Layer.OVERLAY}
      visible={false}
      gdkmonitor={gdkmonitor}
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.NONE}
      application={app}
    >
      <box
        cssClasses={["logout-backdrop"]}
        hexpand={true}
        vexpand={true}
        $={(self) => {
          const click = new Gtk.GestureClick();
          click.set_button(0);
          click.connect("pressed", () => hide());
          self.add_controller(click);
        }}
      />
    </window>
  ) as Astal.Window;

  const menu = (
    <window
      name="logout-menu"
      namespace="logout-menu"
      layer={Astal.Layer.OVERLAY}
      visible={false}
      gdkmonitor={gdkmonitor}
      anchor={NONE}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.ON_DEMAND}
      $={(self) => {
        self.set_default_size(1, 1);
      }}
      application={app}
    >
      <Gtk.EventControllerKey
        propagationPhase={Gtk.PropagationPhase.CAPTURE}
        onKeyPressed={(_controller, keyval: number) => {
          if (keyval === Gdk.KEY_Escape) {
            hide();
            return true;
          }
          return false;
        }}
      />
      <box
        cssClasses={options["bar.ink"]((ink) => [
          "logout-menu",
          ink === "dynamic" ? "popup-glass-dynamic" : "popup-glass-auto",
        ])}
        orientation={Gtk.Orientation.VERTICAL}
        homogeneous={true}
      >
        <box homogeneous={true}>
          {LogoutButton("lock", "Lock", "hyprlock")}
          {LogoutButton(
            "bedtime",
            "Suspend",
            "systemctl suspend || loginctl suspend",
          )}
          {LogoutButton(
            "logout",
            "Logout",
            "pkill Hyprland || loginctl terminate-user $USER",
          )}
        </box>
        <box homogeneous={true}>
          {LogoutButton(
            "power_settings_new",
            "Shutdown",
            "systemctl poweroff || loginctl poweroff",
          )}
          {LogoutButton(
            "mode_standby",
            "Hibernate",
            "systemctl hibernate || loginctl hibernate",
          )}
          {LogoutButton(
            "restart_alt",
            "Reboot",
            "systemctl reboot || loginctl reboot",
          )}
        </box>
      </box>
    </window>
  ) as Astal.Window;

  let syncing = false;
  const menuVisibleId = menu.connect("notify::visible", () => {
    if (syncing) return;
    syncing = true;
    try {
      if (menu.visible) {
        if (!backdrop.visible) {
          // Ensure logout-backdrop maps before logout-menu on OVERLAY so
          // Hyprland always stacks the dock above the click-outside scrim.
          menu.set_visible(false);
          backdrop.set_visible(true);
          menu.set_visible(true);
        }
      } else if (backdrop.visible) {
        backdrop.set_visible(false);
      }
    } finally {
      syncing = false;
    }
  });

  const backdropVisibleId = backdrop.connect("notify::visible", () => {
    if (syncing) return;
    syncing = true;
    try {
      if (!backdrop.visible && menu.visible) {
        menu.set_visible(false);
      }
    } finally {
      syncing = false;
    }
  });

  onCleanup(() => {
    menu.disconnect(menuVisibleId);
    backdrop.disconnect(backdropVisibleId);
    backdrop.destroy();
  });

  return menu;
}
