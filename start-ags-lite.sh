#!/usr/bin/env bash
set -euo pipefail

AGS_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/ags"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
OUT_JS="$RUNTIME_DIR/ags.js"

needs_bundle=0
if [[ ! -s "$OUT_JS" ]]; then
  needs_bundle=1
elif [[ -n "$(find "$AGS_DIR" -maxdepth 4 \
  \( -path "$AGS_DIR/backup-*" -o -name '.git' -o -name 'node_modules' \) -prune \
  -o \( -name '*.ts' -o -name '*.tsx' -o -name 'tsconfig.json' \) -newer "$OUT_JS" -print -quit)" ]]; then
  needs_bundle=1
fi

if [[ "$needs_bundle" -eq 1 ]]; then
  TMP_BUNDLE="$(mktemp "$RUNTIME_DIR/ags-bundle.XXXXXX")"
  TMP_JS="$(mktemp "$RUNTIME_DIR/ags.js.XXXXXX")"
  cleanup() {
    rm -f "$TMP_BUNDLE" "$TMP_JS"
  }
  trap cleanup EXIT

  (
    cd "$AGS_DIR"
    ags bundle app.ts "$TMP_BUNDLE"
  )
  awk '/^\/bin\/cat <<.*EOF/{flag=1; next} /^EOF$/{flag=0} flag' "$TMP_BUNDLE" | base64 -d > "$TMP_JS"
  if [[ ! -s "$TMP_JS" ]]; then
    echo "Failed to extract bundled JS from $TMP_BUNDLE" >&2
    exit 1
  fi
  mv -f "$TMP_JS" "$OUT_JS"
  rm -f "$TMP_BUNDLE"
  trap - EXIT
fi

export GSK_RENDERER=cairo
export LD_PRELOAD="/usr/lib/libgtk4-layer-shell.so${LD_PRELOAD:+:$LD_PRELOAD}"

cd "$AGS_DIR"
exec /usr/bin/gjs -m "$OUT_JS" "$@"
