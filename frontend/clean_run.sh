#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SCRIPT_DIR"

# ── Argument parsing ─────────────────────────────────────────────────────────
LOG_LEVEL="info"
DO_CLEAN=true
SKIP_INSTALL=false
SKIP_BUILD=false
TAURI_DEV_SCRIPT="${TAURI_DEV_SCRIPT:-tauri:dev}"
SKIP_PREWARM="${SKIP_PREWARM:-false}"
PRESTART_NEXT_DEV="${PRESTART_NEXT_DEV:-false}"
EXTRA_LOG_LINK_DIR="${EXTRA_LOG_LINK_DIR:-}"
NEXTJS_DEV_PID=""

usage() {
    echo "Usage: $0 [--log-level info|debug|trace] [--clean|--no-clean] [--no-install] [--no-build] [-h|--help]"
    echo ""
    echo "Options:"
    echo "  --log-level LEVEL   Set RUST_LOG level: info, debug, trace (default: info)"
    echo "  --clean             Delete .next/ and out/ before starting (default)"
    echo "  --no-clean          Keep .next/ and out/"
    echo "  --no-install        Skip pnpm install"
    echo "  --no-build          Skip llama-helper sidecar build"
    echo "  -h, --help          Show this help message"
    echo ""
    echo "Legacy positional: $0 [info|debug|trace]"
    exit 0
}

cleanup() {
    if [ -n "${NEXTJS_DEV_PID:-}" ]; then
        kill "${NEXTJS_DEV_PID}" 2>/dev/null || true
        wait "${NEXTJS_DEV_PID}" 2>/dev/null || true
    fi
}

trap cleanup EXIT

while [[ $# -gt 0 ]]; do
    case "$1" in
        --log-level)
            [[ ${2+x} ]] || { echo "Error: --log-level requires a value"; exit 1; }
            LOG_LEVEL="$2"; shift 2 ;;
        --clean)      DO_CLEAN=true; shift ;;
        --no-clean)   DO_CLEAN=false; shift ;;
        --no-install) SKIP_INSTALL=true; shift ;;
        --no-build)   SKIP_BUILD=true; shift ;;
        -h|--help)    usage ;;
        info|debug|trace) LOG_LEVEL="$1"; shift ;;  # legacy positional
        *) echo "Unknown argument: $1"; usage ;;
    esac
done

case "$LOG_LEVEL" in
    info|debug|trace) export RUST_LOG="$LOG_LEVEL" ;;
    *) echo "Invalid log level: $LOG_LEVEL. Valid options: info, debug, trace"; exit 1 ;;
esac

# ── Session logging ──────────────────────────────────────────────────────────
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"
RUN_LOG="$LOG_DIR/clean-run-$(date '+%Y%m%d-%H%M%S').log"
if [ -n "$EXTRA_LOG_LINK_DIR" ]; then
    mkdir -p "$EXTRA_LOG_LINK_DIR"
    ln -sfn "$RUN_LOG" "$EXTRA_LOG_LINK_DIR/clean-run-latest.log"
fi
exec > >(tee -a "$RUN_LOG") 2>&1

echo "Logging this run to: $RUN_LOG"
echo "Working directory: $SCRIPT_DIR"
echo "Workspace root: $WORKSPACE_ROOT"

# ── Preflight checks ─────────────────────────────────────────────────────────
# Cargo: try ~/.cargo/bin fallback before failing
if ! command -v cargo >/dev/null 2>&1; then
    if [ -x "$HOME/.cargo/bin/cargo" ]; then
        export PATH="$HOME/.cargo/bin:$PATH"
        echo "Cargo not found in PATH; using $HOME/.cargo/bin/cargo"
    else
        echo "Error: Cargo is required but was not found."
        echo "Install Rust/Cargo: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
        echo "Then run: source \"\$HOME/.cargo/env\""
        exit 1
    fi
fi

missing=()
for tool_hint in \
    "rustc:Install Rust via rustup: https://rustup.rs" \
    "pnpm:Install pnpm: npm install -g pnpm" \
    "node:Install Node.js: https://nodejs.org"; do
    tool="${tool_hint%%:*}"
    hint="${tool_hint#*:}"
    command -v "$tool" >/dev/null 2>&1 || missing+=("  $tool — $hint")
