#!/usr/bin/env bash
# npm: портативный из .node, если он есть, иначе системный
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$HOME/.local/bin" ]; then
  export PATH="$HOME/.local/bin:$PATH"
fi
if [ -x "$DIR/.node/bin/npm" ]; then
  export PATH="$DIR/.node/bin:$PATH"
  exec "$DIR/.node/bin/npm" "$@"
else
  exec npm "$@"
fi
