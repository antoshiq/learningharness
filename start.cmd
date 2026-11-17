@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title Репетитор

rem ---------------------------------------------------------------------------
rem  Запуск репетитора. Двойной щелчок открывает меню.
rem  Можно и без меню:  start.cmd [start|lan|dev|mock|rebuild|install|test|shortcut]
rem ---------------------------------------------------------------------------

rem Node: портативный из папки .node, если он есть, иначе установленный в системе.
set "NODE="
set "NPM="
if exist "%~dp0.node\node.exe" (
  set "NODE=%~dp0.node\node.exe"
  set "NPM=%~dp0.node\npm.cmd"
  set "PATH=%~dp0.node;%PATH%"
) else (
  for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE set "NODE=%%i"
  set "NPM=npm"
)
if not defined NODE (
  echo.
  echo  Не найден Node.js.
  echo  Установи его с https://nodejs.org (версия 20.9 или новее^) и запусти этот файл снова.
  echo.
  pause
  exit /b 1
)
"%NODE%" -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)"
if errorlevel 1 (
  echo.
  echo  Node.js слишком старый, нужен 20.9 или новее. Сейчас:
  "%NODE%" -v
  echo.
  pause
  exit /b 1
)

set "ACTION=%~1"
if defined ACTION goto dispatch

:menu
cls
echo.
echo    ┌──────────────────────────────────────────────┐
echo    │                  Репетитор                   │
echo    └──────────────────────────────────────────────┘
echo.
echo      1  Запустить и открыть в браузере
echo      2  Запустить с доступом с телефона (Wi-Fi)
echo      3  Режим разработки (горячая перезагрузка)
echo      4  Тестовая модель: без ключа и без расходов
echo      5  Пересобрать и запустить
echo      6  Установить или обновить зависимости
echo      7  Прогнать тесты
echo      8  Ярлык на рабочем столе
echo      0  Выход
echo.
choice /c 123456780 /n /m "   Выбери пункт: "
set "ACTION="
if errorlevel 9 exit /b 0
if errorlevel 8 set "ACTION=shortcut"& goto dispatch
if errorlevel 7 set "ACTION=test"& goto dispatch
if errorlevel 6 set "ACTION=install"& goto dispatch
if errorlevel 5 set "ACTION=rebuild"& goto dispatch
if errorlevel 4 set "ACTION=mock"& goto dispatch
if errorlevel 3 set "ACTION=dev"& goto dispatch
if errorlevel 2 set "ACTION=lan"& goto dispatch
set "ACTION=start"

:dispatch
if /i "%ACTION%"=="install" goto install
if /i "%ACTION%"=="shortcut" goto shortcut
call :ensure_deps || goto fail
if /i "%ACTION%"=="start" goto start
if /i "%ACTION%"=="lan" goto lan
if /i "%ACTION%"=="dev" goto dev
if /i "%ACTION%"=="mock" goto mock
if /i "%ACTION%"=="rebuild" goto rebuild
if /i "%ACTION%"=="test" goto test
echo  Неизвестная команда: %ACTION%
echo  Доступно: start, lan, dev, mock, rebuild, install, test, shortcut
exit /b 1

:start
"%NODE%" scripts\run.mjs start --open %2 %3 %4 %5
goto done

:lan
"%NODE%" scripts\run.mjs start --lan --open %2 %3 %4 %5
goto done

:dev
"%NODE%" scripts\run.mjs dev --open %2 %3 %4 %5
goto done

:mock
set "TUTOR_MOCK=1"
echo  Тестовый режим: вместо модели отвечает заглушка.
"%NODE%" scripts\run.mjs start --open %2 %3 %4 %5
goto done

:rebuild
"%NODE%" scripts\run.mjs start --rebuild --open %2 %3 %4 %5
goto done

:test
call "%NPM%" test
goto done

:install
echo  Устанавливаю зависимости...
if exist package-lock.json (call "%NPM%" ci) else (call "%NPM%" install)
if errorlevel 1 goto fail
echo  Готово.
goto done

:shortcut
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'Репетитор.lnk'));" ^
  "$s.TargetPath = '%~dp0start.cmd'; $s.Arguments = 'start'; $s.WorkingDirectory = '%~dp0';" ^
  "$s.IconLocation = '%~dp0src\app\favicon.ico'; $s.Description = 'Запустить репетитор'; $s.Save()"
if errorlevel 1 goto fail
echo  Ярлык «Репетитор» создан на рабочем столе: он сразу запускает приложение и открывает браузер.
goto done

rem Installs dependencies on the first run or after package.json changed.
:ensure_deps
if not exist "node_modules\next\package.json" (
  echo  Первый запуск: устанавливаю зависимости, это несколько минут...
  if exist package-lock.json (call "%NPM%" ci) else (call "%NPM%" install)
  if errorlevel 1 exit /b 1
)
exit /b 0

:fail
echo.
echo  Что-то пошло не так, сообщение об ошибке выше.

:done
rem Keep the window open when it was opened by double click from Explorer.
echo.
echo %CMDCMDLINE% | findstr /i /c:" /c " >nul && pause
exit /b 0
