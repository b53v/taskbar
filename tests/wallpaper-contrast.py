#!/usr/bin/env python3
"""Synthetic wallpapers only: do not regenerate the user's live theme."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

analyzer = Path(__file__).resolve().parents[2] / "hypr/scripts/ags_wallpaper_contrast.py"
spec = importlib.util.spec_from_file_location("contrast", analyzer)
contrast = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contrast)


class WallpaperContrastTests(unittest.TestCase):
    def test_uniform(self):
        for value, mode in ((0, "dark"), (255, "light"), (55, "dark"), (205, "light")):
            result = contrast.analyze(bytes([value] * 192 * 12 * 3))
            self.assertEqual(result["mode"], mode)
            self.assertFalse(result["mixed"])

    def test_alternating(self):
        for pixel in (lambda x: 255 if x % 2 else 0,
                      lambda x: 255 if x >= 96 else 0):
            result = contrast.analyze(bytes(value for _ in range(12)
                                            for x in range(192) for value in [pixel(x)] * 3))
            self.assertTrue(result["mixed"])

    def test_manual_and_dynamic(self):
        pixels = bytes([255] * 192 * 12 * 3)
        self.assertEqual(contrast.analyze(pixels, mode="dark")["mode"], "dark")
        self.assertTrue(contrast.analyze(pixels, dynamic=True)["mixed"])

    def test_hysteresis(self):
        near_boundary = bytes([122] * 192 * 12 * 3)
        for previous in ("light", "dark"):
            self.assertEqual(contrast.analyze(near_boundary, previous=previous)["mode"], previous)

    def test_image_decode_and_atomic_output(self):
        with tempfile.TemporaryDirectory(prefix="ags-contrast-", dir="/tmp/opencode") as temporary:
            root = Path(temporary)
            image = root / "black white.png"
            subprocess.run(["magick", "-size", "400x100", "xc:black", "-fill", "white",
                            "-draw", "rectangle 200,0 399,99", str(image)], check=True)
            output = root / "_wallpaper-contrast.scss"
            command = ["python3", str(analyzer), str(image), "--output", str(output)]
            result = json.loads(subprocess.check_output(command, text=True))
            self.assertTrue(result["mixed"])
            self.assertIn("$barMixedBackdrop: true;", output.read_text())
            mtime = output.stat().st_mtime_ns
            subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
            self.assertEqual(output.stat().st_mtime_ns, mtime, "identical analysis rewrites SCSS")

    def test_shell_integration(self):
        with tempfile.TemporaryDirectory(prefix="ags-contrast-shell-", dir="/tmp/opencode") as temporary:
            root = Path(temporary)
            image = root / "wall paper.png"
            subprocess.run(["magick", "-size", "400x100", "xc:white", str(image)], check=True)
            binary = root / "bin"
            binary.mkdir()
            # Never call the live AGS or regenerate actual Matugen templates.
            for command in ("ags", "matugen"):
                executable = binary / command
                executable.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_CALLS"\n')
                executable.chmod(0o755)
            env = dict(os.environ, HOME=str(root), XDG_CONFIG_HOME=str(root / "config"),
                       XDG_CACHE_HOME=str(root / "cache"), PATH=f"{binary}:{os.environ['PATH']}",
                       TEST_CALLS=str(root / "calls"))
            subprocess.run(["bash", str(analyzer.with_name("AgsWallpaperTheme.sh")), str(image)], env=env, check=True)
            calls = (root / "calls").read_text()
            self.assertIn("-m light --source-color-index 0 image", calls)
            self.assertIn("request -i taskbar reload-css", calls)
            output = root / "config/ags/style/abstracts/_wallpaper-contrast.scss"
            self.assertIn("$barMixedBackdrop: false;", output.read_text())


if __name__ == "__main__":
    unittest.main()
