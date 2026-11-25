#!/usr/bin/env bash
# Запуск с доступом с телефона по Wi-Fi (с паролем)
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$DIR/start.sh" lan "$@"
