import { createComputed, onCleanup } from "ags";
import { Gdk, Gtk } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";
import { compositor } from "utils/compositor/detector";

export const HYPR_MAX_WORKSPACE = 10;
export const PILL_HEIGHT = 9.0;
export const PILL_FOCUSED_WIDTH = 22.0;
export const PILL_DOT_WIDTH = 9.0;
export const PILL_MARGIN = 3.0;

const CANVAS_HEIGHT = 24;
const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;

// Identical angular frequency for width & margin keeps total width invariant
// during fixed-count focus switches (w_old(t) + w_new(t) === 31.0) and makes
// appearing/collapsing dots bloom proportionally with zero overshoot.
const GEOM_OMEGA = 32.0;
const APPEARANCE_OMEGA = 36.0;
const RIM_FADE_DURATION = 0.4;

const ALPHA_OFFSET_FOCUSED = 0.0;
const ALPHA_OFFSET_HOVER = 0.22;
const ALPHA_OFFSET_OCCUPIED = 0.38;
const ALPHA_OFFSET_EMPTY = 0.7;

const FALLBACK_DOT_RIM: Rgba = { r: 0, g: 0, b: 0, a: 0.35 };
const FALLBACK_FOCUSED_RIM: Rgba = { r: 1, g: 1, b: 1, a: 0.2 };

export type HyprDotState = "focused" | "occupied" | "empty" | "hidden";

export interface WorkspaceLike {
  id: number | string;
  occupied: boolean;
}

export interface FocusedWorkspaceLike {
  id: number | string;
}

export interface WorkspaceStateSnapshot {
  focusedId: number;
  maxVisible: number;
  states: HyprDotState[];
}

