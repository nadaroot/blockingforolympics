using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Win32;

namespace Loked.Native
{
    class Program
    {
        // Win32 Constants
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_KEYUP = 0x0101;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const int WM_SYSKEYUP = 0x0105;

        private const int VK_TAB = 0x09;
        private const int VK_ESCAPE = 0x1B;
        private const int VK_SPACE = 0x20;
        private const int VK_LWIN = 0x5B;
        private const int VK_RWIN = 0x5C;
        private const int VK_F4 = 0x73;
        private const int VK_LSHIFT = 0xA0;
        private const int VK_RSHIFT = 0xA1;
        private const int VK_LCONTROL = 0xA2;
        private const int VK_RCONTROL = 0xA3;
        private const int VK_LMENU = 0xA4;
        private const int VK_RMENU = 0xA5;

        private const int LLKHF_ALTDOWN = 0x20;

        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        private static extern bool GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

        [DllImport("user32.dll")]
        private static extern bool TranslateMessage([In] ref MSG lpMsg);

        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage([In] ref MSG lpMsg);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter, string className, string windowTitle);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        private static extern bool EnableWindow(IntPtr hWnd, bool bEnable);

        private const int SW_HIDE = 0;
        private const int SW_SHOW = 5;

        [DllImport("user32.dll")]
        private static extern bool PostThreadMessage(uint idThread, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        private static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);

        [DllImport("user32.dll")]
        private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        private static readonly IntPtr HWND_BOTTOM = new IntPtr(1);
        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_NOMOVE = 0x0002;
        private const uint SWP_NOACTIVATE = 0x0010;

        private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        private const uint MOUSEEVENTF_LEFTUP = 0x0004;
        private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        private const uint KEYEVENTF_KEYUP = 0x0002;

