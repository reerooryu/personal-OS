#!/bin/bash
# One-time setup for the ASCEND Mac helper. Run it from Terminal:
#   bash ~/"Personal OS"/scripts/mac-agent/install.sh
# Safe to run again (after moving the app, or updating Node).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL="com.ryu.ascend.agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BASE="$REPO/.sync/agent"

need() { command -v "$1" >/dev/null || { echo "Can't find $1 on your PATH. Open a new Terminal window and try again."; exit 1; }; }
need node; need npm; need git
[ -x /usr/bin/sqlite3 ] || { echo "Can't find /usr/bin/sqlite3"; exit 1; }

APP="/Applications/ASCEND.app"
for p in "/Applications/ASCEND.app" "$HOME/Applications/ASCEND.app"; do [ -d "$p" ] && { APP="$p"; break; }; done

mkdir -p "$BASE"/{requests,results,logs,out,done} "$HOME/Library/LaunchAgents"
PATHS="$(dirname "$(command -v node)"):$(dirname "$(command -v npm)"):$(dirname "$(command -v git)")"
cat > "$BASE/env.sh" <<ENV
export PATH="$PATHS:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export ASCEND_REPO="$REPO"
export ASCEND_APP="$APP"
ENV

xml() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$(xml "$REPO/scripts/mac-agent/run.sh")</string></array>
  <key>WatchPaths</key>
  <array><string>$(xml "$BASE/requests")</string></array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$(xml "$BASE/launchd.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$BASE/launchd.log")</string>
</dict>
</plist>
PL

# Check it works: ask for a status report (before starting, so it goes first) and wait for the answer.
ID="install-$(date +%s)"
echo "{\"id\":\"$ID\",\"action\":\"status\"}" > "$BASE/requests/$ID.json"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
for i in $(seq 1 30); do
  if grep -q '"state": "ok"' "$BASE/results/$ID.json" 2>/dev/null; then
    echo "ASCEND helper installed and running."
    echo "  App:  $APP"
    echo "  Node: $(node -v)"
    echo "It runs builds, installs and commits when Claude asks. It never pushes: git push stays with you."
    ls "$BASE/requests"/*.json >/dev/null 2>&1 && echo "A queued update is now building in the background. You'll get a notification when it's done."
    exit 0
  fi
  sleep 1
done
echo "Installed, but no answer yet. Log: $BASE/launchd.log"
exit 1
