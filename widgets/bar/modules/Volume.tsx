// widgets/bar/modules/Volume.tsx
import { Gtk } from "ags/gtk4";
import { createBinding } from "ags";
import { execAsync } from "ags/process";
import Wp from "gi://AstalWp";
import GLib from "gi://GLib?version=2.0";
import options from "options";

export default function Volume() {
  const wp = Wp.get_default();
  const speaker = wp?.audio?.defaultSpeaker;

  if (!speaker) {
    return <box visible={false} />;
  }

  const volumeIcon = createBinding(speaker, "volumeIcon");
  const volumePercent = createBinding(speaker, "volume")((v) => `${Math.round(v * 100)}%`);

  return (
    <button
      cssClasses={["bar-volume"]}
      valign={Gtk.Align.CENTER}
      tooltipText="Volume (Scroll to adjust, Click to mute)"
      onClicked={() => {
        speaker.mute = !speaker.mute;
      }}
      $={(self) => {
        const scroll = Gtk.EventControllerScroll.new(
          Gtk.EventControllerScrollFlags.VERTICAL,
        );
        scroll.connect("scroll", (_c, _dx, dy) => {
          if (dy < 0) {
            speaker.volume = Math.min(1.0, speaker.volume + 0.05);
          } else if (dy > 0) {
            speaker.volume = Math.max(0.0, speaker.volume - 0.05);
          }
        });
        self.add_controller(scroll);

        // Middle click toggles the configured mixer, not a hard-coded app.
        const gesture = new Gtk.GestureClick();
        gesture.set_button(2); // Middle click
        gesture.connect("pressed", () => {
          const command = options["app.audio"].get();
          try {
            const [, argv] = GLib.shell_parse_argv(command);
            if (!argv?.[0]) return;
            void execAsync(["pkill", "-x", GLib.path_get_basename(argv[0])])
              .catch(() => execAsync(command))
              .catch(console.error);
          } catch (error) {
            console.error("Invalid audio application command:", error);
          }
        });
        self.add_controller(gesture);
      }}
    >
      <box spacing={4} valign={Gtk.Align.CENTER}>
        <image valign={Gtk.Align.CENTER} iconName={volumeIcon} />
        <label valign={Gtk.Align.CENTER} label={volumePercent} />
      </box>
    </button>
  );
}
