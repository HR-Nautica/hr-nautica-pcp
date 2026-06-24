@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 goto erro
)

if not exist "dist\index.html" (
  echo Gerando aplicacao...
  call npm run build
  if errorlevel 1 goto erro
)

echo Iniciando HR Nautica PCP...
echo Acesse http://localhost:3001
call npm start
goto fim

:erro
echo.
echo Falha ao iniciar. Verifique Node.js, Microsoft Access/ODBC e o arquivo .env.
pause

:fim
endlocal

