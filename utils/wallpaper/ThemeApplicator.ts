import GLib from "gi://GLib";
import { execAsync } from "ags/process";
import type { ThemeProperties } from "./types";

export class ThemeApplicator {
  async applyTheme(
    imagePath: string,
    analysis: ThemeProperties,
  ): Promise<void> {
    await Promise.all([this.applyMatugen(imagePath, analysis)]);

    this.sendNotification(imagePath, analysis).catch((error) => {
      console.warn("Failed to send theme notification:", error);
    });
  }

  private async applyMatugen(
    imagePath: string,
    analysis: ThemeProperties,
  ): Promise<void> {
    const matugen = GLib.find_program_in_path("matugen");
    if (!matugen) {
      console.warn("matugen not found, skipping color theme generation");
      return;
    }

    try {
      // The built-in picker must use the same local-contrast decision as the
      // external selector. Explicit light/dark choices remain authoritative.
      let mode = analysis.mode;
      const analyzer = `${GLib.get_user_config_dir()}/hypr/scripts/ags_wallpaper_contrast.py`;
      if (GLib.file_test(analyzer, GLib.FileTest.EXISTS)) {
        try {
          const result = JSON.parse(await execAsync([
            "python3", analyzer, imagePath, "--mode", mode,
            "--output", `${GLib.get_user_config_dir()}/ags/style/abstracts/_wallpaper-contrast.scss`,
          ]));
          mode = result.mode;
        } catch (error) {
          console.warn("Wallpaper contrast analysis failed; using requested mode:", error);
        }
      }
      await execAsync([
        matugen,
        "-t",
        analysis.scheme,
        "-m",
        mode,
        "--source-color-index",
        "0",
        "image",
        imagePath,
      ]);
    } catch (error) {
      console.error("Failed to run matugen:", error);
      throw error;
    }
  }

  private async sendNotification(
    imagePath: string,
    analysis: ThemeProperties,
  ): Promise<void> {
    const notifySend = GLib.find_program_in_path("notify-send");
    if (!notifySend) return;

    const basename = GLib.path_get_basename(imagePath);
    const message = `Theme: ${analysis.mode} ${analysis.scheme}`;

    execAsync(
      `${notifySend} "Colors and Wallpaper updated" "Image: ${basename}\n${message}"`,
    );
  }
}
