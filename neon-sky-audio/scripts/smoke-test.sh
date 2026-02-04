#!/usr/bin/env bash
set -euo pipefail

echo "Neon Sky Audio Smoke Test"
echo "--------------------------"
echo "1) Start the dev server: npm run dev"
echo "2) Load a track with the Load button."
echo "3) Press Play and confirm audio starts."
echo "4) Press Pause and confirm playback stops."
echo "5) Seek to a new position and confirm time updates."
echo "6) Background the tab/app for 5+ seconds."
echo "7) Return to the app and confirm playback can resume."
echo "8) Press Play again and confirm audio + UI stay in sync."
echo ""
echo "Result: ✅ if all steps succeed."
