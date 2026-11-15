import { Gdk, Gtk } from "ags/gtk4";

/** Validate first, then swap in one turn; no reset-to-default frame or provider leak. */
export class StyleProvider {
  private provider: Gtk.CssProvider | null = null;
  private source: string | null = null;

  apply(source: string) {
    if (source === this.source) return;
    const display = Gdk.Display.get_default();
    if (!display) throw Error("No display for CSS");
    const next = new Gtk.CssProvider();
    const errors: string[] = [];
    const handler = next.connect("parsing-error", (_, _section, error) => {
      errors.push(error.message);
    });
    next.load_from_string(source);
    next.disconnect(handler);
    if (errors.length) throw Error(`CSS rejected: ${errors.join("; ")}`);

    Gtk.StyleContext.add_provider_for_display(display, next, Gtk.STYLE_PROVIDER_PRIORITY_USER);
    if (this.provider) Gtk.StyleContext.remove_provider_for_display(display, this.provider);
    this.provider = next;
    this.source = source;
  }

  destroy() {
    const display = Gdk.Display.get_default();
    if (display && this.provider) Gtk.StyleContext.remove_provider_for_display(display, this.provider);
    this.provider = null;
    this.source = null;
  }
}
