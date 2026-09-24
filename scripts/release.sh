#!/bin/bash
#
# Releases a new version of the icons package.
#
# Usage: npm run release <major|minor|patch>
#
# A release is triggered by pushing a v* tag. The Publish workflow then publishes
# the package to GitHub Packages and creates the GitHub release, so package.json,
# the tag, the release and the registry all end up on the same version.

# Exit immediately if a command (or any part of a pipeline) exits with a non-zero status
set -eo pipefail

cd "$(dirname "$0")/.."

package_short_name=$(node -p "require('./package.json').name.split('/').pop()")

# Check if GitHub CLI is installed
if ! command -v gh &>/dev/null; then
  echo "Error: GitHub CLI (gh) is not installed."
  echo "Please install it from https://cli.github.com/ and try again."
  exit 1
fi

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
owner=${repo%%/*}

# Reads the version from each source: package.json on main, the latest tag,
# the latest GitHub release and the latest version published to the registry.
read_versions() {
  git fetch --quiet --tags --prune --prune-tags origin

  package_version=$(node -p "JSON.parse(require('child_process').execSync('git show origin/main:package.json')).version")

  tags=$(git tag --list 'v*' --sort=-v:refname)
  tag_version=${tags%%$'\n'*}
  tag_version=${tag_version#v}

  release_version=$(gh release list --exclude-drafts --exclude-pre-releases --limit 1 --json tagName --jq '.[0].tagName // empty')
  release_version=${release_version#v}

  if ! registry_versions=$(gh api --paginate "/orgs/$owner/packages/npm/$package_short_name/versions" --jq '.[].name' 2>/dev/null); then
    echo "Error: could not read the published versions from GitHub Packages."
    echo "Make sure your GitHub CLI token can read packages: gh auth refresh -s read:packages"
    exit 1
  fi
  registry_version=$(echo "$registry_versions" | sort -V | tail -1)
}

print_versions() {
  echo "  package.json (main): ${package_version:-none}"
  echo "  Latest tag:          ${tag_version:-none}"
  echo "  Latest release:      ${release_version:-none}"
  echo "  Latest published:    ${registry_version:-none}"
}

# Succeeds when every source is on the given version
versions_match() {
  [ "$package_version" == "$1" ] && [ "$tag_version" == "$1" ] &&
    [ "$release_version" == "$1" ] && [ "$registry_version" == "$1" ]
}

release() {
  version_type=$1

  # Check if the version_type parameter is provided and only allow major, minor, or patch
  if [[ "$version_type" != "major" && "$version_type" != "minor" && "$version_type" != "patch" ]]; then
    echo "Error: invalid version type '$version_type'."
    echo "Please provide a version type using the following command:"
    echo "npm run release major|minor|patch"
    exit 1
  fi

  # Releases are cut from an up to date, clean main
  if [ "$(git branch --show-current)" != "main" ]; then
    echo "Error: releases must be created from the main branch."
    exit 1
  fi
  if [ -n "$(git status --porcelain)" ]; then
    echo "Error: the working tree has uncommitted changes."
    echo "Please commit or stash them before releasing."
    exit 1
  fi
  git pull --quiet --ff-only origin main

  # Check if all the versions are the same before moving on
  read_versions
  if ! versions_match "$package_version"; then
    echo "Error: The versions are not the same."
    echo "Please ensure that all versions are synchronized before releasing."
    print_versions
    exit 1
  fi

  # Confirm the release
  read -rp "Are you sure you want to release a $version_type version (currently $package_version)? (y/N): " confirm
  if [[ $confirm != "y" ]]; then
    echo "Release process aborted."
    exit 1
  fi

  # Bump package.json, regenerate CHANGELOG.md (the version script in package.json),
  # then commit and tag the new version and push both together. The new version is
  # read back from package.json, as the version script also prints to stdout.
  npm version "$version_type" -m "chore: release v%s"
  new_tag="v$(node -p "require('./package.json').version")"
  git push --atomic origin main "$new_tag"

  # -- GitHub Action will run, publish the package and create the release --

  echo "Waiting for the Publish workflow to start..."
  run_id=""
  for _ in {1..20}; do
    run_id=$(gh run list --workflow publish.yml --branch "$new_tag" --event push --limit 1 --json databaseId --jq '.[0].databaseId // empty')
    [ -n "$run_id" ] && break
    sleep 3
  done
  if [ -z "$run_id" ]; then
    echo "Error: the Publish workflow did not start for $new_tag."
    echo "Check https://github.com/$repo/actions to see what happened."
    exit 1
  fi

  if ! gh run watch "$run_id" --exit-status; then
    echo "Error: the Publish workflow failed. Once fixed, re-run it with:"
    echo "gh run rerun $run_id --failed"
    exit 1
  fi

  # Make sure everything landed on the new version
  read_versions
  if ! versions_match "${new_tag#v}"; then
    echo "Error: the release finished but the versions are not all on $new_tag."
    print_versions
    exit 1
  fi

  # Print a success message
  echo "Release $new_tag has been published."
}

release "$1"
