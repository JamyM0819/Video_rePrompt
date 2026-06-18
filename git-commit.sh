#!/bin/bash
# Usage: ./git-commit.sh <level> "<message>"
#   level: patch | minor | major
# Example: ./git-commit.sh patch "fix: scene detection timeout"
#          ./git-commit.sh minor "feat: add video analysis mode"

set -e

LEVEL="${1:-patch}"
MSG="$2"

if [ -z "$MSG" ]; then
  echo "Usage: ./git-commit.sh <patch|minor|major> \"<commit message>\""
  exit 1
fi

echo "Bumping $LEVEL..."
npm version "$LEVEL" --no-git-tag-version --silent
VER=$(node -e "console.log(require('./package.json').version)")

git add .
git commit -m "$MSG

v$VER"
echo "Committed v$VER"
