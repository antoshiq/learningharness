@echo off
rem Ustanovka zavisimostei: nuzhna odin raz i posle izmeneniya package.json
set "PATH=%~dp0.node;%PATH%"
call "%~dp0.node\npm.cmd" ci