        private const uint WM_QUIT = 0x0012;

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int x;
            public int y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public POINT pt;
        }

        private static IntPtr _hookID = IntPtr.Zero;
        private static LowLevelKeyboardProc _proc = HookCallback;
        private static bool _isLocked = false;
        private static uint _hookThreadId = 0;
        private static Thread _hookThread;

        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        static void Main(string[] args)
        {
            AppDomain.CurrentDomain.ProcessExit += (s, e) => CleanExit();
            Console.CancelKeyPress += (s, e) => { CleanExit(); };

            // Start hook message loop in a dedicated thread
            _hookThread = new Thread(HookMessageLoop);
            _hookThread.IsBackground = true;
            _hookThread.Start();

            // Default to locked state on startup
            SetLockState(true);

            Console.WriteLine("LOKED_LOCKER:READY");
            Console.Out.Flush();

            // Listen to parent stdin commands
            try
            {
                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    line = line.Trim().ToUpperInvariant();
                    if (line == "LOCK")
                    {
                        SetLockState(true);
                        Console.WriteLine("LOKED_LOCKER:LOCKED");
                    }
                    else if (line == "UNLOCK")
                    {
                        SetLockState(false);
                        Console.WriteLine("LOKED_LOCKER:UNLOCKED");
                    }
                    else if (line.StartsWith("MOUSE:MOVE:"))
                    {
                        string[] parts = line.Split(':');
                        if (parts.Length >= 4)
                        {
                            int mx = int.Parse(parts[2]);
                            int my = int.Parse(parts[3]);
                            SetCursorPos(mx, my);
                        }
                    }
                    else if (line.StartsWith("MOUSE:CLICK:"))
                    {
                        string[] parts = line.Split(':');
                        if (parts.Length >= 5)
                        {
                            string btn = parts[2];
                            int mx = int.Parse(parts[3]);
                            int my = int.Parse(parts[4]);
                            SetCursorPos(mx, my);
                            if (btn == "RIGHT")
                                mouse_event(MOUSEEVENTF_RIGHTDOWN | MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
                            else
                                mouse_event(MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                        }
                    }
                    else if (line.StartsWith("KEY:PRESS:"))
                    {
                        string[] parts = line.Split(':');
                        if (parts.Length >= 3)
                        {
                            byte vk = byte.Parse(parts[2]);
                            keybd_event(vk, 0, 0, 0);
                            keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
                        }
                    }
                    else if (line.StartsWith("WIN:BOTTOM:"))
                    {
                        string[] parts = line.Split(':');
                        if (parts.Length >= 3)
                        {
                            long hVal = long.Parse(parts[2]);
                            SetWindowPos((IntPtr)hVal, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
                        }
                    }
                    else if (line.StartsWith("WIN:TOP:"))
                    {
                        string[] parts = line.Split(':');
                        if (parts.Length >= 3)
                        {
                            long hVal = long.Parse(parts[2]);
                            SetWindowPos((IntPtr)hVal, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE);
                        }
                    }
                    else if (line == "STATUS")
                    {
                        Console.WriteLine("LOKED_LOCKER:STATUS:" + (_isLocked ? "LOCKED" : "UNLOCKED"));
                    }
                    else if (line == "EXIT" || line == "QUIT")
                    {
                        break;
                    }
                    Console.Out.Flush();
                }
            }
            catch
            {
                // Stdin pipe closed (parent terminated)
            }
            finally
            {
                CleanExit();
            }
        }

        private static void HookMessageLoop()
        {
            _hookThreadId = GetCurrentThreadId();
            using (Process curProcess = Process.GetCurrentProcess())
            using (ProcessModule curModule = curProcess.MainModule)
            {
                _hookID = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(curModule.ModuleName), 0);
            }

            MSG msg;
            while (GetMessage(out msg, IntPtr.Zero, 0, 0))
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }

            if (_hookID != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_hookID);
                _hookID = IntPtr.Zero;
            }
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && _isLocked)
            {
                KBDLLHOOKSTRUCT kbd = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                uint vk = kbd.vkCode;
                bool isAltDown = (kbd.flags & LLKHF_ALTDOWN) != 0;
                bool isCtrlDown = (GetAsyncKeyState(0x11) & 0x8000) != 0; // VK_CONTROL
                bool isShiftDown = (GetAsyncKeyState(0x10) & 0x8000) != 0; // VK_SHIFT

                // 1. Windows Key (Left or Right)
                if (vk == VK_LWIN || vk == VK_RWIN)
                {
                    return (IntPtr)1;
                }

                // 2. Alt + Tab, Alt + Esc, Alt + Space, Alt + F4
                if (isAltDown && (vk == VK_TAB || vk == VK_ESCAPE || vk == VK_SPACE || vk == VK_F4))
                {
                    return (IntPtr)1;
                }

                // 3. Ctrl + Esc (Start Menu)
                if (isCtrlDown && vk == VK_ESCAPE)
                {
                    return (IntPtr)1;
                }

                // 4. Ctrl + Shift + Esc (Task Manager)
                if (isCtrlDown && isShiftDown && vk == VK_ESCAPE)
                {
                    return (IntPtr)1;
                }
            }

            return CallNextHookEx(_hookID, nCode, wParam, lParam);
        }

        private static void SetLockState(bool locked)
        {
            _isLocked = locked;
            SetTaskbarVisibility(!locked);
            ApplyRegistryPolicies(locked);
        }

        private static void SetTaskbarVisibility(bool visible)
        {
            try
            {
                int cmd = visible ? SW_SHOW : SW_HIDE;

                // 1. Primary taskbar
                IntPtr taskbar = FindWindow("Shell_TrayWnd", null);
                if (taskbar != IntPtr.Zero)
                {
                    ShowWindow(taskbar, cmd);
                    EnableWindow(taskbar, visible);
                }

                // 2. Secondary monitor taskbars (Windows 10/11)
                IntPtr secTaskbar = IntPtr.Zero;
                while ((secTaskbar = FindWindowEx(IntPtr.Zero, secTaskbar, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero)
                {
                    ShowWindow(secTaskbar, cmd);
                    EnableWindow(secTaskbar, visible);
                }

                // 3. Start button (legacy / standalone if any)
                IntPtr startBtn = FindWindowEx(IntPtr.Zero, IntPtr.Zero, "Button", "Start");
                if (startBtn != IntPtr.Zero)
                {
                    ShowWindow(startBtn, cmd);
                    EnableWindow(startBtn, visible);
                }
            }
            catch { }
        }

        private static void ApplyRegistryPolicies(bool apply)
        {
            try
            {
                // Disable Task Manager
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Policies\System"))
                {
                    if (key != null)
                    {
                        if (apply)
                        {
                            key.SetValue("DisableTaskMgr", 1, RegistryValueKind.DWord);
                            key.SetValue("DisableLockWorkstation", 1, RegistryValueKind.DWord);
                            key.SetValue("DisableChangePassword", 1, RegistryValueKind.DWord);
                        }
                        else
                        {
                            key.DeleteValue("DisableTaskMgr", false);
                            key.DeleteValue("DisableLockWorkstation", false);
                            key.DeleteValue("DisableChangePassword", false);
                        }
                    }
                }

                // Disable Windows Hotkeys in Explorer
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"))
                {
                    if (key != null)
                    {
                        if (apply)
                        {
                            key.SetValue("NoWinKeys", 1, RegistryValueKind.DWord);
                            key.SetValue("NoRun", 1, RegistryValueKind.DWord);
                        }
                        else
                        {
                            key.DeleteValue("NoWinKeys", false);
                            key.DeleteValue("NoRun", false);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                // Registry access might need elevated privileges or standard user policies
                Console.Error.WriteLine("LOKED_LOCKER:REG_ERR:" + ex.Message);
            }
        }

        private static void CleanExit()
        {
            try
            {
                SetLockState(false);
                if (_hookThreadId != 0)
                {
                    PostThreadMessage(_hookThreadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
                }
            }
            catch { }
        }
    }
}
