@echo off
powershell -NoProfile -Command "try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:14571/api/quit' -TimeoutSec 3 | Out-Null; Write-Host 'goxlr-streamlabs-sync stopped.' } catch { Write-Host 'Not running (or dashboard disabled / custom port).' }"
pause
