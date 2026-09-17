@echo off
setlocal
cd /d "%~dp0"
title ECO HOGAR v2.3.3

echo ==========================================
echo          ECO HOGAR v2.3.3
echo ==========================================
echo.

echo Carpeta activa: %CD%
echo.
if exist .next (
  echo Limpiando cache de compilacion anterior...
  rmdir /S /Q .next >nul 2>&1
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
  echo Cerrando servidor anterior en puerto 3000 ^(PID %%a^)...
  taskkill /PID %%a /F >nul 2>&1
)

echo.
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm.cmd install
  if errorlevel 1 goto error
)


echo Iniciando ECO HOGAR v2.3.3...
start "" "http://localhost:3000"
call npm.cmd run dev -- --port 3000
exit /b 0

:error
echo.
echo Hubo un error instalando las dependencias.
pause
exit /b 1
