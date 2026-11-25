#!/usr/bin/env bash
set -uo pipefail

# ---------------------------------------------------------------------------
#  Запуск репетитора на Linux (и macOS).
#  Без аргументов открывает меню.
#  Без меню: ./start.sh [start|lan|dev|mock|rebuild|install|test|shortcut]
# ---------------------------------------------------------------------------

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# Подхватываем пользовательские утилиты (agy, codex, claude и др.) даже при запуске из ярлыка.
if [ -d "$HOME/.local/bin" ]; then
  export PATH="$HOME/.local/bin:$PATH"
fi

# Node: портативный из папки .node, если он есть, иначе установленный в системе.
NODE=""
NPM=""
if [ -x "$ROOT/.node/bin/node" ]; then
  NODE="$ROOT/.node/bin/node"
  NPM="$ROOT/.node/bin/npm"
  export PATH="$ROOT/.node/bin:$PATH"
elif command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
  NPM="$(command -v npm 2>/dev/null || echo npm)"
else
  # Попробуем найти Node в типичных менеджерах версий, если shell не подгрузил профиль.
  for candidate in \
    "$HOME/.volta/bin/node" \
    "$HOME/.fnm/aliases/default/bin/node" \
    "$HOME/.local/share/fnm/aliases/default/bin/node" \
    "$HOME/.asdf/shims/node" \
    "$HOME/.local/share/mise/shims/node"; do
    if [ -x "$candidate" ]; then
      NODE="$candidate"
      dir="$(dirname "$candidate")"
      export PATH="$dir:$PATH"
      NPM="$dir/npm"
      break
    fi
  done
  if [ -z "$NODE" ] && [ -d "$HOME/.nvm/versions/node" ]; then
    latest_nvm="$(ls -1d "$HOME/.nvm/versions/node"/v* 2>/dev/null | sort -V | tail -n 1 || true)"
    if [ -n "$latest_nvm" ] && [ -x "$latest_nvm/bin/node" ]; then
      NODE="$latest_nvm/bin/node"
      NPM="$latest_nvm/bin/npm"
      export PATH="$latest_nvm/bin:$PATH"
    fi
  fi
fi

if [ -z "$NODE" ]; then
  echo ""
  echo "  Не найден Node.js."
  echo "  Установи Node.js 22 или новее (https://nodejs.org, через nvm или системный пакетный менеджер)"
  echo "  или распакуй портативный Node в папку .node/ внутри проекта и запусти этот скрипт снова."
  echo ""
  exit 1
fi

if ! "$NODE" -e 'const [maj, min] = process.versions.node.split(".").map(Number); process.exit(maj > 20 || (maj === 20 && min >= 9) ? 0 : 1)'; then
  echo ""
  echo "  Node.js слишком старый, нужен 20.9 или новее (рекомендуется 22+). Сейчас:"
  "$NODE" -v
  echo ""
  exit 1
fi

ensure_deps() {
  if [ ! -f "$ROOT/node_modules/next/package.json" ]; then
    echo "  Первый запуск: устанавливаю зависимости, это несколько минут..."
    if [ -f "$ROOT/package-lock.json" ]; then
      "$NPM" ci
    else
      "$NPM" install
    fi
  fi
}

create_shortcut() {
  local desktop_dir apps_dir desktop_file app_file icon_path
  if command -v xdg-user-dir >/dev/null 2>&1; then
    desktop_dir="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
  else
    desktop_dir="$HOME/Desktop"
  fi
  apps_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  icon_path="$ROOT/src/app/favicon.ico"

  local entry
  entry="[Desktop Entry]
Type=Application
Name=Репетитор
Comment=Запустить репетитор
Exec=\"$ROOT/start.sh\" start
Path=$ROOT
Icon=$icon_path
Terminal=true
Categories=Education;
"

  mkdir -p "$apps_dir"
  app_file="$apps_dir/repetitor.desktop"
  printf '%s' "$entry" > "$app_file"
  chmod +x "$app_file"

  if [ -d "$desktop_dir" ]; then
    desktop_file="$desktop_dir/Репетитор.desktop"
    printf '%s' "$entry" > "$desktop_file"
    chmod +x "$desktop_file"
    echo "  Ярлык «Репетитор» создан на рабочем столе ($desktop_file) и в меню приложений."
  else
    echo "  Ярлык «Репетитор» создан в меню приложений ($app_file)."
  fi
}

ACTION="${1:-}"
if [ -n "$ACTION" ]; then
  shift
else
  clear 2>/dev/null || true
  echo ""
  echo "    ┌──────────────────────────────────────────────┐"
  echo "    │                  Репетитор                   │"
  echo "    └──────────────────────────────────────────────┘"
  echo ""
  echo "      1  Запустить и открыть в браузере"
  echo "      2  Запустить с доступом с телефона (Wi-Fi)"
  echo "      3  Режим разработки (горячая перезагрузка)"
  echo "      4  Тестовая модель: без ключа и без расходов"
  echo "      5  Пересобрать и запустить"
  echo "      6  Установить или обновить зависимости"
  echo "      7  Прогнать тесты"
  echo "      8  Ярлык на рабочем столе"
  echo "      0  Выход"
  echo ""
  while true; do
    read -r -n 1 -p "   Выбери пункт: " choice
    echo ""
    case "$choice" in
      1) ACTION="start"; break ;;
      2) ACTION="lan"; break ;;
      3) ACTION="dev"; break ;;
      4) ACTION="mock"; break ;;
      5) ACTION="rebuild"; break ;;
      6) ACTION="install"; break ;;
      7) ACTION="test"; break ;;
      8) ACTION="shortcut"; break ;;
      0) exit 0 ;;
      *) ;;
    esac
  done
fi

case "$ACTION" in
  install)
    echo "  Устанавливаю зависимости..."
    if [ -f "$ROOT/package-lock.json" ]; then
      "$NPM" ci
    else
      "$NPM" install
    fi
    echo "  Готово."
    ;;
  shortcut)
    create_shortcut
    ;;
  start)
    ensure_deps
    exec "$NODE" scripts/run.mjs start --open "$@"
    ;;
  lan)
    ensure_deps
    exec "$NODE" scripts/run.mjs start --lan --open "$@"
    ;;
  dev)
    ensure_deps
    exec "$NODE" scripts/run.mjs dev --open "$@"
    ;;
  mock)
    ensure_deps
    echo "  Тестовый режим: вместо модели отвечает заглушка."
    TUTOR_MOCK=1 exec "$NODE" scripts/run.mjs start --open "$@"
    ;;
  rebuild)
    ensure_deps
    exec "$NODE" scripts/run.mjs start --rebuild --open "$@"
    ;;
  test)
    ensure_deps
    exec "$NPM" test "$@"
    ;;
  *)
    echo "  Неизвестная команда: $ACTION"
    echo "  Доступно: start, lan, dev, mock, rebuild, install, test, shortcut"
    exit 1
    ;;
esac
