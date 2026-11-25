#!/usr/bin/env bash
# Режим разработки с горячей перезагрузкой
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$DIR/start.sh" dev "$@"
