@echo off
rem AstroApex - Windows baslatici. Cift tiklayin.
rem Python varsa yerel sunucuyu baslatir ve tarayiciyi acar; yoksa siteyi dogrudan acar.
cd /d "%~dp0"
title AstroApex

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py --open
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  python server.py --open
  goto :eof
)

echo Python bulunamadi; site dogrudan tarayicida aciliyor.
start "" "%~dp0index.html"
