import { createComputed, createMemo, createState, onCleanup } from "ags";
import { compositor } from "utils/compositor/detector";
import { Gtk } from "ags/gtk4";

const HYPR_MAX_WORKSPACE = 10;
const hyprWorkspaceIds = Array.from(
  { length: HYPR_MAX_WORKSPACE },
  (_, i) => i + 1,
);

type HyprDotState = "focused" | "occupied" | "empty" | "hidden";

export function HyprlandWorkspaces() {
  // One pass over the workspace list per compositor event, shared by all dots
  // (previously each of the 10 dots ran two separate filters over it).
  const shared = createComputed(
    [compositor.workspaces, compositor.focusedWorkspace],
    (wss, fw) => {
      const focusedId = fw ? Number(fw.id) : 1;
      const occupied = new Set<number>();
      let maxOccupiedId = 1;
      for (const w of wss) {
        const wid = Number(w.id);
        if (w.occupied && wid > 0 && wid <= HYPR_MAX_WORKSPACE) {
          occupied.add(wid);
          if (wid > maxOccupiedId) maxOccupiedId = wid;
        }
      }
      // Sequential slot rule:
      // Workspaces 1 and 2 are always visible anchors.
      // If any higher workspace is occupied or currently focused,
      // ALL intermediate slots 1..maxVisible remain visible in sequential order!
      // This prevents slot 4 from collapsing slot 3 and appearing in slot 3.
      const maxVisible = Math.max(2, maxOccupiedId, focusedId);
      return { focusedId, occupied, maxVisible };
    },
  );

  const readStates = (): HyprDotState[] => {
    const { focusedId, occupied, maxVisible } = shared.get();
    return hyprWorkspaceIds.map((id) => {
      if (id > maxVisible) return "hidden";
      if (focusedId === id) return "focused";
      return occupied.has(id) ? "occupied" : "empty";
    });
  };
  const [frameStates, setFrameStates] = createState(readStates());

  return (
    <box
      cssClasses={["Workspaces"]}
      valign={Gtk.Align.CENTER}
      $={(self) => {
        // Hyprland focus/list/client notifications can arrive in one burst.
        // Commit only the latest complete snapshot at GTK's next frame, before
        // layout/paint, instead of restarting transitions on intermediate states.
        let tick = 0;
        const update = () => {
          const next = readStates();
          if (next.some((state, i) => state !== frameStates.get()[i])) {
            setFrameStates(next);
          }
        };
        const unsubscribe = shared.subscribe(() => {
          if (tick) return;
          tick = self.add_tick_callback(() => {
            tick = 0;
            update();
            return false;
          });
        });
        const mapped = self.connect("map", update);
        onCleanup(() => {
          unsubscribe();
          if (tick) self.remove_tick_callback(tick);
          self.disconnect(mapped);
        });
      }}
    >
      {hyprWorkspaceIds.map((id) => {
        // Memo only notifies when this dot's state actually changes, so the
        // other dots are not re-styled on every workspace switch.
        const state = createMemo<HyprDotState>(() => {
          return frameStates()[id - 1];
        });

        return (
          <button
            valign={Gtk.Align.CENTER}
            halign={Gtk.Align.CENTER}
            canTarget={state((s) => s !== "hidden")}
            cssClasses={state((s) => [s])}
            onClicked={() => compositor.focusWorkspace(id)}
          />
        );
      })}
    </box>
  );
}
