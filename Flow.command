#!/bin/bash
# Double-click to start the Flow server and open it in the browser.
# Needs Node, npm install, and a DATABASE_URL (see .env.example).
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  npm install
fi
if ! curl -sf http://localhost:3333/health >/dev/null 2>&1; then
  npm start &
  for i in 1 2 3 4 5 6 7 8 9 10; do
    curl -sf http://localhost:3333/health >/dev/null 2>&1 && break
    sleep 0.4
  done
fi
if [ -d "/Applications/Google Chrome.app" ]; then
  open -a "Google Chrome" "http://localhost:3333"
else
  open "http://localhost:3333"
fi
