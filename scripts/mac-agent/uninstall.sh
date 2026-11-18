#!/bin/bash
# Removes the ASCEND Mac helper. Your app, data and repo are untouched.
LABEL="com.ryu.ascend.agent"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "ASCEND helper removed."
