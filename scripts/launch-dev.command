#!/bin/zsh
cd "${0:A:h}/.." || exit 1
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
printf '\033]0;Gnosis TMS Dev\007'
# The dev server has a fixed port; avoid launching another build over it.
if /usr/sbin/lsof -nP -iTCP:1431 -sTCP:LISTEN >/dev/null 2>&1; then
  printf 'A development server is already running on port 1431.\n'
  exit 0
fi
exec node scripts/launch-dev-session.mjs
