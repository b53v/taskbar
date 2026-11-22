import { Gdk, Gtk } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";
import { Accessor, For, createBinding, createComputed, onCleanup } from "ags";
import Wp from "gi://AstalWp";
import Pango from "gi://Pango";

const MAX_STREAMS_HEIGHT = 200;
const DEFAULT_SCROLL_WIDTH = 340;

function resolveStreamIcon(
  icon: string | null | undefined,
  muted: boolean,
): string {
  if (muted) return "audio-volume-muted-symbolic";
  const trimmed = icon?.trim();
  if (trimmed && trimmed !== "application-x-executable-symbolic") {
    const display = Gdk.Display.get_default();
    if (!display) return trimmed;
    const theme = Gtk.IconTheme.get_for_display(display);
    if (theme.has_icon(trimmed)) return trimmed;
  }
  return "audio-x-generic-symbolic";
}

function AppStreamRow({ stream }: { stream: Wp.Stream }) {
  const description = createBinding(stream, "description");
  const name = createBinding(stream, "name");
  const icon = createBinding(stream, "icon");
  const volume = createBinding(stream, "volume");
  const mute = createBinding(stream, "mute");

  const displayName = createComputed(
    [description, name],
    (desc, fallback) => desc?.trim() || fallback?.trim() || "Application",
  );

  const iconName = createComputed([icon, mute], (appIcon, isMuted) =>
    resolveStreamIcon(appIcon, isMuted),
  );

  const percentLabel = volume(
    (vol) => `${Math.round(Math.max(0, vol) * 100)}%`,
  );

  const muteTooltip = createComputed(
    [displayName, mute],
    (label, isMuted) => (isMuted ? `Unmute ${label}` : `Mute ${label}`),
  );

  const rowClasses = mute((isMuted) =>
    isMuted ? ["app-stream-row", "muted"] : ["app-stream-row"],
  );

  const muteButtonClasses = mute((isMuted) =>
    isMuted ? ["app-stream-mute", "muted"] : ["app-stream-mute"],
  );

  return (
    <box cssClasses={rowClasses} hexpand={true} valign={Gtk.Align.CENTER}>
      <button
        cssClasses={muteButtonClasses}
        valign={Gtk.Align.CENTER}
        tooltipText={muteTooltip}
        onClicked={() => {
          stream.mute = !stream.mute;
        }}
      >
        <image iconName={iconName} />
      </button>

      <box
        cssClasses={["app-stream-body"]}
        orientation={Gtk.Orientation.VERTICAL}
        hexpand={true}
        valign={Gtk.Align.CENTER}
        spacing={1}
      >
        <box cssClasses={["app-stream-header"]} hexpand={true} spacing={6}>
          <label
            cssClasses={["app-stream-name"]}
            label={displayName}
            xalign={0}
            hexpand={true}
            ellipsize={Pango.EllipsizeMode.END}
            maxWidthChars={24}
          />
          <label
            cssClasses={["app-stream-percent"]}
            label={percentLabel}
            halign={Gtk.Align.END}
          />
        </box>

        <slider
          cssClasses={["app-stream-slider"]}
          min={0}
          max={1}
          value={volume}
          onChangeValue={(self) => {
            stream.volume = self.value;
          }}
          valign={Gtk.Align.CENTER}
          hexpand={true}
        />
      </box>
    </box>
  );
}

export function AppAudioStreams({
  streams,
}: {
  streams: Accessor<Wp.Stream[]>;
}) {
  let scrollWidget: Gtk.ScrolledWindow | null = null;
  let listWidget: Gtk.Box | null = null;
  let measureIdleId: number | null = null;

  const cancelMeasureIdle = () => {
    if (measureIdleId !== null) {
      GLib.source_remove(measureIdleId);
      measureIdleId = null;
    }
  };

  const updateScrollMinHeight = () => {
    if (!scrollWidget || !listWidget) return;
    if (streams.get().length === 0) {
      if (scrollWidget.get_min_content_height() !== 0) {
        scrollWidget.set_min_content_height(0);
      }
      return;
    }
    const allocWidth = scrollWidget.get_allocated_width();
    const forWidth = allocWidth > 100 ? allocWidth : DEFAULT_SCROLL_WIDTH;
    const [, naturalHeight] = listWidget.measure(
      Gtk.Orientation.VERTICAL,
      forWidth,
    );
    const target = Math.min(
      MAX_STREAMS_HEIGHT,
      Math.max(0, Math.ceil(naturalHeight)),
    );
    if (scrollWidget.get_min_content_height() !== target) {
      scrollWidget.set_min_content_height(target);
    }
  };

  const scheduleMeasure = () => {
    cancelMeasureIdle();
    measureIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      measureIdleId = null;
      updateScrollMinHeight();
      return GLib.SOURCE_REMOVE;
    });
  };

  const unsubStreams = streams.subscribe(() => {
    scheduleMeasure();
  });

  onCleanup(() => {
    cancelMeasureIdle();
    unsubStreams();
    scrollWidget = null;
    listWidget = null;
  });

  return (
    <box
      cssClasses={["app-streams"]}
      orientation={Gtk.Orientation.VERTICAL}
      hexpand={true}
    >
      <Gtk.ScrolledWindow
        cssClasses={["app-streams-scroll"]}
        hexpand={true}
        hscrollbarPolicy={Gtk.PolicyType.NEVER}
        vscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
        propagateNaturalHeight={true}
        maxContentHeight={MAX_STREAMS_HEIGHT}
        overlayScrolling={true}
        $={(self) => {
          scrollWidget = self;
          updateScrollMinHeight();
          scheduleMeasure();

          const mapId = self.connect("map", () => {
            updateScrollMinHeight();
            scheduleMeasure();
          });

          onCleanup(() => {
            self.disconnect(mapId);
          });
        }}
      >
        <box
          cssClasses={["app-streams-list"]}
          orientation={Gtk.Orientation.VERTICAL}
          hexpand={true}
          spacing={4}
          $={(self) => {
            listWidget = self;
            if (scrollWidget) {
              updateScrollMinHeight();
              scheduleMeasure();
            }
          }}
        >
          <For each={streams}>
            {(stream: Wp.Stream) => <AppStreamRow stream={stream} />}
          </For>
        </box>
      </Gtk.ScrolledWindow>
    </box>
  );
}
