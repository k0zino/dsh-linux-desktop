#!/bin/sh
# Classic snap: the host desktop stack is available; only bridge the
# snap-private runtime directory when snapd provides one.
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

gpu_flag=""
if [ "${DSH_SNAP_DISABLE_GPU:-}" = "1" ]; then
  gpu_flag="--disable-gpu"
fi

if [ "${XDG_SESSION_TYPE:-}" = "wayland" ] && [ -S "$XDG_RUNTIME_DIR/${WAYLAND_DISPLAY:-wayland-0}" ]; then
  exec "$SNAP/app/deepseek-harness" --no-sandbox $gpu_flag \
    --ozone-platform=wayland --enable-features=WaylandWindowDecorations "$@"
fi
if [ -n "${DISPLAY:-}" ]; then
  exec "$SNAP/app/deepseek-harness" --no-sandbox $gpu_flag --ozone-platform=x11 "$@"
fi
exec "$SNAP/app/deepseek-harness" --no-sandbox $gpu_flag "$@"
