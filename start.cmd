@echo off
rem Zapusk na etom kompyutere: http://localhost:3000
"%~dp0.node\node.exe" "%~dp0scripts\run.mjs" start %*
