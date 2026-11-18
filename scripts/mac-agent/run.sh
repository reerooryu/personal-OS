#!/bin/bash
# launchd entry point for the ASCEND Mac helper. install.sh writes env.sh
# with the PATH your Terminal had (Homebrew, nvm), since launchd has none of it.
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
[ -f "$REPO/.sync/agent/env.sh" ] && source "$REPO/.sync/agent/env.sh"
exec node "$HERE/agent.mjs"
