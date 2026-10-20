param(
    [Parameter(Mandatory = $true)][uint32]$TargetProcess,
    [string]$ScreenshotPath = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
public static class EacUpdateRepairProbe {
    public delegate bool EnumCallback(IntPtr window, IntPtr state);
    [StructLayout(LayoutKind.Sequential)] public struct Rect {public int Left, Top, Right, Bottom;}
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumCallback callback, IntPtr state);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumCallback callback, IntPtr state);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr window, StringBuilder name, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextLengthW(IntPtr window);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window, StringBuilder name, int count);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rectangle);
    [DllImport("user32.dll")] static extern bool PostMessageW(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    public static string Text(IntPtr window) {var text=new StringBuilder(GetWindowTextLengthW(window)+1);GetWindowTextW(window,text,text.Capacity);return text.ToString();}
    static string Class(IntPtr window) {var name=new StringBuilder(128);GetClassNameW(window,name,name.Capacity);return name.ToString();}
    public static IntPtr Find(uint pid) {
        IntPtr found=IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr state) {uint owner;GetWindowThreadProcessId(window,out owner);if(owner==pid&&IsWindowVisible(window)&&Class(window)=="#32770"){found=window;return false;}return true;},IntPtr.Zero);
        return found;
    }
    public static string Body(IntPtr parent) {
        var items=new List<string>();
        EnumChildWindows(parent,delegate(IntPtr window, IntPtr state){if(Class(window)=="Static"){string text=Text(window);if(text.Length>0)items.Add(text);}return true;},IntPtr.Zero);
        return String.Join("\n",items.ToArray());
    }
    public static bool Decline(IntPtr window) {return PostMessageW(window,0x0111,new IntPtr(7),IntPtr.Zero);}
    public static bool Capture(IntPtr window, string file) {
        Rect rect;if(!GetWindowRect(window,out rect))return false;
        using(var bitmap=new Bitmap(rect.Right-rect.Left,rect.Bottom-rect.Top)) {
            using(var graphics=Graphics.FromImage(bitmap)) {var dc=graphics.GetHdc();try{if(!PrintWindow(window,dc,0))return false;}finally{graphics.ReleaseHdc(dc);}}
            bitmap.Save(file,ImageFormat.Png);
        }
        return true;
    }
}
'@
$deadline=[DateTime]::UtcNow.AddSeconds(15)
$dialog=[IntPtr]::Zero
while([DateTime]::UtcNow -lt $deadline){
    $dialog=[EacUpdateRepairProbe]::Find($TargetProcess)
    if($dialog -ne [IntPtr]::Zero){break}
    Start-Sleep -Milliseconds 50
}
if($dialog -eq [IntPtr]::Zero){throw 'Native repair dialog was not visible for the target process'}
$bounds=New-Object EacUpdateRepairProbe+Rect
if(-not [EacUpdateRepairProbe]::GetWindowRect($dialog,[ref]$bounds)){throw 'Native repair dialog bounds unavailable'}
$captureSaved=$false
if($ScreenshotPath){$captureSaved=[EacUpdateRepairProbe]::Capture($dialog,$ScreenshotPath);if(-not $captureSaved){throw 'Native repair dialog capture failed'}}
$report=@{visible=[EacUpdateRepairProbe]::IsWindowVisible($dialog);title=[EacUpdateRepairProbe]::Text($dialog);body=[EacUpdateRepairProbe]::Body($dialog);width=$bounds.Right-$bounds.Left;height=$bounds.Bottom-$bounds.Top;captureSaved=$captureSaved;targetProcess=$TargetProcess}
$report.declined=[EacUpdateRepairProbe]::Decline($dialog)
if(-not $report.declined){throw 'Native repair dialog decline failed'}
[Console]::Out.WriteLine(($report | ConvertTo-Json -Compress))
