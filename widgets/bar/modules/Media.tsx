import { Accessor, With, createBinding, createComputed, onCleanup } from "ags";
import { Gdk, Gtk } from "ags/gtk4";
import GdkPixbuf from "gi://GdkPixbuf?version=2.0";
import GLib from "gi://GLib?version=2.0";
import Mpris from "gi://AstalMpris";
import Pango from "gi://Pango";
import options from "options";

const COVER_SIZE = 18;
const COVER_DECODE_SIZE = 36;

export interface PlayerCandidate {
  busName?: string | null;
  playbackStatus?: Mpris.PlaybackStatus | null;
}

function isSpotifyPlayer(busName?: string | null): boolean {
  return (busName ?? "").toLowerCase().includes("spotify");
}

export function selectActivePlayer<T extends PlayerCandidate>(
  players: readonly T[],
): T | null {
  let firstPlaying: T | null = null;
  let firstPaused: T | null = null;
  let spotifyPaused: T | null = null;

  for (const player of players) {
    const status = player.playbackStatus;
    if (status === Mpris.PlaybackStatus.PLAYING) {
      if (isSpotifyPlayer(player.busName)) return player;
      firstPlaying ??= player;
    } else if (status === Mpris.PlaybackStatus.PAUSED) {
      if (isSpotifyPlayer(player.busName)) {
        spotifyPaused ??= player;
      } else {
        firstPaused ??= player;
      }
    }
  }

  return firstPlaying ?? spotifyPaused ?? firstPaused;
}

export function formatMediaInfo(
  title?: string | null,
  artist?: string | null,
  identity?: string | null,
): string {
  const cleanTitle = title?.trim() ?? "";
  const cleanArtist = artist?.trim() ?? "";
  if (cleanTitle && cleanArtist) return `${cleanTitle} - ${cleanArtist}`;
  if (cleanTitle) return cleanTitle;
  if (cleanArtist) return cleanArtist;
  return identity?.trim() || "Media";
}

function formatStatusLabel(status: Mpris.PlaybackStatus): string {
  switch (status) {
    case Mpris.PlaybackStatus.PLAYING:
      return "Playing";
    case Mpris.PlaybackStatus.PAUSED:
      return "Paused";
    default:
      return "Stopped";
  }
}

function resolveCoverPath(coverArt?: string | null): string | null {
  const raw = coverArt?.trim();
  if (!raw) return null;
  if (raw.startsWith("file://")) {
    try {
      const [decoded] = GLib.filename_from_uri(raw);
      return decoded || null;
    } catch {
      return null;
    }
  }
  return raw;
}

function loadCoverTexture(coverArt?: string | null): Gdk.Texture | null {
  const filePath = resolveCoverPath(coverArt);
  if (!filePath || !GLib.file_test(filePath, GLib.FileTest.IS_REGULAR)) {
    return null;
  }

  try {
    const raw = GdkPixbuf.Pixbuf.new_from_file_at_scale(
      filePath,
      COVER_DECODE_SIZE,
      COVER_DECODE_SIZE,
      true,
    );
    const width = raw.get_width();
    const height = raw.get_height();
    const side = Math.min(width, height);
    if (side <= 0) return null;

    const x = Math.floor((width - side) / 2);
    const y = Math.floor((height - side) / 2);
    const cropped = width === height ? raw : raw.new_subpixbuf(x, y, side, side);
    const scaled =
      side === COVER_SIZE
        ? cropped
        : cropped.scale_simple(
            COVER_SIZE,
            COVER_SIZE,
            GdkPixbuf.InterpType.BILINEAR,
          );
    return Gdk.Texture.new_for_pixbuf(scaled ?? cropped);
  } catch {
    return null;
  }
}

const mpris = Mpris.get_default();
const playersBinding = createBinding(mpris, "players");
const statusBindings = new WeakMap<
  Mpris.Player,
  Accessor<Mpris.PlaybackStatus>
>();

function getStatusBinding(
  player: Mpris.Player,
): Accessor<Mpris.PlaybackStatus> {
  let binding = statusBindings.get(player);
  if (!binding) {
    binding = createBinding(player, "playbackStatus");
    statusBindings.set(player, binding);
  }
  return binding;
}

export const activeMediaPlayer = createComputed<Mpris.Player | null>(() => {
  if (!options["bar.modules.media.enable"]()) return null;
  const players = playersBinding() ?? [];
  for (const player of players) {
    getStatusBinding(player)();
  }
  return selectActivePlayer(players);
});

export const hasMediaPlayer = activeMediaPlayer((player) => player !== null);

