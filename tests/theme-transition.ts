// Rendered on the isolated Broadway backend, not the user's desktop.
import { Gtk } from "ags/gtk4";
import GLib from "gi://GLib?version=2.0";
import { readFile } from "ags/file";
import { StyleProvider } from "utils/styleProvider";

Gtk.init();
Gtk.Settings.get_default()!.gtk_enable_animations = true;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
const styles = new StyleProvider();
const directory = GLib.getenv("AGS_THEME_TEST_DIR")!;
const whiteInk = readFile(`${directory}/dark.css`);
const blackInk = readFile(`${directory}/light.css`);
styles.apply(whiteInk);
const label = new Gtk.Label({ label: "CPU 19% · 12:34", css_classes: ["clock"] });
const image = new Gtk.Image({ icon_name: "audio-volume-high-symbolic" });
const button = new Gtk.Button({ child: image, css_classes: ["bar-volume"] });
const box = new Gtk.Box();
box.append(label);
box.append(button);
const window = new Gtk.Window({ child: box, css_classes: ["Bar", "bar-style-expanded"] });
window.present();
// Let the initial style settle before replacing the stylesheet.
await sleep(500);
const red = (widget: Gtk.Widget) => widget.get_style_context().get_color().red;
const originalWidth = label.get_width();
assert(red(label) > 0.9 && red(image) > 0.9, "initial dark-theme ink is not white");
styles.apply(blackInk);
await sleep(120);
const middle = red(label);
assert(middle > 0.12 && middle < 0.95, `CSS replacement jumped instead of fading: ${middle}`);
assert(red(image) > 0.12 && red(image) < 0.95, "icon did not fade with text");
// Watcher + explicit requests often produce identical CSS. It must not restart
// the fade halfway through or accumulate another provider.
styles.apply(blackInk);
await sleep(400);
assert(red(label) < 0.12 && red(image) < 0.12, "light-theme fade did not finish");
assert(label.get_width() === originalWidth, "color transition changed label geometry");

let rejected = false;
try { styles.apply(".Bar { invalid-property: true; }"); } catch { rejected = true; }
assert(rejected && red(label) < 0.12, "invalid CSS displaced working style");
styles.apply(whiteInk);
await sleep(120);
assert(red(label) > 0.12 && red(label) < 0.95, "reverse theme switch did not fade");
await sleep(400);
assert(red(label) > 0.9, "reverse fade did not finish");
window.destroy();
styles.destroy();
print("PASS: full bar CSS fades text/icons in both directions, keeps geometry and rejects invalid CSS");
