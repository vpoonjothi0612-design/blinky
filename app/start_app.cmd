@echo off
title Face Detection Attendance - Mobile (React Native + PWA)
color 0b
echo ========================================================
echo   FACE DETECTION ATTENDANCE - DUAL APP LAUNCHER
echo   (React Native Native App + Progressive Web App)
echo ========================================================
echo.
echo   [1] Progressive Web App (PWA) / Browser:
echo       Open on PC:    http://localhost:8081
echo       Open on Phone: http://192.168.1.19:8081
echo       (Tap 'Install App' banner to install to home screen)
echo.
echo   [2] React Native Native Mobile App (Android/iOS):
echo       Connect phone to same Wi-Fi and scan QR code with Expo Go,
echo       or press 'a' for Android, 'w' for Web/PWA
echo.
echo ========================================================
cd /d "%~dp0"
node ./node_modules/@expo/cli/build/bin/cli start
pause

