; EAC 启动器 Windows 安装包（NSIS）
; 与便携版同源：eac-launcher.exe + runtime/（内置 Node 运行时），
; 安装到当前用户程序目录并创建开始菜单/桌面快捷方式。
;
; 由 .github/workflows/build-installers.yml 在 windows runner 上调用：
;   cd launcher/installer && makensis launcher.nsi
; File 路径相对于脚本所在目录（launcher/installer）。

Unicode true
!include "MUI2.nsh"

!define APP_NAME "EAC 启动器"
!define APP_EXE "eac-launcher.exe"
!define VERSION "0.1.0"

Name "${APP_NAME}"
OutFile "..\..\out\EAC-Launcher-setup-x64.exe"
InstallDir "$LOCALAPPDATA\Programs\EAC Launcher"
InstallDirRegKey HKCU "Software\EAC Launcher" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File "..\src-tauri\target\release\${APP_EXE}"
  SetOutPath "$INSTDIR\runtime"
  File /r "..\runtime\*.*"
  WriteUninstaller "$INSTDIR\uninstall.exe"

  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"

  WriteRegStr HKCU "Software\EAC Launcher" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\EAC Launcher" "Version" "${VERSION}"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\${APP_EXE}"
  RMDir /r "$INSTDIR\runtime"
  Delete "$INSTDIR\uninstall.exe"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  DeleteRegKey HKCU "Software\EAC Launcher"
  RMDir "$INSTDIR"
SectionEnd
