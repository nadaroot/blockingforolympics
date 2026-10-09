using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Reflection;

namespace LokedLauncher
{
    class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            try
            {
#if CLIENT
                string appName = "LOKED-Client";
                string exeName = "LOKED-Client.exe";
#else
                string appName = "LOKED-Admin";
                string exeName = "LOKED-Admin.exe";
#endif
                string appVersion = "1.0.0";

                string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string targetDir = Path.Combine(localApp, "Programs", appName);
                string targetExe = Path.Combine(targetDir, exeName);
                string versionFile = Path.Combine(targetDir, ".version");

                var currentAsm = Assembly.GetExecutingAssembly();
                long launcherTicks = 0;
                try
                {
                    if (!string.IsNullOrEmpty(currentAsm.Location) && File.Exists(currentAsm.Location))
                    {
                        launcherTicks = File.GetLastWriteTimeUtc(currentAsm.Location).Ticks;
                    }
                }
                catch { }

                bool needsExtract = !File.Exists(targetExe) ||
                                    !File.Exists(versionFile);

                if (!needsExtract)
                {
                    try
                    {
                        string[] vLines = File.ReadAllLines(versionFile);
                        string savedVer = vLines.Length > 0 ? vLines[0].Trim() : "";
                        string savedTicks = vLines.Length > 1 ? vLines[1].Trim() : "";
                        if (savedVer != appVersion || (launcherTicks > 0 && savedTicks != launcherTicks.ToString()))
                        {
                            needsExtract = true;
                        }
                    }
                    catch
                    {
                        needsExtract = true;
                    }
                }

                if (needsExtract)
                {
                    if (Directory.Exists(targetDir))
                    {
                        try { Directory.Delete(targetDir, true); } catch { }
                    }
                    Directory.CreateDirectory(targetDir);

                    string tempZip = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N") + ".zip");
                    using (var resStream = currentAsm.GetManifestResourceStream("Payload"))
                    {
                        if (resStream == null)
                        {
                            return 1;
                        }
                        using (var fileStream = File.Create(tempZip))
                        {
                            resStream.CopyTo(fileStream);
                        }
                    }

                    ZipFile.ExtractToDirectory(tempZip, targetDir);
                    try { File.Delete(tempZip); } catch { }
                    File.WriteAllText(versionFile, appVersion + "\r\n" + launcherTicks);
                }

                if (File.Exists(targetExe))
                {
                    var psi = new ProcessStartInfo(targetExe);
                    psi.WorkingDirectory = targetDir;
                    if (args != null && args.Length > 0)
                    {
                        psi.Arguments = string.Join(" ", args);
                    }
                    Process.Start(psi);
                    return 0;
                }
                return 1;
            }
            catch (Exception)
            {
                return 1;
            }
        }
    }
}
