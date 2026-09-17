@echo off
setlocal
cd /d "%~dp0"
title ECO HOGAR - Publicar en Vercel

echo ==========================================
echo      ECO HOGAR v2.3.3 - VERCEL
echo ==========================================
echo.
echo Este asistente inicia el despliegue interactivo.
echo Antes de produccion, revisa PUBLICAR-ECO-HOGAR-v2.3.3.txt
echo.
where npx.cmd >nul 2>nul
if errorlevel 1 (
  echo ERROR: no se encontro npx.cmd. Verifica Node.js.
  pause
  exit /b 1
)

echo Iniciando Vercel...
call npx.cmd vercel@latest

echo.
echo Cuando configures las variables en Vercel y Supabase,
echo publica produccion con:
echo   npx.cmd vercel@latest --prod
echo.
pause
