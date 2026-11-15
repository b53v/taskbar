#!/usr/bin/env python3
"""Check actual GTK color interpolation on a private headless Broadway display."""
import base64
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import tempfile
import time

project = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="ags-theme-test-", dir="/tmp/opencode") as temporary:
    root = Path(temporary)
    shutil.copytree(project / "style", root / "style")
    variables = root / "style/abstracts/_variables.scss"
    original = variables.read_text()
    contrast = root / "style/abstracts/_wallpaper-contrast.scss"
    # Validate both shadow variants in each theme without changing live files.
    for mixed in (False, True):
        contrast.write_text(f"$barMixedBackdrop: {str(mixed).lower()};\n")
        for mode in ("dark", "light"):
            variables.write_text(re.sub(r"\$darkmode: (?:true|false);",
                                       f"$darkmode: {str(mode == 'dark').lower()};", original))
            subprocess.run(["sass", "--silence-deprecation=if-function", "--no-source-map",
                            str(root / "style/main.scss"), str(root / f"{mode}.css")], check=True)
            subprocess.run(["gjs", "-c", '''imports.gi.versions.Gtk="4.0";
                const Gtk=imports.gi.Gtk;Gtk.init();const p=new Gtk.CssProvider();let errors=0;
                p.connect("parsing-error",(_p,_s,e)=>{printerr(e.message);errors++});
                p.load_from_path(ARGV[0]);if(errors)imports.system.exit(1);''', str(root / f"{mode}.css")],
                           env=dict(os.environ, GTK_THEME="Adwaita"), check=True)

    bundle = root / "test.js"
    subprocess.run(["ags", "bundle", "tests/theme-transition.ts", str(bundle), "--gtk", "4"], cwd=project, check=True)
    encoded = bundle.read_text().split("<<EOF", 1)[1].split("\n", 1)[1].split("\nEOF", 1)[0]
    bundle.write_bytes(base64.b64decode(encoded))
    with socket.socket() as port:
        port.bind(("127.0.0.1", 0))
        number = port.getsockname()[1]
    # A unique display avoids interfering with another Broadway instance.
    display = f":{os.getpid() + 100}"
    server = subprocess.Popen(["gtk4-broadwayd", "--address=127.0.0.1", f"--port={number}", display],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    browser = None
    try:
        time.sleep(0.2)
        browser = subprocess.Popen([
            "chromium", "--headless", "--no-sandbox", "--disable-gpu", "--no-proxy-server",
            "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
            "--no-first-run", f"--user-data-dir={root / 'browser'}", f"http://127.0.0.1:{number}",
        ], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(0.8)
        env = dict(os.environ, GTK_THEME="Adwaita", GDK_BACKEND="broadway", BROADWAY_DISPLAY=display,
                   GSK_RENDERER="broadway", AGS_THEME_TEST_DIR=str(root),
                   LD_PRELOAD="/usr/lib/libgtk4-layer-shell.so")
        subprocess.run(["gjs", "-m", str(bundle)], env=env, check=True, timeout=10)
    finally:
        if browser:
            try:
                os.killpg(browser.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            browser.wait(timeout=5)
        server.terminate()
        server.wait(timeout=5)
