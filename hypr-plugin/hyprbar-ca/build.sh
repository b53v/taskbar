#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${SCRIPT_DIR}/main.cpp"
OUT="${SCRIPT_DIR}/hyprbar-ca-v2.so"
TMP_OUT="${OUT}.tmp"

CFLAGS="$(pkg-config --cflags hyprland glesv2)"

echo "[hyprbar-ca] Building ${OUT} against Hyprland $(pkg-config --modversion hyprland)..."
g++ -shared -fPIC -O2 -std=gnu++23 -fno-gnu-unique -Wall -Wextra -Wno-unused-parameter \
    ${CFLAGS} \
    "${SRC}" -o "${TMP_OUT}" -lGLESv2

mv -f "${TMP_OUT}" "${OUT}"
echo "[hyprbar-ca] Built successfully: ${OUT}"
