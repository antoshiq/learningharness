@echo off
rem npm s portativnym Node etogo proekta
set "PATH=%~dp0.node;%PATH%"
"%~dp0.node\npm.cmd" %*