function ActiveMediaPlayer({ player }: { player: Mpris.Player }) {
  const playbackStatus = createBinding(player, "playbackStatus");
  const title = createBinding(player, "title");
  const artist = createBinding(player, "artist");
  const album = createBinding(player, "album");
  const identity = createBinding(player, "identity");
  const coverArt = createBinding(player, "coverArt");
  const canGoPrevious = createBinding(player, "canGoPrevious");
  const canGoNext = createBinding(player, "canGoNext");

  const spotify = isSpotifyPlayer(player.busName);
  const coverTexture = coverArt((path) => loadCoverTexture(path));

  const infoText = createComputed(
    [title, artist, identity],
    (t, a, id) => formatMediaInfo(t, a, id),
  );

  const infoTooltip = createComputed(
    [title, artist, album, identity, playbackStatus],
    (t, a, alb, id, status) => {
      const lines = [t?.trim() || id?.trim() || "Media"];
      if (a?.trim()) lines.push(`Artist: ${a.trim()}`);
      if (alb?.trim()) lines.push(`Album: ${alb.trim()}`);
      lines.push(
        `Player: ${id?.trim() || "Media Player"} (${formatStatusLabel(status)})`,
      );
      lines.push("", "Click: Play/Pause · Right-click: Focus · Scroll: Prev/Next");
      return lines.join("\n");
    },
  );

  const playPauseIcon = playbackStatus((status) =>
    status === Mpris.PlaybackStatus.PLAYING ? "󰏤" : "󰐊",
  );
  const playPauseTooltip = playbackStatus((status) =>
    status === Mpris.PlaybackStatus.PLAYING ? "Pause" : "Play",
  );

  return (
    <box cssClasses={["bar-media-inner"]} valign={Gtk.Align.CENTER} spacing={2}>
      <button
        cssClasses={["bar-media-info"]}
        valign={Gtk.Align.CENTER}
        tooltipText={infoTooltip}
        onClicked={() => {
          player.play_pause();
        }}
        $={(self) => {
          self.set_cursor_from_name("pointer");

          const rightClick = new Gtk.GestureClick();
          rightClick.set_button(3);
          const rightClickId = rightClick.connect("pressed", () => {
            try {
              player.raise();
            } catch (error) {
              console.error("Failed to raise media player:", error);
            }
          });
          self.add_controller(rightClick);

          const scroll = Gtk.EventControllerScroll.new(
            Gtk.EventControllerScrollFlags.VERTICAL,
          );
          const scrollId = scroll.connect("scroll", (_ctrl, _dx, dy) => {
            if (dy < 0) {
              player.previous();
            } else if (dy > 0) {
              player.next();
            }
            return true;
          });
          self.add_controller(scroll);

          onCleanup(() => {
            rightClick.disconnect(rightClickId);
            scroll.disconnect(scrollId);
          });
        }}
      >
        <box valign={Gtk.Align.CENTER} spacing={6}>
          <With value={coverTexture}>
            {(texture) =>
              texture ? (
                <box
                  cssClasses={["bar-media-cover"]}
                  overflow={Gtk.Overflow.HIDDEN}
                  widthRequest={COVER_SIZE}
                  heightRequest={COVER_SIZE}
                  halign={Gtk.Align.CENTER}
                  valign={Gtk.Align.CENTER}
                >
                  <Gtk.Picture
                    paintable={texture}
                    contentFit={Gtk.ContentFit.COVER}
                    canShrink={true}
                    widthRequest={COVER_SIZE}
                    heightRequest={COVER_SIZE}
                  />
                </box>
              ) : (
                <label
                  cssClasses={
                    spotify ? ["bar-media-icon", "spotify"] : ["bar-media-icon"]
                  }
                  valign={Gtk.Align.CENTER}
                  label={spotify ? "" : "󰎈"}
                />
              )
            }
          </With>
          <label
            cssClasses={["bar-media-label"]}
            valign={Gtk.Align.CENTER}
            label={infoText}
            singleLineMode={true}
            ellipsize={Pango.EllipsizeMode.END}
            maxWidthChars={20}
          />
        </box>
      </button>

      <button
        cssClasses={["bar-media-btn", "prev"]}
        valign={Gtk.Align.CENTER}
        sensitive={canGoPrevious}
        tooltipText="Previous Track"
        onClicked={() => {
          player.previous();
        }}
        $={(self) => {
          self.set_cursor_from_name("pointer");
        }}
      >
        <label label="󰒮" valign={Gtk.Align.CENTER} />
      </button>

      <button
        cssClasses={["bar-media-btn", "play-pause"]}
        valign={Gtk.Align.CENTER}
        tooltipText={playPauseTooltip}
        onClicked={() => {
          player.play_pause();
        }}
        $={(self) => {
          self.set_cursor_from_name("pointer");
        }}
      >
        <label label={playPauseIcon} valign={Gtk.Align.CENTER} />
      </button>

      <button
        cssClasses={["bar-media-btn", "next"]}
        valign={Gtk.Align.CENTER}
        sensitive={canGoNext}
        tooltipText="Next Track"
        onClicked={() => {
          player.next();
        }}
        $={(self) => {
          self.set_cursor_from_name("pointer");
        }}
      >
        <label label="󰒭" valign={Gtk.Align.CENTER} />
      </button>
    </box>
  );
}

export default function Media() {
  return (
    <box
      cssClasses={["bar-media", "module"]}
      visible={hasMediaPlayer}
      valign={Gtk.Align.CENTER}
    >
      <With value={activeMediaPlayer}>
        {(player) => (player ? <ActiveMediaPlayer player={player} /> : null)}
      </With>
    </box>
  );
}
