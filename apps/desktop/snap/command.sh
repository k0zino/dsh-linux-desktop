#!/bin/sh
# Snap confinement supplies the application sandbox; Chromium's setuid helper is absent.
export TMPDIR="${XDG_RUNTIME_DIR:-$SNAP_USER_DATA}"
exec "$SNAP/app/deepseek-harness" --no-sandbox --ozone-platform-hint=auto "$@"
