import { Gtk } from "ags/gtk4";
import app from "ags/gtk4/app";
import { execAsync } from "ags/process";
import options from "options";

export default function OsIcon() {
  return (
    <button
      valign={Gtk.Align.CENTER}
      halign={Gtk.Align.CENTER}
      cssClasses={["os-button"]}
      tooltipText="App Launcher"
      onClicked={() => {
        execAsync([
          "bash",
          "-c",
          "pkill -x rofi || rofi -show drun -modi drun,filebrowser,run,window",
        ]).catch(console.error);
      }}
    >
      <image
        valign={Gtk.Align.CENTER}
        halign={Gtk.Align.CENTER}
        iconName={options["bar.modules.os-icon.type"]}
        cssClasses={["OsIcon"]}
      />
    </button>
  );
}