done
if [ ${#missing[@]} -gt 0 ]; then
    echo "Error: missing required tools:"
    printf '%s\n' "${missing[@]}"
    exit 1
fi

# ── llama-helper sidecar ─────────────────────────────────────────────────────
TARGET_TRIPLE="$(rustc -vV | awk '/^host:/ {print $2}')"
if [ -z "$TARGET_TRIPLE" ]; then
    echo "Error: could not determine target triple from rustc"
    exit 1
fi
LLAMA_BINARY="$SCRIPT_DIR/src-tauri/binaries/llama-helper-${TARGET_TRIPLE}"

if [ "$SKIP_BUILD" = false ]; then
    echo "Building llama-helper sidecar (incremental)..."
    (cd "$WORKSPACE_ROOT" && cargo build -p llama-helper)
    mkdir -p "$SCRIPT_DIR/src-tauri/binaries"
    cp "$WORKSPACE_ROOT/target/debug/llama-helper" "$LLAMA_BINARY"
    chmod +x "$LLAMA_BINARY"
fi

# ── Optional clean ────────────────────────────────────────────────────────────
if [ "$DO_CLEAN" = true ]; then
    echo "Cleaning build artifacts..."
    rm -rf "$SCRIPT_DIR/.next" "$SCRIPT_DIR/out"
fi

# ── Install dependencies ─────────────────────────────────────────────────────
if [ "$SKIP_INSTALL" = false ]; then
    lockfile="$SCRIPT_DIR/pnpm-lock.yaml"
    node_modules="$SCRIPT_DIR/node_modules"
    if [ ! -d "$node_modules" ] || [ "$lockfile" -nt "$node_modules" ]; then
        echo "Installing dependencies..."
        pnpm install --frozen-lockfile
    else
        echo "Dependencies up to date, skipping install."
    fi
fi

wait_for_http() {
    local url="$1"
    local max_wait="$2"
    local waited=0

    until curl -sf --max-time 2 "$url" > /dev/null 2>&1; do
        sleep 1
        waited=$((waited + 1))
        if [ "$waited" -ge "$max_wait" ]; then
            return 1
        fi
    done

    return 0
}

if [ "$PRESTART_NEXT_DEV" = true ]; then
    if wait_for_http "http://localhost:3118/" 1; then
        echo "Reusing existing Next.js dev server on port 3118"
    else
        NEXT_DEV_LOG="$LOG_DIR/next-dev-$(date '+%Y%m%d-%H%M%S').log"
        if [ -n "$EXTRA_LOG_LINK_DIR" ]; then
            ln -sfn "$NEXT_DEV_LOG" "$EXTRA_LOG_LINK_DIR/next-dev-latest.log"
        fi
        echo "Starting external Next.js dev server (log: $NEXT_DEV_LOG)..."
        pnpm dev > "$NEXT_DEV_LOG" 2>&1 &
        NEXTJS_DEV_PID=$!

        if ! wait_for_http "http://localhost:3118/" 120; then
            echo "Error: external Next.js dev server did not start within 120s"
            exit 1
        fi

        if ! wait_for_http "http://localhost:3118/_next/static/chunks/app/layout.js" 120; then
            echo "Error: app/layout.js did not become available within 120s"
            exit 1
        fi

        echo "External Next.js dev server ready"
    fi
fi

# ── Pre-warm Next.js ──────────────────────────────────────────────────────────
# Start Next.js, wait for the home page to actually compile into .next/ cache,
# then stop it. Tauri's own Next.js instance reuses the cache and serves
# instantly — preventing the ChunkLoadError on first webview load.
if [ "$PRESTART_NEXT_DEV" = true ]; then
    echo "Skipping Next.js pre-warm (PRESTART_NEXT_DEV=true)"
elif [ "$SKIP_PREWARM" = true ]; then
    echo "Skipping Next.js pre-warm (SKIP_PREWARM=true)"
elif ! command -v curl >/dev/null 2>&1; then
    echo "Skipping Next.js pre-warm (requires curl in PATH)"
elif ! wait_for_http "http://localhost:3118/" 1; then
    echo "Pre-warming Next.js (compiling home page into .next/ cache)..."
    pnpm dev > /dev/null 2>&1 &
    NEXTJS_PREWARM_PID=$!
    MAX_WAIT=120

    if ! wait_for_http "http://localhost:3118/" "$MAX_WAIT"; then
        echo "Warning: Next.js pre-warm timed out waiting for '/' after ${MAX_WAIT}s, continuing anyway"
    elif ! wait_for_http "http://localhost:3118/_next/static/chunks/app/layout.js" "$MAX_WAIT"; then
        echo "Warning: Next.js pre-warm timed out waiting for app/layout.js after ${MAX_WAIT}s, continuing anyway"
    else
        echo "Pre-warm complete — home page and app/layout.js are ready"
    fi

    kill $NEXTJS_PREWARM_PID 2>/dev/null
    wait $NEXTJS_PREWARM_PID 2>/dev/null || true
    sleep 1
else
    echo "Next.js is already responding on port 3118, skipping pre-warm"
fi

# ── Launch ────────────────────────────────────────────────────────────────────
echo "Building Tauri app..."
pnpm run "$TAURI_DEV_SCRIPT"
