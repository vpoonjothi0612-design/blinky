@echo off
setlocal

title Local PC Webcam Recognition Test - No Server Writes

set "PROJECT_ROOT=%~dp0"
set "AI_DIR=%PROJECT_ROOT%ai-services"
set "PYTHON_EXE=%AI_DIR%\venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=%AI_DIR%\.venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=python"

echo Starting local PC webcam test only.
echo Live CP PLUS server cameras and backend functionality are not changed or started.
echo.

pushd "%AI_DIR%"
"%PYTHON_EXE%" scripts\local_webcam_test.py --web %*
set "EXIT_CODE=%ERRORLEVEL%"
popd

exit /b %EXIT_CODE%
