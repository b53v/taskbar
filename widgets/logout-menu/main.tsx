import { execAsync } from "ags/process";
import app from "ags/gtk4/app";
import { Astal, Gdk, Gtk } from "ags/gtk4";
import { createState } from "ags";
import { gdkmonitor } from "utils/monitors.ts";
import options from "options.ts";

function hide() {
  app.get_window("logout-menu")?.hide();
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
        spacing={6}
      >
        <label cssClasses={["logout-icon"]} label={icon} />
        <label cssClasses={["logout-text"]} label={title} />
      </box>
    </button>
  );
}

export default function LogoutMenu() {
  const [visible, _setVisible] = createState(false);

  return (
    <window
      name="logout-menu"
      namespace="logout-menu"
      layer={Astal.Layer.OVERLAY}
      visible={visible}
      gdkmonitor={gdkmonitor}
      anchor={
        Astal.WindowAnchor.TOP |
        Astal.WindowAnchor.BOTTOM |
        Astal.WindowAnchor.LEFT |
        Astal.WindowAnchor.RIGHT
      }
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.ON_DEMAND}
      application={app}
    >
      <Gtk.EventControllerKey
        onKeyPressed={({ widget }, keyval: number) => {
          if (keyval === Gdk.KEY_Escape) {
            widget.hide();
            return true;
          }
          return false;
        }}
      />
      <box cssClasses={["logout-background"]} hexpand={true} vexpand={true}>
        <button hexpand={true} vexpand={true} onClicked={hide} />
        <box
          hexpand={false}
          vexpand={false}
          orientation={Gtk.Orientation.VERTICAL}
          valign={Gtk.Align.CENTER}
          halign={Gtk.Align.CENTER}
        >
          <button vexpand={true} onClicked={hide} />
          <box
            cssClasses={options["bar.ink"]((ink) => [
              "logout-menu",
              ink === "dynamic" ? "popup-glass-dynamic" : "popup-glass-auto",
            ])}
            orientation={Gtk.Orientation.VERTICAL}
          >
            <box>
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
            <box>
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
          <button vexpand={true} onClicked={hide} />
        </box>
        <button hexpand={true} vexpand={true} onClicked={hide} />
      </box>
    </window>
  );
}
