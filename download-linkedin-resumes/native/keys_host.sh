#!/bin/bash
# Native messaging host for download-linkedin-resumes (macOS).
# Presses Tab, Tab, Enter at OS level so Chrome's own "Choose your account" dialog gets the keys.

DIR="$HOME/.download-linkedin-resumes"
[ -f "$DIR/config.sh" ] && . "$DIR/config.sh"        # sets LOG_DIR = <project>/logs
LOG_DIR="${LOG_DIR:-$DIR}"
LOG="$LOG_DIR/download-linkedin-resumes.log"
log() {
  mkdir -p "$LOG_DIR" 2>/dev/null
  printf '%s  [helper] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG" 2>/dev/null \
    || printf '%s  [helper] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$DIR/fallback.log"
}

reply() { # reply '<json>'  -> writes the 4-byte little-endian length header + the JSON
  local msg="$1" n=${#1}
  printf "$(printf '\\x%02x\\x%02x\\x%02x\\x%02x' $((n & 255)) $(((n >> 8) & 255)) 0 0)"
  printf '%s' "$msg"
}

# read the request: 4-byte length + JSON body (dd reads exact byte counts)
len=$(dd bs=1 count=4 2>/dev/null | od -An -tu4 | tr -d ' ')
body=""
if [ -n "$len" ] && [ "$len" -gt 0 ] 2>/dev/null; then body=$(dd bs=1 count="$len" 2>/dev/null); fi

# {"action":"log","line":"..."}  ->  append the extension's log line to the project log
case "$body" in
  *'"action":"log"'*)
    line=$(printf '%s' "$body" | sed -n 's/.*"line":"\(.*\)".*/\1/p')
    printf '%s  [ext] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$line" >> "$LOG" 2>/dev/null
    reply '{"ok":true}'
    exit 0;;
esac

log 'key press requested by extension'
mtime() { local m; m=$(stat -f %m "$1" 2>/dev/null); case "$m" in ''|*[!0-9]*) m=$(stat -c %Y "$1" 2>/dev/null);; esac; echo "${m:-0}"; }

# Preferred: ask the Terminal key-watcher (it has Accessibility permission) to press the keys
if [ -f "$DIR/watcher.alive" ] && [ $(( $(date +%s) - $(mtime "$DIR/watcher.alive") )) -le 5 ]; then
  log 'watcher is running, delegating key press'
  rm -f "$DIR/press.done"
  touch "$DIR/press.request"
  for i in $(seq 1 50); do [ -f "$DIR/press.done" ] && break; sleep 0.2; done
  if [ -f "$DIR/press.done" ]; then
    res=$(cat "$DIR/press.done"); rm -f "$DIR/press.done"
    if [ "$res" = "ok" ]; then reply '{"ok":true}'; else reply "{\"ok\":false,\"error\":\"watcher: $res\"}"; fi
  else
    log 'watcher did not answer in 10s'
    reply '{"ok":false,"error":"watcher did not answer"}'
  fi
  exit 0
fi

# Fallback: try directly (needs Accessibility permission for the app that launched this helper)
log 'watcher not running, trying osascript directly'
err=$(osascript 2>&1 <<'OSA'
tell application "System Events"
  key code 48
  delay 0.4
  key code 48
  delay 0.4
  key code 36
end tell
OSA
)
status=$?
if [ $status -eq 0 ]; then
  log 'Tab, Tab, Enter sent OK'
  reply '{"ok":true}'
else
  log "FAILED (exit $status): $err"
  clean=$(printf '%s' "$err" | tr -d '"\\\n\r' | cut -c1-100)
  reply "{\"ok\":false,\"error\":\"KEY WATCHER NOT RUNNING - start it in Terminal: bash ~/.download-linkedin-resumes/key_watcher.sh (direct attempt failed: $clean)\"}"
fi
