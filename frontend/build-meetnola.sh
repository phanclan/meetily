#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export TAURI_BUILD_SCRIPT="tauri:build:meetnola"
export NEXT_PUBLIC_FLAVOR="${NEXT_PUBLIC_FLAVOR:-meetnola}"

./build-gpu.sh "$@"