export interface SpringScalar {
  value: number;
  velocity: number;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface ColorTransition {
  current: Rgba;
  from: Rgba;
  target: Rgba;
  elapsed: number;
  active: boolean;
}

interface SlotAnim {
  state: HyprDotState;
  width: SpringScalar;
  margin: SpringScalar;
  opacity: SpringScalar;
  alphaOffset: SpringScalar;
  rimMix: SpringScalar;
  targetWidth: number;
  targetMargin: number;
  targetOpacity: number;
  targetAlphaOffset: number;
  targetRimMix: number;
}

interface SlotLayout {
  x: number;
  w: number;
  hitLeft: number;
  hitRight: number;
}

export function computeWorkspaceState(
  wss: readonly WorkspaceLike[],
  fw: FocusedWorkspaceLike | null | undefined,
): WorkspaceStateSnapshot {
  const rawFocused = fw != null ? Number(fw.id) : 1;
  const focusedId = Number.isFinite(rawFocused) ? rawFocused : 1;
  const focusedContribution =
    focusedId >= 1 ? Math.min(HYPR_MAX_WORKSPACE, Math.floor(focusedId)) : 1;

  const occupied = new Set<number>();
  let maxOccupiedId = 0;
  for (const w of wss) {
    const wid = Number(w.id);
    if (
      w.occupied &&
      wid >= 1 &&
      wid <= HYPR_MAX_WORKSPACE &&
      Number.isInteger(wid)
    ) {
      occupied.add(wid);
      if (wid > maxOccupiedId) maxOccupiedId = wid;
    }
  }

  // Min-1 sequential slot rule:
  // Workspace 1 is always anchored. Higher workspaces 1..maxVisible appear
  // sequentially when any higher workspace is occupied or focused, and
  // smoothly collapse back down to 1 when empty and unfocused.
  const maxVisible = Math.max(1, maxOccupiedId, focusedContribution);
  const states: HyprDotState[] = new Array(HYPR_MAX_WORKSPACE);
  for (let i = 0; i < HYPR_MAX_WORKSPACE; i++) {
    const id = i + 1;
    if (id > maxVisible) {
      states[i] = "hidden";
    } else if (focusedId === id) {
      states[i] = "focused";
    } else {
      states[i] = occupied.has(id) ? "occupied" : "empty";
    }
  }

  return { focusedId, maxVisible, states };
}

export function workspaceContentWidth(visibleCount: number): number {
  const clamped = Math.max(
    1,
    Math.min(HYPR_MAX_WORKSPACE, Math.floor(visibleCount)),
  );
  // 1 focused pill (22 + 6 = 28) + (N - 1) dots (9 + 6 = 15 each) = 13 + 15 * N.
  // Round up to an even integer so CenterBox keeps optical center pinned to W/2.
  const raw = 13 + 15 * clamped;
  return raw + (raw & 1);
}

/**
 * Exact closed-form critically-damped spring step.
 * Unconditionally stable across 60–240Hz / VRR with zero overshoot and C1
 * velocity continuity on mid-flight interruptions.
 */
export function stepCriticallyDampedSpring(
  state: SpringScalar,
  target: number,
  omega: number,
  dt: number,
  epsilonValue: number,
  epsilonVelocity: number,
): boolean {
  const delta = state.value - target;
  if (
    Math.abs(delta) <= epsilonValue &&
    Math.abs(state.velocity) <= epsilonVelocity
  ) {
    state.value = target;
    state.velocity = 0;
    return false;
  }
  if (dt <= 0) return true;

  const exp = Math.exp(-omega * dt);
  const c2 = state.velocity + omega * delta;
  const nextDelta = (delta + c2 * dt) * exp;
  const nextVelocity = (c2 - omega * (delta + c2 * dt)) * exp;

  if (
    Math.abs(nextDelta) <= epsilonValue &&
    Math.abs(nextVelocity) <= epsilonVelocity
  ) {
    state.value = target;
    state.velocity = 0;
    return false;
  }

  state.value = target + nextDelta;
  state.velocity = nextVelocity;
  return true;
}

function targetForState(state: HyprDotState, hovered: boolean) {
  switch (state) {
    case "focused":
      return {
        width: PILL_FOCUSED_WIDTH,
        margin: PILL_MARGIN,
        opacity: 1,
        alphaOffset: ALPHA_OFFSET_FOCUSED,
        rimMix: 1,
      };
    case "occupied":
      return {
        width: PILL_DOT_WIDTH,
        margin: PILL_MARGIN,
        opacity: 1,
        alphaOffset: hovered ? ALPHA_OFFSET_HOVER : ALPHA_OFFSET_OCCUPIED,
        rimMix: 0,
      };
    case "empty":
      return {
        width: PILL_DOT_WIDTH,
        margin: PILL_MARGIN,
        opacity: 1,
        alphaOffset: hovered ? ALPHA_OFFSET_HOVER : ALPHA_OFFSET_EMPTY,
        rimMix: 0,
      };
    case "hidden":
      return {
        width: 0,
        margin: 0,
        opacity: 0,
        alphaOffset: ALPHA_OFFSET_EMPTY,
        rimMix: 0,
      };
  }
}

function cloneRgba(c: Rgba): Rgba {
  return { r: c.r, g: c.g, b: c.b, a: c.a };
}

function colorsClose(a: Rgba, b: Rgba): boolean {
  return (
    Math.abs(a.r - b.r) <= 1e-4 &&
    Math.abs(a.g - b.g) <= 1e-4 &&
    Math.abs(a.b - b.b) <= 1e-4 &&
    Math.abs(a.a - b.a) <= 1e-4
  );
}

function createColorTransition(initial: Rgba): ColorTransition {
  return {
    current: cloneRgba(initial),
    from: cloneRgba(initial),
    target: cloneRgba(initial),
    elapsed: RIM_FADE_DURATION,
    active: false,
  };
}

function syncColorTarget(
  tr: ColorTransition,
  next: Rgba,
  snap: boolean,
): boolean {
  if (snap) {
    tr.current = cloneRgba(next);
    tr.from = cloneRgba(next);
    tr.target = cloneRgba(next);
    tr.elapsed = RIM_FADE_DURATION;
    tr.active = false;
    return false;
  }
  if (colorsClose(tr.target, next)) return false;
  tr.from = cloneRgba(tr.current);
  tr.target = cloneRgba(next);
  tr.elapsed = 0;
  tr.active = true;
  return true;
}

function stepColorTransition(tr: ColorTransition, dt: number): boolean {
  if (!tr.active) return false;
  tr.elapsed += dt;
  if (tr.elapsed >= RIM_FADE_DURATION) {
    tr.current = cloneRgba(tr.target);
    tr.from = cloneRgba(tr.target);
    tr.elapsed = RIM_FADE_DURATION;
    tr.active = false;
    return false;
  }
  const p = Math.max(0, Math.min(1, tr.elapsed / RIM_FADE_DURATION));
  const eased = p * p * (3 - 2 * p);
  tr.current.r = tr.from.r + (tr.target.r - tr.from.r) * eased;
  tr.current.g = tr.from.g + (tr.target.g - tr.from.g) * eased;
  tr.current.b = tr.from.b + (tr.target.b - tr.from.b) * eased;
  tr.current.a = tr.from.a + (tr.target.a - tr.from.a) * eased;
  return true;
}

function traceCapsule(
  cr: any,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  cr.newPath();
  if (w <= h + 0.001) {
    cr.arc(x + w / 2, y + h / 2, radius, 0, TWO_PI);
    cr.closePath();
    return;
  }
  const leftCx = x + radius;
  const rightCx = x + w - radius;
  const cy = y + h / 2;
  cr.arc(rightCx, cy, radius, -HALF_PI, HALF_PI);
  cr.arc(leftCx, cy, radius, HALF_PI, Math.PI * 1.5);
  cr.closePath();
}

function lookupThemeColor(
  widget: Gtk.Widget,
  name: string,
  fallback: Rgba,
): Rgba {
  const [ok, color] = widget.get_style_context().lookup_color(name);
  if (!ok) return fallback;
  return { r: color.red, g: color.green, b: color.blue, a: color.alpha };
}

export function HyprlandWorkspaces() {
  // One pass over the workspace list per compositor event.
  const shared = createComputed(
    [compositor.workspaces, compositor.focusedWorkspace],
    (wss, fw) => computeWorkspaceState(wss, fw),
  );

  return (
    <drawingarea
      cssClasses={["Workspaces"]}
      valign={Gtk.Align.CENTER}
      halign={Gtk.Align.CENTER}
      $={(self: Gtk.DrawingArea) => {
        const initial = shared.get();
        let targetMaxVisible = initial.maxVisible;
        let allocatedSlots = initial.maxVisible;
        let hoveredIndex = -1;
        let mapped = self.get_mapped();
        let disposed = false;
        let tickId = 0;
        let lastFrameTimeUs = 0;
        let rimsInitialized = false;

        const pointerCursor = Gdk.Cursor.new_from_name("pointer", null);
        const dotRim = createColorTransition(FALLBACK_DOT_RIM);
        const focusedRim = createColorTransition(FALLBACK_FOCUSED_RIM);

        const slots: SlotAnim[] = initial.states.map((state) => {
          const t = targetForState(state, false);
          return {
            state,
            width: { value: t.width, velocity: 0 },
            margin: { value: t.margin, velocity: 0 },
            opacity: { value: t.opacity, velocity: 0 },
            alphaOffset: { value: t.alphaOffset, velocity: 0 },
            rimMix: { value: t.rimMix, velocity: 0 },
            targetWidth: t.width,
            targetMargin: t.margin,
            targetOpacity: t.opacity,
            targetAlphaOffset: t.alphaOffset,
            targetRimMix: t.rimMix,
          };
        });

        const layout: SlotLayout[] = Array.from(
          { length: HYPR_MAX_WORKSPACE },
          () => ({ x: 0, w: 0, hitLeft: 0, hitRight: 0 }),
        );

        const setAllocatedSlots = (count: number) => {
          allocatedSlots = count;
          self.set_content_width(workspaceContentWidth(count));
        };

        self.set_content_height(CANVAS_HEIGHT);
        setAllocatedSlots(allocatedSlots);

        const updateLayout = (allocWidth: number) => {
          let totalW = 0;
          for (let i = 0; i < HYPR_MAX_WORKSPACE; i++) {
            const s = slots[i];
            totalW += Math.max(0, s.width.value) + Math.max(0, s.margin.value) * 2;
          }
          let cursorX = (allocWidth - totalW) / 2;
          for (let i = 0; i < HYPR_MAX_WORKSPACE; i++) {
            const s = slots[i];
            const w = Math.max(0, s.width.value);
            const m = Math.max(0, s.margin.value);
            const span = w + m * 2;
            const rect = layout[i];
            rect.x = cursorX + m;
            rect.w = w;
            rect.hitLeft = cursorX;
            rect.hitRight = cursorX + span;
            cursorX += span;
          }
        };

        const hitTest = (x: number, y: number): number => {
          const w = self.get_width();
          const h = self.get_height();
          if (w <= 0 || h <= 0 || y < 0 || y > h) return -1;
          updateLayout(w);
          for (let i = 0; i < HYPR_MAX_WORKSPACE; i++) {
            const s = slots[i];
            if (s.state === "hidden" || s.opacity.value <= 0.1) continue;
            const rect = layout[i];
            if (x >= rect.hitLeft && x <= rect.hitRight) return i;
          }
          return -1;
        };

        const stopTick = () => {
          if (tickId !== 0) {
            self.remove_tick_callback(tickId);
            tickId = 0;
          }
          lastFrameTimeUs = 0;
        };

        const snapAllToTargets = () => {
          for (let i = 0; i < HYPR_MAX_WORKSPACE; i++) {
            const s = slots[i];
            s.width.value = s.targetWidth;
            s.width.velocity = 0;
            s.margin.value = s.targetMargin;
            s.margin.velocity = 0;
            s.opacity.value = s.targetOpacity;
            s.opacity.velocity = 0;
            s.alphaOffset.value = s.targetAlphaOffset;
            s.alphaOffset.velocity = 0;
            s.rimMix.value = s.targetRimMix;
            s.rimMix.velocity = 0;
          }
          if (allocatedSlots !== targetMaxVisible) {
            setAllocatedSlots(targetMaxVisible);
          }
        };

        const syncRims = (snap: boolean) => {
          const nextDot = lookupThemeColor(self, "bar_dot_rim", FALLBACK_DOT_RIM);
          const nextFocused = lookupThemeColor(
            self,
            "bar_rim",
            FALLBACK_FOCUSED_RIM,
          );
          const doSnap = snap || !rimsInitialized;
          rimsInitialized = true;
          const changedDot = syncColorTarget(dotRim, nextDot, doSnap);
          const changedFocused = syncColorTarget(focusedRim, nextFocused, doSnap);
          if ((changedDot || changedFocused) && mapped && !disposed) {
            ensureTick();
          }
        };

        const ensureTick = () => {
          if (disposed || !mapped || tickId !== 0) return;
          lastFrameTimeUs = GLib.get_monotonic_time();
          tickId = self.add_tick_callback((_widget, frameClock) => {
            if (disposed || !mapped) {
              tickId = 0;
              lastFrameTimeUs = 0;
              return false;
            }

            const nowUs = frameClock.get_frame_time();
            const rawDt =
              lastFrameTimeUs > 0 ? (nowUs - lastFrameTimeUs) / 1_000_000 : 1 / 240;
            lastFrameTimeUs = nowUs;
            // Clamp dt so suspend/resume cannot destabilize fades, and ensure
            // immediate motion on the very first VSync after waking from idle.
            const dt =
              rawDt > 0 ? Math.min(rawDt, 0.05) : 1 / 240;

            let active = false;
            for (let i = 0; i < HYPR_MAX_WORKSPACE; i++) {
              const s = slots[i];
              if (
                stepCriticallyDampedSpring(
                  s.width,
                  s.targetWidth,
                  GEOM_OMEGA,
                  dt,
                  0.01,
                  0.05,
                )
              ) {
                active = true;
              }
              if (
                stepCriticallyDampedSpring(
                  s.margin,
                  s.targetMargin,
                  GEOM_OMEGA,
                  dt,
                  0.005,
                  0.02,
                )
              ) {
                active = true;
              }
              if (
                stepCriticallyDampedSpring(
                  s.opacity,
                  s.targetOpacity,
                  APPEARANCE_OMEGA,
                  dt,
                  0.002,
                  0.01,
                )
              ) {
                active = true;
              }
              if (
                stepCriticallyDampedSpring(
                  s.alphaOffset,
                  s.targetAlphaOffset,
                  APPEARANCE_OMEGA,
                  dt,
                  0.002,
                  0.01,
                )
              ) {
                active = true;
              }
              if (
                stepCriticallyDampedSpring(
                  s.rimMix,
                  s.targetRimMix,
                  APPEARANCE_OMEGA,
                  dt,
                  0.002,
                  0.01,
                )
              ) {
                active = true;
              }
            }

            if (stepColorTransition(dotRim, dt)) active = true;
            if (stepColorTransition(focusedRim, dt)) active = true;

            self.queue_draw();

            if (!active) {
              tickId = 0;
              lastFrameTimeUs = 0;
              // Shrink allocation once after collapse completes; even-width
              // rounding keeps the optical center locked at W/2 (0px shift).
              if (allocatedSlots > targetMaxVisible) {
                setAllocatedSlots(targetMaxVisible);
              }
              return false;
            }
            return true;
          });
        };

        const updateSlotTargets = (snap: boolean) => {
          let needsAnim = false;
          for (let i = 0; i < HYPR_MAX_WORKSPACE; i++) {
            const s = slots[i];
            const t = targetForState(s.state, i === hoveredIndex);
            const wasInvisible =
              s.opacity.value <= 0.01 && s.width.value <= 0.25;

            s.targetWidth = t.width;
            s.targetMargin = t.margin;
            s.targetOpacity = t.opacity;

            if (s.state === "hidden") {
              // Keep current tone while collapsing so disappearing pills fade
              // out cleanly instead of flashing to empty-dot gray mid-shrink.
              s.targetAlphaOffset = s.alphaOffset.value;
              s.targetRimMix = s.rimMix.value;
              s.alphaOffset.velocity = 0;
              s.rimMix.velocity = 0;
            } else {
              s.targetAlphaOffset = t.alphaOffset;
              s.targetRimMix = t.rimMix;
              if (wasInvisible) {
                // Blooming from hidden: snap tone immediately so it emerges in
                // its true focused/occupied/empty shade right from pixel 1.
                s.alphaOffset.value = t.alphaOffset;
                s.alphaOffset.velocity = 0;
                s.rimMix.value = t.rimMix;
                s.rimMix.velocity = 0;
              }
            }

            if (
              Math.abs(s.width.value - s.targetWidth) > 0.01 ||
              Math.abs(s.width.velocity) > 0.05 ||
              Math.abs(s.margin.value - s.targetMargin) > 0.005 ||
              Math.abs(s.margin.velocity) > 0.02 ||
              Math.abs(s.opacity.value - s.targetOpacity) > 0.002 ||
              Math.abs(s.opacity.velocity) > 0.01 ||
              Math.abs(s.alphaOffset.value - s.targetAlphaOffset) > 0.002 ||
              Math.abs(s.alphaOffset.velocity) > 0.01 ||
              Math.abs(s.rimMix.value - s.targetRimMix) > 0.002 ||
              Math.abs(s.rimMix.velocity) > 0.01
            ) {
              needsAnim = true;
            }
          }

          if (snap || !mapped) {
            snapAllToTargets();
            if (mapped) self.queue_draw();
          } else if (needsAnim) {
            ensureTick();
          }
        };

        const applySnapshot = (snap: boolean) => {
          const next = shared.get();
          let changed = next.maxVisible !== targetMaxVisible;
          targetMaxVisible = next.maxVisible;

          for (let i = 0; i < HYPR_MAX_WORKSPACE; i++) {
            if (slots[i].state !== next.states[i]) {
              slots[i].state = next.states[i];
              changed = true;
            }
          }

          if (hoveredIndex >= 0 && slots[hoveredIndex].state === "hidden") {
            hoveredIndex = -1;
            self.set_cursor(null);
            changed = true;
          }

          if (!changed && !snap) return;

          // Grow canvas once before frame 1 so animation never triggers resize.
          if (targetMaxVisible > allocatedSlots) {
            setAllocatedSlots(targetMaxVisible);
          }

          updateSlotTargets(snap);
        };

        self.set_draw_func((_area, cr, width, height) => {
          if (disposed || width <= 0 || height <= 0) return;

          syncRims(false);

          const ink = self.get_color();
          const cy = height % 2 === 1 ? height / 2 : height / 2 - 0.5;
          updateLayout(width);

          for (let i = 0; i < HYPR_MAX_WORKSPACE; i++) {
            const s = slots[i];
            const op = Math.max(0, Math.min(1, s.opacity.value));
            const rect = layout[i];
            const w = rect.w;
            if (w < 0.25 || op < 0.004) continue;

            const r = Math.min(PILL_HEIGHT / 2, w / 2);
            const h = r * 2;
            const y = cy - r;

            // 1px crisp outer rim matching CSS `box-shadow: 0 0 0 1px $barRim/$barDotRim`
            const m = Math.max(0, Math.min(1, s.rimMix.value));
            const rr =
              dotRim.current.r + (focusedRim.current.r - dotRim.current.r) * m;
            const rg =
              dotRim.current.g + (focusedRim.current.g - dotRim.current.g) * m;
            const rb =
              dotRim.current.b + (focusedRim.current.b - dotRim.current.b) * m;
            const ra =
              (dotRim.current.a +
                (focusedRim.current.a - dotRim.current.a) * m) *
              op;

            if (ra > 0.002) {
              traceCapsule(cr, rect.x - 0.5, y - 0.5, w + 1.0, h + 1.0, r + 0.5);
              cr.setLineWidth(1.0);
              cr.setSourceRGBA(rr, rg, rb, ra);
              cr.stroke();
            }

            // Monochrome pill / dot fill using live GTK-interpolated $barInk
            const fillAlpha =
              Math.max(0, Math.min(1, ink.alpha - s.alphaOffset.value)) * op;
            if (fillAlpha > 0.002) {
              traceCapsule(cr, rect.x, y, w, h, r);
              cr.setSourceRGBA(ink.red, ink.green, ink.blue, fillAlpha);
              cr.fill();
            }
          }
        });

        const motion = new Gtk.EventControllerMotion();
        const motionId = motion.connect("motion", (_ctrl, x, y) => {
          const hit = hitTest(x, y);
          if (hit === hoveredIndex) return;
          hoveredIndex = hit;
          self.set_cursor(hoveredIndex >= 0 ? pointerCursor : null);
          updateSlotTargets(false);
        });
        const leaveId = motion.connect("leave", () => {
          if (hoveredIndex === -1) return;
          hoveredIndex = -1;
          self.set_cursor(null);
          updateSlotTargets(false);
        });
        self.add_controller(motion);

        const click = new Gtk.GestureClick();
        click.set_button(1);
        let pressedIndex = -1;
        const pressedId = click.connect("pressed", (_gesture, _nPress, x, y) => {
          pressedIndex = hitTest(x, y);
        });
        const releasedId = click.connect(
          "released",
          (_gesture, _nPress, x, y) => {
            const hit = hitTest(x, y);
            const match = pressedIndex;
            pressedIndex = -1;
            if (hit >= 0 && (match === -1 || hit === match)) {
              compositor.focusWorkspace(hit + 1);
            }
          },
        );
        const stoppedId = click.connect("stopped", () => {
          pressedIndex = -1;
        });
        self.add_controller(click);

        const unsubscribe = shared.subscribe(() => {
          if (!disposed) applySnapshot(false);
        });

        const mapId = self.connect("map", () => {
          mapped = true;
          applySnapshot(true);
          syncRims(true);
          self.queue_draw();
        });

        const unmapId = self.connect("unmap", () => {
          mapped = false;
          stopTick();
          if (hoveredIndex !== -1) {
            hoveredIndex = -1;
            self.set_cursor(null);
          }
          snapAllToTargets();
        });

        onCleanup(() => {
          disposed = true;
          mapped = false;
          unsubscribe();
          stopTick();
          self.disconnect(mapId);
          self.disconnect(unmapId);
          motion.disconnect(motionId);
          motion.disconnect(leaveId);
          click.disconnect(pressedId);
          click.disconnect(releasedId);
          click.disconnect(stoppedId);
          self.remove_controller(motion);
          self.remove_controller(click);
          self.set_cursor(null);
          self.set_draw_func(null);
        });
      }}
    />
  );
}
