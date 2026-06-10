' Launches goxlr-streamlabs-sync with NO window and opens the dashboard
' (http://127.0.0.1:14571). If it is already running, this just reopens
' the dashboard. Use stop.bat or the dashboard's Quit button to stop it.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
sh.Run "node src\index.js --open", 0, False
