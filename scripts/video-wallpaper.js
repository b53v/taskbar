// Standalone layer-shell video wallpaper process.
// Spawned by AGS with LD_PRELOAD=libgtk4-layer-shell so layer-shell is
// initialized before libwayland (same workaround gtk4-layer-shell documents).
imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gtk4LayerShell = '1.0';

const { Gtk, Gdk, GLib, Gio } = imports.gi;
const LayerShell = imports.gi.Gtk4LayerShell;

const videoPath = ARGV[0];
const parentPid = Number(ARGV[1] || 0);

if (!videoPath || !GLib.file_test(videoPath, GLib.FileTest.EXISTS)) {
    printerr('video wallpaper: missing or invalid path');
    imports.system.exit(1);
}

const app = new Gtk.Application({
    application_id: 'org.ags.videowall',
    flags: Gio.ApplicationFlags.NON_UNIQUE,
});

app.connect('activate', () => {
    const css = new Gtk.CssProvider();
    css.load_from_string('.video-wallpaper controls { opacity: 0; }');
    Gtk.StyleContext.add_provider_for_display(
        Gdk.Display.get_default(),
        css,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
    );

    const media = Gtk.MediaFile.new_for_filename(videoPath);
    media.set_loop(true);
    media.set_muted(true);

    media.connect('notify::ended', () => {
        if (media.get_ended()) {
            media.seek(0);
            media.play();
        }
    });

    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        if (media.get_ended()) {
            media.seek(0);
            media.play();
        } else if (!media.get_playing()) {
            media.play();
        }
        return GLib.SOURCE_CONTINUE;
    });

    const video = new Gtk.Video({
        media_stream: media,
        autoplay: true,
        loop: true,
        hexpand: true,
        vexpand: true,
        can_focus: false,
    });

    const win = new Gtk.Window({ decorated: false, child: video });
    win.add_css_class('video-wallpaper');

    LayerShell.init_for_window(win);
    LayerShell.set_namespace(win, 'wallpaper');
    LayerShell.set_layer(win, LayerShell.Layer.BOTTOM);
    LayerShell.set_anchor(win, LayerShell.Edge.TOP, true);
    LayerShell.set_anchor(win, LayerShell.Edge.BOTTOM, true);
    LayerShell.set_anchor(win, LayerShell.Edge.LEFT, true);
    LayerShell.set_anchor(win, LayerShell.Edge.RIGHT, true);
    LayerShell.set_exclusive_zone(win, -1);
    LayerShell.set_keyboard_mode(win, LayerShell.KeyboardMode.NONE);

    video.connect('realize', () => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            media.play();
            return GLib.SOURCE_REMOVE;
        });
    });

    win.connect('destroy', () => app.quit());

    app.add_window(win);
    win.present();
});

if (parentPid > 0) {
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
        if (!GLib.file_test(`/proc/${parentPid}`, GLib.FileTest.EXISTS)) {
            app.quit();
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    });
}

app.run([]);
