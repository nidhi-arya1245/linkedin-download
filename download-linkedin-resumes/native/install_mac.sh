#!/bin/bash
# One-time setup: lets the extension press Tab, Tab, Enter in Chrome's native Drive dialog.
set -e
EXT_ID="gjajhacfjnmidnpdiemhhbjkdgbkplml"
HOST_NAME="com.download_linkedin_resumes.keys"
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.download-linkedin-resumes"
mkdir -p "$DEST"
PROJECT="$(cd "$SRC/.." && pwd)"
LOGDIR="$PROJECT/logs"
mkdir -p "$LOGDIR"
printf 'LOG_DIR="%s"\n' "$LOGDIR" > "$DEST/config.sh"
cp "$SRC/keys_host.sh" "$DEST/keys_host.sh"
cp "$SRC/key_watcher.sh" "$DEST/key_watcher.sh"
chmod +x "$DEST/keys_host.sh" "$DEST/key_watcher.sh"

INSTALLED=0
xattr -d com.apple.quarantine "$DEST/keys_host.sh" "$DEST/key_watcher.sh" 2>/dev/null || true
for B in "Google/Chrome" "Google/Chrome Beta" "Google/Chrome Canary" "Chromium" "BraveSoftware/Brave-Browser" "Microsoft Edge" "Vivaldi" "Arc/User Data"; do
  BASE="$HOME/Library/Application Support/$B"
  [ -d "$BASE" ] || continue
  mkdir -p "$BASE/NativeMessagingHosts"
  cat > "$BASE/NativeMessagingHosts/$HOST_NAME.json" <<JSON
{
  "name": "$HOST_NAME",
  "description": "Presses Tab, Tab, Enter for download-linkedin-resumes",
  "path": "$DEST/keys_host.sh",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON
  echo "Installed for: $B"
  echo "   -> $BASE/NativeMessagingHosts/$HOST_NAME.json"
  INSTALLED=1
done
if [ "$INSTALLED" -eq 0 ]; then
  echo
  echo "!! No supported browser folder found under: $HOME/Library/Application Support"
  echo "!! Nothing was registered. Run this script as your normal user (NOT with sudo)."
  exit 1
fi
if [ "$(id -u)" -eq 0 ]; then
  echo "!! Warning: you ran this as root. Chrome looks in YOUR home folder, not root's. Re-run without sudo."
fi
echo
echo "Logs are saved in: $LOGDIR/download-linkedin-resumes.log"
echo
echo "Done. To press keys, start the watcher in a Terminal window and leave it open:"
echo "    bash $DEST/key_watcher.sh"
echo "macOS will ask to let Terminal control your computer: allow it"
echo "(System Settings > Privacy & Security > Accessibility > Terminal ON)."
