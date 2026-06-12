@echo off
setlocal enabledelayedexpansion

echo ==============================================
echo       COMPILADOR DE SINAPSIS MAP
echo ==============================================
echo.

echo [1/4] Compilando la Interfaz (Frontend)...
cd frontend
call npm run build
if %errorlevel% neq 0 (
    echo Error al compilar el frontend.
    pause
    exit /b %errorlevel%
)
cd ..
echo.

echo [2/4] Compilando el Motor (Backend) para Windows, Linux y Mac...
cd backend\src\LabSOM.Backend.Core

echo   - Compilando para Windows...
dotnet publish -c Release -r win-x64 --self-contained true -o ..\..\..\publish_win
if %errorlevel% neq 0 exit /b %errorlevel%

echo   - Compilando para Linux...
dotnet publish -c Release -r linux-x64 --self-contained true -o ..\..\..\publish_linux
if %errorlevel% neq 0 exit /b %errorlevel%

echo   - Compilando para Mac (Intel/Apple Silicon)...
dotnet publish -c Release -r osx-x64 --self-contained true -o ..\..\..\publish_mac
if %errorlevel% neq 0 exit /b %errorlevel%

cd ..\..\..\
echo.

echo [3/4] Empaquetando para Linux y Mac (.zip)...
if not exist Output mkdir Output

echo   - Creando empaquetado para Linux...
if exist Output\SinapsisMap_Linux rmdir /s /q Output\SinapsisMap_Linux
mkdir Output\SinapsisMap_Linux
xcopy publish_linux\* Output\SinapsisMap_Linux\ /s /e /y /q >nul
robocopy engine Output\SinapsisMap_Linux\engine /s /e /xd __pycache__ .venv venv temp >nul
powershell -Command "Compress-Archive -Path 'Output\SinapsisMap_Linux\*' -DestinationPath 'Output\SinapsisMap_Linux.zip' -Force"

echo   - Creando empaquetado para Mac...
if exist Output\SinapsisMap_Mac rmdir /s /q Output\SinapsisMap_Mac
mkdir Output\SinapsisMap_Mac
xcopy publish_mac\* Output\SinapsisMap_Mac\ /s /e /y /q >nul
robocopy engine Output\SinapsisMap_Mac\engine /s /e /xd __pycache__ .venv venv temp >nul
powershell -Command "Compress-Archive -Path 'Output\SinapsisMap_Mac\*' -DestinationPath 'Output\SinapsisMap_Mac.zip' -Force"
echo.

echo [4/4] Empaquetando el Instalador de Windows (Inno Setup)...
if exist publish rmdir /s /q publish
move publish_win publish >nul

"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer-lite.iss
if %errorlevel% neq 0 (
    echo Error al crear el instalador de Windows.
    pause
    exit /b %errorlevel%
)

:: Limpiar carpetas temporales
rmdir /s /q publish
rmdir /s /q publish_linux
rmdir /s /q publish_mac
rmdir /s /q Output\SinapsisMap_Linux
rmdir /s /q Output\SinapsisMap_Mac
echo.

echo ==============================================
echo  EXITO: Paquetes compilados correctamente.
echo  Rutas:
echo   - Windows: Output\SinapsisMap_Installer_Lite.exe
echo   - Linux:   Output\SinapsisMap_Linux.zip
echo   - Mac:     Output\SinapsisMap_Mac.zip
echo ==============================================
pause
