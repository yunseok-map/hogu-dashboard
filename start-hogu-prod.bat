@echo off
chcp 65001 >nul
title 호구체크 PROD (:3390)
cd /d "%~dp0"

echo ============================================================
echo   호구체크 운영 서버 (prod)  -  크래시 시 자동 재시작
echo   로컬:     http://localhost:3390
echo   공개 URL: "tailscale funnel status" 로 확인
echo   (이 창을 닫으면 서버가 완전히 내려갑니다)
echo ============================================================

set "TS=C:\Program Files\Tailscale\tailscale.exe"
if exist "%TS%" (
  echo [Tailscale] Funnel 재확인...
  "%TS%" funnel --bg 3390 >nul 2>&1
)

:loop
echo.
echo [%date% %time%] 서버 시작 (HOGU_ENV=prod)
node start-prod.mjs
echo [%date% %time%] 서버 종료됨 - 5초 후 자동 재시작...
timeout /t 5 /nobreak >nul
goto loop
