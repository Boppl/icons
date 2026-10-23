#!/bin/bash
#
# Decides whether Vercel goes ahead with a deployment, as the project's
# ignoreCommand (see vercel.json).
#
# Vercel inverts the usual convention: exit 1 continues the build, exit 0 cancels
# it and marks the deployment CANCELED.
#
# Production serves the released icons only, the way the GitHub Pages deploy did,
# so every other commit on main is skipped. Previews always build, so a pull
# request's icons can be browsed before they are released.

# Previews, and anything that isn't production: always build
if [ "$VERCEL_ENV" != "production" ]; then
  echo "$VERCEL_ENV deployment: building."
  exit 1
fi

# release.sh commits exactly "chore: release vX.Y.Z" (npm version -m "chore: release v%s"),
# the same signal scripts/site.mjs uses to tell a released page from an unreleased one.
subject=${VERCEL_GIT_COMMIT_MESSAGE:-$(git log -1 --pretty=%s)}

case "$subject" in
"chore: release v"*)
  echo "Release commit: building production."
  exit 1
  ;;
*)
  echo "Not a release commit: skipping. Production stays on the released icons."
  exit 0
  ;;
esac
