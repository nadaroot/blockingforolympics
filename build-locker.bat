@echo off
title Build LOKED Native Locker
echo Compiling client/native/Locker.cs using .NET csc.exe...
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /out:client\native\locker.exe client\native\Locker.cs
if %ERRORLEVEL% EQU 0 (
    echo [OK] client/native/locker.exe compiled successfully!
) else (
    echo [ERROR] Compilation failed.
)
pause
