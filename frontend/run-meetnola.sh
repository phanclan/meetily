#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

TMP_LOG_DIR="${TMP_LOG_DIR:-/tmp/meetnola}"
TESTER_APP_SUPPORT_DIR="$HOME/Library/Application Support/com.meetnola.tester"

mkdir -p "$TMP_LOG_DIR"
mkdir -p "$TESTER_APP_SUPPORT_DIR/logs"

ln -sfn "$TESTER_APP_SUPPORT_DIR/logs" "$TMP_LOG_DIR/app-logs"
ln -sfn "$TESTER_APP_SUPPORT_DIR" "$TMP_LOG_DIR/app-support"

export EXTRA_LOG_LINK_DIR="$TMP_LOG_DIR"
export PRESTART_NEXT_DEV="true"
export TAURI_DEV_SCRIPT="tauri:dev:meetnola:attach"
export NEXT_PUBLIC_FLAVOR="${NEXT_PUBLIC_FLAVOR:-meetnola}"

./clean_run.sh "$@"
