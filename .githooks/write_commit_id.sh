#!/bin/sh
# Writes the short id of HEAD to src/web_control/www/commit.txt (git-ignored).
# The page fetches it and shows it after the Version. It cannot live inside the
# committed index.html, because a commit id is a hash of that content.
# Called by post-commit, post-merge and post-checkout, so a `git pull` on the host
# updates it. Needs `git config core.hooksPath .githooks` on that clone too.
root=$(git rev-parse --show-toplevel) || exit 0
git rev-parse --short HEAD > "$root/src/web_control/www/commit.txt" 2>/dev/null || true
