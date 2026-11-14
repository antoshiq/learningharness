@echo off
rem Zapusk s dostupom s telefona po Wi-Fi (s parolem)
"%~dp0.node\node.exe" "%~dp0scripts\run.mjs" start --lan %*
