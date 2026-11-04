; ========================================================================
; Aqua Home Appliance — NSIS Installer Script
; Produces standard Windows Setup: Aqua Home Appliance Setup 1.0.0.exe
; ========================================================================

Unicode true
SetCompressor /SOLID lzma

; Ensure working directory is workspace root
!cd ".."

!define PRODUCT_NAME "Aqua Home Appliance"
!define PRODUCT_VERSION "1.0.0"
!define PRODUCT_PUBLISHER "Aqua Home Appliance"
!define PRODUCT_DIR_REGKEY "Software\AquaHomeAppliance"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "release/Aqua Home Appliance Setup 1.0.0.exe"
InstallDir "$LOCALAPPDATA\Programs\Aqua Home Appliance"
InstallDirRegKey HKCU "${PRODUCT_DIR_REGKEY}" "Install_Dir"
RequestExecutionLevel user

!include "MUI2.nsh"

!define MUI_ICON "electron/assets/icon.ico"
!define MUI_UNICON "electron/assets/icon.ico"
!define MUI_ABORTWARNING

; Welcome Page
!insertmacro MUI_PAGE_WELCOME

; Directory Selection Page
!insertmacro MUI_PAGE_DIRECTORY

; Installation Progress Page
!insertmacro MUI_PAGE_INSTFILES

; Finish Page with Launch checkbox
!define MUI_FINISHPAGE_RUN "$INSTDIR\Aqua Home Appliance.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Aqua Home Appliance"
!insertmacro MUI_PAGE_FINISH

; Uninstaller Pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Language
!insertmacro MUI_LANGUAGE "English"

; ---------------- Installation Section ----------------
Section "MainSection" SEC01
  SetOutPath "$INSTDIR"
  SetOverwrite on

  ; Copy all packed binaries and assets from win-unpacked
  File /r "release/win-unpacked/*.*"

  ; Create Desktop Shortcut
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\Aqua Home Appliance.exe" "" "$INSTDIR\Aqua Home Appliance.exe" 0

  ; Create Start Menu Shortcuts
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\Aqua Home Appliance.exe" "" "$INSTDIR\Aqua Home Appliance.exe" 0
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall ${PRODUCT_NAME}.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\Uninstall.exe" 0

  ; Create uninstaller executable
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Add/Remove Programs registry registration
  WriteRegStr HKCU "${PRODUCT_DIR_REGKEY}" "Install_Dir" "$INSTDIR"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayIcon" "$INSTDIR\Aqua Home Appliance.exe,0"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegDWORD HKCU "${PRODUCT_UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${PRODUCT_UNINST_KEY}" "NoRepair" 1
SectionEnd

; ---------------- Uninstallation Section ----------------
Section "Uninstall"
  ; Remove Desktop and Start Menu Shortcuts
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall ${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

  ; Remove Application Files (User database in D:\AquaHomeData is strictly preserved!)
  RMDir /r "$INSTDIR"

  ; Clean Registry
  DeleteRegKey HKCU "${PRODUCT_UNINST_KEY}"
  DeleteRegKey HKCU "${PRODUCT_DIR_REGKEY}"
SectionEnd
