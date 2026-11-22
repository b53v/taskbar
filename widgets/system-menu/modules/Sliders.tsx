import { Gtk } from "ags/gtk4";
import { execAsync } from "ags/process";
import { createBinding, createComputed, createState } from "ags";
import Wp from "gi://AstalWp";
import Brightness from "utils/brightness.ts";
import options from "options";
import { AppAudioStreams } from "./AppAudioStreams.tsx";

export const Sliders = () => {
  const wp = Wp.get_default();
  const audio = wp?.audio ?? null;
  const speaker = audio?.defaultSpeaker ?? null;
  const microphone = wp?.get_default_microphone() ?? null;
  const brightness = Brightness.get_default();

  const streams = audio
    ? createBinding(audio, "streams")((list) => list ?? [])
    : null;
  const hasStreams = streams ? streams((list) => list.length > 0) : null;
  const [streamsExpanded, setStreamsExpanded] = createState(true);
  const revealStreams =
    hasStreams &&
    createComputed([hasStreams, streamsExpanded], (has, open) => has && open);

  return (
    <box
      cssClasses={["sliders"]}
      orientation={Gtk.Orientation.VERTICAL}
      spacing={4}
    >
      {speaker && (
        <box
          cssClasses={["speaker-section"]}
          orientation={Gtk.Orientation.VERTICAL}
          spacing={0}
        >
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
            {hasStreams && (
              <button
                cssClasses={["app-streams-toggle"]}
                visible={hasStreams}
                valign={Gtk.Align.CENTER}
                tooltipText={streamsExpanded((open) =>
                  open ? "Hide app volumes" : "Show app volumes",
                )}
                onClicked={() => setStreamsExpanded((open) => !open)}
              >
                <image
                  iconName="pan-end-symbolic"
                  cssClasses={streamsExpanded((open) =>
                    open
                      ? ["arrow-indicator", "arrow-down"]
                      : ["arrow-indicator"],
                  )}
                />
              </button>
            )}
          </box>
          {streams && hasStreams && revealStreams && (
            <revealer
              cssClasses={["app-streams-revealer"]}
              visible={hasStreams}
              transitionType={Gtk.RevealerTransitionType.SLIDE_DOWN}
              transitionDuration={180}
              revealChild={revealStreams}
            >
              <AppAudioStreams streams={streams} />
            </revealer>
          )}
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
