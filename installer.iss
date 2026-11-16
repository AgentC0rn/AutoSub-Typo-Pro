#ifndef MyAppVersion
  #define MyAppVersion "2.0.1"
#endif

[Setup]
AppId={{8F6E2B3A-4E7A-4E8B-9B7B-2026AUTOSUBPRO}
AppName=AutoSub Typo Pro for CapCut
AppVersion={#MyAppVersion}
AppPublisher=AutoSub Typo Pro
DefaultDirName={localappdata}\Programs\AutoSub Typo Pro for CapCut
DefaultGroupName=AutoSub Typo Pro for CapCut
PrivilegesRequired=lowest
AllowNoIcons=yes
OutputDir=dist
OutputBaseFilename=AutoSub-Typo-Pro-Setup-{#MyAppVersion}-Win64
SetupIconFile=resources\app\shared\assets\app.ico
UninstallDisplayIcon={app}\resources\app\shared\assets\app.ico
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "AutoSub Typo Pro.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "Chạy AutoSub Typo Pro.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "*.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "*.pak"; DestDir: "{app}"; Flags: ignoreversion
Source: "*.dat"; DestDir: "{app}"; Flags: ignoreversion
Source: "*.bin"; DestDir: "{app}"; Flags: ignoreversion
Source: "vk_swiftshader_icd.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "LICENSE*.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "LICENSES.chromium.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "locales\*"; DestDir: "{app}\locales"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "resources\elevate.exe"; DestDir: "{app}\resources"; Flags: ignoreversion
Source: "resources\app\*"; DestDir: "{app}\resources\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "resources\tools\*"; DestDir: "{app}\resources\tools"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "certs\*"; DestDir: "{app}\certs"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\AutoSub Typo Pro for CapCut"; Filename: "{app}\AutoSub Typo Pro.exe"; IconFilename: "{app}\resources\app\shared\assets\app.ico"
Name: "{autodesktop}\AutoSub Typo Pro for CapCut"; Filename: "{app}\AutoSub Typo Pro.exe"; IconFilename: "{app}\resources\app\shared\assets\app.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\AutoSub Typo Pro.exe"; Description: "{cm:LaunchProgram,AutoSub Typo Pro for CapCut}"; Flags: nowait postinstall skipifsilent
