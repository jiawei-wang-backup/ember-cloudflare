@echo off
setlocal
where py.exe >nul 2>&1
if errorlevel 1 goto python
if "%~1"=="" (py -3 -B "%~dp0pulse-onboard.py" preflight) else (py -3 -B "%~dp0pulse-onboard.py" %*)
exit /b %errorlevel%
:python
where python.exe >nul 2>&1
if errorlevel 1 (
  echo Python 3 is required. Install Python 3 or ask Codex to fix the prerequisite, then rerun this command.
  exit /b 2
)
if "%~1"=="" (python -B "%~dp0pulse-onboard.py" preflight) else (python -B "%~dp0pulse-onboard.py" %*)
exit /b %errorlevel%
