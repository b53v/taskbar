#!/usr/bin/env python3
"""Bundle and run GJS regressions without touching the live config/cache."""
import os
import base64
from pathlib import Path
import subprocess
import tempfile

project = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="ags-test-", dir="/tmp/opencode") as temporary:
    root = Path(temporary)
    config = root / "config" / "ags"
    config.mkdir(parents=True)
    (config / "config.json").write_text("{}")
    (root / "cache").mkdir()
    bundle = root / "regressions.js"
    subprocess.run(
        ["ags", "bundle", "tests/regressions.tsx", str(bundle), "--gtk", "4"],
        cwd=project, check=True,
    )
    env = dict(os.environ, XDG_CONFIG_HOME=str(root / "config"), XDG_CACHE_HOME=str(root / "cache"), GTK_THEME="Adwaita")
    # `ags bundle` emits a shell launcher with an embedded base64 module.
    # Decode it here rather than executing the launcher in the live runtime dir.
    encoded = bundle.read_text().split("<<EOF", 1)[1].split("\n", 1)[1].split("\nEOF", 1)[0]
    bundle.write_bytes(base64.b64decode(encoded))
    env["LD_PRELOAD"] = "/usr/lib/libgtk4-layer-shell.so"
    subprocess.run(["gjs", "-m", str(bundle)], cwd=project, env=env, check=True, timeout=30)
