@echo off
setlocal EnableDelayedExpansion

title Production Dual-Camera Face Recognition Attendance (CAM-01: OUT ^| CAM-02: IN)

echo ===============================================================================
echo   CP PLUS DUAL-CAMERA AUTOMATIC FACE RECOGNITION ATTENDANCE PIPELINE
echo ===============================================================================
echo   Exit Camera  : CAM-01 (192.168.9.207) - Event: OUT
echo   Entry Camera : CAM-02 (192.168.9.208) - Event: IN
echo ===============================================================================

set "PROJECT_ROOT=%~dp0"
set "AI_SERVICES_DIR=%PROJECT_ROOT%ai-services"
set "PYTHON_EXE=%AI_SERVICES_DIR%\venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" (
    set "PYTHON_EXE=%AI_SERVICES_DIR%\.venv\Scripts\python.exe"
)

:: 1. Validate Python Virtual Environment
if not exist "%PYTHON_EXE%" (
    echo [ERROR] Virtual environment not found at:
    echo         %PYTHON_EXE%
    echo Please install dependencies or create virtual environment first.
    pause
    exit /b 1
)

:: 2. Prevent Duplicate Instances
powershell -NoProfile -ExecutionPolicy Bypass -Command "$procs = Get-CimInstance Win32_Process -Filter \"Name = 'python.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*dual_camera_live_face_recognition*' -and $_.ProcessId -ne $PID }; if ($procs) { exit 42 } else { exit 0 }"
if %ERRORLEVEL% equ 42 (
    echo [ERROR] Another instance of dual_camera_live_face_recognition is already running.
    echo Duplicate camera ingestion pipelines are prevented.
    pause
    exit /b 1
)

:: 3. Check Camera Configuration
if not exist "%AI_SERVICES_DIR%\.env" (
    echo [WARNING] ai-services\.env file not found.
    if exist "%AI_SERVICES_DIR%\.env.example" (
        echo Creating template .env from .env.example...
        copy "%AI_SERVICES_DIR%\.env.example" "%AI_SERVICES_DIR%\.env" >nul
        echo Please configure CAMERA_1_PASSWORD and CAMERA_2_PASSWORD in ai-services\.env.
    )
)

:: 4. Verify Backend Health
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-RestMethod -Uri 'http://localhost:3000/api/health' -TimeoutSec 2; Write-Host '[Backend Status] Node.js API is reachable (HTTP 200 OK)' } catch { Write-Host '[Backend Warning] Node.js API (http://localhost:3000) is NOT running or unreachable.' -ForegroundColor Yellow; Write-Host '                  Attendance events will buffer in the persistent outbox and replay safely when backend starts.' -ForegroundColor Yellow }"

echo.
echo Starting dual-camera face recognition ^& attendance pipeline...
echo Press 'q' in the camera window or Ctrl+C in terminal to stop cleanly.
echo.

pushd "%AI_SERVICES_DIR%"
"%PYTHON_EXE%" src\face\dual_camera_live_face_recognition.py %*
set "EXIT_CODE=%ERRORLEVEL%"
popd

echo.
echo Pipeline stopped with exit code %EXIT_CODE%.
exit /b %EXIT_CODE%
