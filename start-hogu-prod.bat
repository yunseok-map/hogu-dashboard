@echo off
title HOGU PROD 3390
cd /d "%~dp0"
rem 운영 서버 - 크래시 시 자동 재시작 루프. (Tailscale Funnel은 tailscaled 서비스가 유지)
rem 이 창을 닫으면 서버가 완전히 내려갑니다.
:loop
echo [%date% %time%] HOGU prod server start (HOGU_ENV=prod, :3390)
node start-prod.mjs
echo [%date% %time%] stopped - restart in 5s ...
timeout /t 5 /nobreak >nul
goto loop
