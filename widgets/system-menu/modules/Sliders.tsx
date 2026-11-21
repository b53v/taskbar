import { Gtk } from "ags/gtk4";
import { execAsync } from "ags/process";
import { createBinding } from "ags";
import Wp from "gi://AstalWp";
import Brightness from "utils/brightness.ts";
import options from "options";

export const Sliders = () => {
  const wp = Wp.get_default();
  const speaker = wp?.audio?.defaultSpeaker ?? null;
  const microphone = wp?.get_default_microphone() ?? null;
  const brightness = Brightness.get_default();

  return (
    <box
      cssClasses={["sliders"]}
      orientation={Gtk.Orientation.VERTICAL}
      spacing={4}
    >
      {speaker && (
        <box cssClasses={["volume"]}>
          <button onClicked={() => execAsync(options["app.audio"].get())}>
            <image iconName={createBinding(speaker, "volumeIcon")} />
          </button>
          <slider
            onChangeValue={(self) => {
              speaker.volume = self.value;
            }}
            value={createBinding(speaker, "volume")}
            valign={Gtk.Align.CENTER}
            hexpand={true}
          />
        </box>
      )}
      {microphone && (
        <box
          cssClasses={["volume"]}
          visible={createBinding(microphone, "path")((mic) => mic !== null)}
        >
          <button onClicked={() => execAsync(options["app.audio"].get())}>
            <image iconName={createBinding(microphone, "volumeIcon")} />
          </button>
          <slider
            onChangeValue={(self) => {
              microphone.volume = self.value;
            }}
            value={createBinding(microphone, "volume")}
            valign={Gtk.Align.CENTER}
            hexpand={true}
          />
        </box>
      )}
      <box cssClasses={["brightness"]} visible={brightness.hasBacklight}>
        <image iconName="display-brightness-symbolic" />
        <slider
          value={createBinding(brightness, "screen")}
          onChangeValue={(self) => {
            brightness.screen = self.value;
          }}
          min={0.1}
          valign={Gtk.Align.CENTER}
          hexpand={true}
        />
      </box>
    </box>
  );
};
