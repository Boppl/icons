#!/bin/bash
#
# Shared helper for generating the project changelog.
#
# Provides: generate_changelog <new_version>
#   Regenerates CHANGELOG.md from git history: commit titles grouped by
#   release tag (newest first), each with its release date. Commits made
#   since the latest tag are listed under <new_version>, dated today.
#
# Uses only git, so there is nothing extra to install.
#
# Run through `npm run changelog` by the version script in package.json, which
# npm version runs during a release so the changelog lands in the release commit.

CHANGELOG_FILE="CHANGELOG.md"
REPO_BASENAME=$(basename -s .git "$(git config --get remote.origin.url)")
REPO_URL="https://github.com/Boppl/$REPO_BASENAME"

# Print the changelog-worthy commit titles in <range>, one per line as
# "- <subject>", with the PR reference left as plain "(#123)". Prints
# nothing when the range has no such commits.
changelog_commits() {
  local range="$1"
  # Keep only Conventional Commits subjects (feat:, fix:, chore:, ... with an
  # optional (scope) and/or ! for breaking changes). Then tr -s collapses any
  # accidental double spaces. The trailing "|| true" keeps an empty range from
  # failing under "set -e" in the calling script.
  local types='build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test'
  git log --no-merges --invert-grep --grep='^chore: release v' \
    --format='- %s' "$range" |
    grep -E "^- ($types)(\([^)]+\))?!?: " |
    tr -s ' ' || true
}

# Print "## <title> - <date>" followed by the commit titles in <range>,
# one per line. The version-bump commits are filtered out. Prints nothing
# when the range has no commits.
_changelog_section() {
  local title="$1" date="$2" range="$3"
  local commits
  # sed turns the PR reference "(#123)" into a Markdown link to the PR,
  # dropping any trailing noise after it (e.g. merge-conflict text in a
  # squashed subject).
  commits=$(changelog_commits "$range" |
    sed -E "s@\(#([0-9]+)\).*@([#\1](${REPO_URL}/pull/\1))@")

  if [ -z "$commits" ]; then
    return
  fi

  echo "## $title - $date"
  echo
  printf '%s\n\n' "$commits"
}

generate_changelog() {
  local new_version="${1:+v$1}"
  new_version="${new_version:-Unreleased}"

  # Version tags, newest first.
  local tags=()
  local t
  while IFS= read -r t; do
    [ -n "$t" ] && tags+=("$t")
  done < <(git tag --sort=-v:refname --list 'v*')

  # Build the document, then write it with exactly one trailing newline.
  # Each section ends with a blank line, so the document would otherwise end
  # on a blank line. Command substitution strips trailing newlines (keeping
  # the blank lines between sections), and printf adds the single one back.
  local latest="${tags[0]:-}"
  local i tag prev range tag_date
  local content
  content=$(
    echo "# Changelog"
    echo

    # Unreleased commits since the latest tag, labelled as the version
    # being cut and dated today.
    _changelog_section "$new_version" "$(date +%Y-%m-%d)" \
      "${latest:+$latest..}HEAD"

    # One section per existing tag: the commits between it and the
    # previous (older) tag, dated by the tag's commit date.
    for ((i = 0; i < ${#tags[@]}; i++)); do
      tag="${tags[i]}"
      prev="${tags[i + 1]:-}"
      range="${prev:+$prev..}$tag"
      tag_date=$(git log -1 --format=%cd --date=short "$tag")
      _changelog_section "$tag" "$tag_date" "$range"
    done
  )

  printf '%s\n' "$content" >"$CHANGELOG_FILE"

  echo "Changelog written to $CHANGELOG_FILE for $new_version"
}
