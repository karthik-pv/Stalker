@echo off
REM Build a standalone DailyReport.exe with PyInstaller.
REM Run from the python\ directory:  build_exe.bat
REM
REM Prereq:  pip install pyinstaller
REM
REM After building, copy dist\DailyReport.exe and your .env to your desktop.
REM Double-click DailyReport.exe to run.

pyinstaller --onefile --name "DailyReport" --console ^
  --collect-all matplotlib ^
  --collect-all supabase ^
  --collect-all dotenv ^
  --collect-all requests ^
  --collect-all table2ascii ^
  generate_daily_report.py

echo.
echo Build complete. See dist\DailyReport.exe
echo Remember to place a copy of .env next to DailyReport.exe.
