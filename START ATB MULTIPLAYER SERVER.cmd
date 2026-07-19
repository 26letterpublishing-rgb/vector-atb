@echo off
setlocal
title Vector ATB Multiplayer Server
cd /d "%~dp0"

set "NODE_EXE=C:\Users\zombi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

echo Vector ATB Multiplayer
echo.
echo Keep this window open while phones are using the ATB app.
echo.
echo Computer URL:
echo   http://127.0.0.1:8787
echo.
echo Phone URL:
echo   Use the address shown below after the server starts.
echo   If the full app fails on your phone, try adding /ping to the end.
echo.
echo If Windows asks whether to allow access, choose:
echo   Allow access
echo   Private networks
echo.
"%NODE_EXE%" ".\server.js"
echo.
echo The server stopped. You can close this window.
pause
