#!/bin/bash
# Run this in a Terminal window and leave it open while downloading.
# It presses Tab, Tab, Enter when the extension asks (Terminal's Accessibility permission is used).
DIR="$HOME/.download-linkedin-resumes"
[ -f "$DIR/config.sh" ] && . "$DIR/config.sh"        # sets LOG_DIR = <project>/logs
LOG_DIR="${LOG_DIR:-$DIR}"
FINAL_KEYS="${FINAL_KEYS:-return space}"
LOG="$LOG_DIR/download-linkedin-resumes.log"
mkdir -p "$DIR" "$LOG_DIR"
rm -f "$DIR/press.request" "$DIR/press.done"
log() { printf '%s  [watcher] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG" 2>/dev/null; }
echo "Key watcher running. Keep this window open. Press Ctrl+C to stop."
echo "Log file: $LOG"
log "watcher started (keys after Tab,Tab: $FINAL_KEYS)"
trap 'rm -f "$DIR/watcher.alive"; log "watcher stopped"; exit 0' INT TERM
while true; do
  touch "$DIR/watcher.alive"
  if [ -f "$DIR/press.request" ]; then
    rm -f "$DIR/press.request"
    # Tab, Tab, then the final key(s). FINAL_KEYS can be changed in ~/.download-linkedin-resumes/config.sh
    # (words: return, enter, space). Default presses Return, then Space half a second later.
    script='tell application "System Events"
  key code 48
  delay 0.4
  key code 48
  delay 0.4'
    for k in $FINAL_KEYS; do
      case "$k" in
        return) code=36 ;;
        enter)  code=76 ;;
        space)  code=49 ;;
        *) continue ;;
      esac
      script="$script
  key code $code
  delay 0.5"
    done
    script="$script
end tell"
    err=$(osascript 2>&1 <<<"$script")
    if [ $? -eq 0 ]; then
      log "Tab, Tab, $FINAL_KEYS sent OK"; echo "$(date '+%H:%M:%S') keys sent"; echo ok > "$DIR/press.done"
    else
      log "FAILED: $err"; echo "$(date '+%H:%M:%S') FAILED: $err"
      printf '%s' "$err" | tr -d '"\\\n\r' | cut -c1-160 > "$DIR/press.done"
    fi
  fi
  sleep 0.3
done
