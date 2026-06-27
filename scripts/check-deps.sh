#!/usr/bin/env bash
# Verifies every external dependency the Stream Clipper pipeline needs.
# Run from the project root: ./scripts/check-deps.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT/apps/web"
API_DIR="$ROOT/apps/api"

ok=0
warn=0
fail=0
fix=()

note_ok()   { printf "  \033[32m✓\033[0m  %s\n" "$1"; ok=$((ok+1)); }
note_warn() { printf "  \033[33m!\033[0m  %s\n" "$1"; warn=$((warn+1)); }
note_fail() { printf "  \033[31m✗\033[0m  %s\n" "$1"; fail=$((fail+1)); }

section() { printf "\n\033[1m▶ %s\033[0m\n" "$1"; }

# ---- Node ----
section "Node.js"
if command -v node >/dev/null 2>&1; then
  ver=$(node -p "process.versions.node")
  note_ok "node $ver"
else
  note_fail "node not found in PATH — install Node.js 20+"
fi

# ---- pnpm/npm ----
section "Package manager"
if command -v pnpm >/dev/null 2>&1; then
  note_ok "pnpm $(pnpm -v)"
elif command -v npm >/dev/null 2>&1; then
  note_ok "npm $(npm -v)"
else
  note_fail "npm or pnpm not found"
fi

# ---- Python ----
section "Python 3 (for chat-downloader & FastAPI)"
if command -v python3 >/dev/null 2>&1; then
  ver=$(python3 -c "import sys; print('.'.join(map(str, sys.version_info[:3])))")
  note_ok "python3 $ver"
else
  note_fail "python3 not found"
fi

# ---- FFmpeg / FFprobe ----
section "FFmpeg"
if command -v ffmpeg >/dev/null 2>&1; then
  note_ok "ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"
else
  note_fail "ffmpeg not found — install with: sudo apt install ffmpeg"
fi
if command -v ffprobe >/dev/null 2>&1; then
  note_ok "ffprobe present"
else
  note_fail "ffprobe not found (usually ships with ffmpeg)"
fi

# ---- yt-dlp ----
section "yt-dlp"
if command -v yt-dlp >/dev/null 2>&1; then
  if yt-dlp --version >/dev/null 2>&1; then
    note_ok "yt-dlp $(yt-dlp --version 2>/dev/null | head -1)"
  else
    note_warn "yt-dlp present but 'yt-dlp --version' errors — still works for downloads"
  fi
else
  note_fail "yt-dlp not found — install with: pipx install yt-dlp  (or: pip install yt-dlp)"
fi

# ---- chat-downloader (Python) ----
section "chat-downloader (Python package)"
if [ -d "$API_DIR/.venv" ]; then
  if "$API_DIR/.venv/bin/python" -c "import chat_downloader" 2>/dev/null; then
    note_ok "chat-downloader installed in apps/api/.venv"
  else
    note_fail "apps/api/.venv exists but chat_downloader import failed"
    fix+=("cd apps/api && source .venv/bin/activate && pip install chat-downloader")
  fi
else
  if python3 -c "import chat_downloader" 2>/dev/null; then
    note_ok "chat-downloader importable from system python3"
  else
    note_warn "chat-downloader not importable; chat fetch will fail"
    fix+=("cd apps/api && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt")
  fi
fi

# ---- faster-whisper / FastAPI ----
section "FastAPI transcription backend"
if [ -d "$API_DIR/.venv" ]; then
  if "$API_DIR/.venv/bin/python" -c "import fastapi, faster_whisper" 2>/dev/null; then
    note_ok "fastapi + faster-whisper installed in apps/api/.venv"
    if curl -s --max-time 2 "http://127.0.0.1:8000/api/transcription/health" 2>/dev/null | grep -q '"available":true'; then
      note_ok "FastAPI backend already running on :8000"
    else
      note_warn "FastAPI not running — start with: cd apps/api && source .venv/bin/activate && uvicorn app.main:app --host 127.0.0.1 --port 8000"
      fix+=("cd apps/api && source .venv/bin/activate && nohup uvicorn app.main:app --host 127.0.0.1 --port 8000 > /tmp/fastapi.log 2>&1 &")
    fi
  else
    note_fail "apps/api/.venv exists but fastapi/faster_whisper import failed"
    fix+=("cd apps/api && source .venv/bin/activate && pip install -r requirements.txt")
  fi
else
  note_warn "apps/api/.venv missing — install with: cd apps/api && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
fi

# ---- Web build cache ----
section "Web build"
if [ -d "$WEB_DIR/node_modules" ]; then
  note_ok "node_modules present"
else
  note_warn "node_modules missing — run: cd apps/web && npm install"
  fix+=("cd apps/web && npm install")
fi

# ---- Playwright (optional) ----
section "Playwright (optional, for E2E tests)"
if [ -d "$ROOT/node_modules/playwright" ]; then
  note_ok "playwright installed"
  if [ -d "/home/tt/.cache/ms-playwright/chromium-1228" ]; then
    note_ok "chromium browser cache present"
  else
    note_warn "chromium not installed — run: npx playwright install chromium"
  fi
else
  note_warn "playwright not installed — only required for the modal regression test"
  fix+=("npm install -D playwright @playwright/test && npx playwright install chromium")
fi

# ---- Summary ----
section "Summary"
printf "  \033[32m%d ok\033[0m, \033[33m%d warn\033[0m, \033[31m%d fail\033[0m\n" "$ok" "$warn" "$fail"

if [ ${#fix[@]} -gt 0 ]; then
  printf "\n\033[1m▶ Suggested fixes\033[0m\n"
  for cmd in "${fix[@]}"; do
    printf "    %s\n" "$cmd"
  done
fi

[ "$fail" -eq 0 ] && exit 0 || exit 1
