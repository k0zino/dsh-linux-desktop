#!/bin/sh
# Snap confinement supplies the application sandbox; Chromium's setuid helper is absent.
export TMPDIR="${XDG_RUNTIME_DIR:-$SNAP_USER_DATA}"
export FONTCONFIG_PATH="${FONTCONFIG_PATH:-$SNAP/etc/fonts}"
export FONTCONFIG_FILE="${FONTCONFIG_FILE:-$SNAP/etc/fonts/fonts.conf}"
export GSETTINGS_SCHEMA_DIR="${GSETTINGS_SCHEMA_DIR:-$SNAP/usr/share/glib-2.0/schemas}"
export XKB_CONFIG_ROOT="${XKB_CONFIG_ROOT:-$SNAP/usr/share/X11/xkb}"
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

# GDK needs a loader cache whose paths point into this snap revision.
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$SNAP_USER_COMMON/.cache}"
mkdir -p "$XDG_CACHE_HOME"
if [ -d "$SNAP/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders" ]; then
  export GDK_PIXBUF_MODULEDIR="$SNAP/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/2.10.0/loaders"
  export GDK_PIXBUF_MODULE_FILE="$XDG_CACHE_HOME/gdk-pixbuf-loaders.cache"
  if [ -x "$SNAP/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/gdk-pixbuf-query-loaders" ]; then
    "$SNAP/usr/lib/x86_64-linux-gnu/gdk-pixbuf-2.0/gdk-pixbuf-query-loaders" > "$GDK_PIXBUF_MODULE_FILE" 2>/dev/null || true
  fi
fi

if [ "${DISABLE_WAYLAND:-}" = "1" ] && [ -n "${DISPLAY:-}" ]; then
  exec "$SNAP/app/deepseek-harness" --no-sandbox --ozone-platform=x11 "$@"
fi
if [ "${XDG_SESSION_TYPE:-}" = "wayland" ] && [ -S "$XDG_RUNTIME_DIR/${WAYLAND_DISPLAY:-wayland-0}" ]; then
  exec "$SNAP/app/deepseek-harness" --no-sandbox --ozone-platform=wayland "$@"
fi
if [ -n "${DISPLAY:-}" ]; then
  exec "$SNAP/app/deepseek-harness" --no-sandbox --ozone-platform=x11 "$@"
fi
exec "$SNAP/app/deepseek-harness" --no-sandbox "$@"
