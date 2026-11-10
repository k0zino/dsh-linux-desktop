#!/bin/sh
# Snap confinement supplies the application sandbox; Chromium's setuid helper is absent.
export TMPDIR="${XDG_RUNTIME_DIR:-$SNAP_USER_DATA}"
export GBM_BACKENDS_PATH="${GBM_BACKENDS_PATH:-$SNAP/usr/lib/x86_64-linux-gnu/gbm}"
export LIBGL_DRIVERS_PATH="${LIBGL_DRIVERS_PATH:-$SNAP/usr/lib/x86_64-linux-gnu/dri:$SNAP/usr/lib/x86_64-linux-gnu/gbm}"

# Snapd keeps XDG_RUNTIME_DIR private. Expose the host Wayland socket the same
# way the desktop-launch helpers do, then prefer Wayland when it is reachable.
if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -n "${WAYLAND_DISPLAY:-}" ]; then
  case "$WAYLAND_DISPLAY" in
    */*) ;;
    *)
      wayland_socket="$XDG_RUNTIME_DIR/../$WAYLAND_DISPLAY"
      wayland_link="$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY"
      if [ -S "$wayland_socket" ] && [ ! -e "$wayland_link" ]; then
        ln -s "$wayland_socket" "$wayland_link" 2>/dev/null || true
      fi
      ;;
  esac
fi

if [ "${XDG_SESSION_TYPE:-}" = "wayland" ] && [ -S "$XDG_RUNTIME_DIR/${WAYLAND_DISPLAY:-wayland-0}" ]; then
  exec "$SNAP/app/deepseek-harness" --no-sandbox --ozone-platform=wayland "$@"
fi
if [ -n "${DISPLAY:-}" ]; then
  exec "$SNAP/app/deepseek-harness" --no-sandbox --ozone-platform=x11 "$@"
fi
exec "$SNAP/app/deepseek-harness" --no-sandbox "$@"
