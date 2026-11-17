@echo off
rem npm: portativnyi iz .node, esli on est, inache sistemnyi
if exist "%~dp0.node\npm.cmd" (
  set "PATH=%~dp0.node;%PATH%"
  "%~dp0.node\npm.cmd" %*
) else (
  npm %*
)
