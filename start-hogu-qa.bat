@echo off
chcp 65001 >nul
title 호구체크 QA (:3311)
cd /d "%~dp0"
echo 호구체크 개발 서버 (qa) - http://localhost:3311  (Ctrl+C 로 종료)
node start-qa.mjs
