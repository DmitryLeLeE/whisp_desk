; Установщик WHISP MEDIA DESK (Inno Setup 6). Сборка: iscc installer\whisp_desk.iss
; Программа — один exe; установщик нужен ради ярлыков и удаления через «Программы и компоненты».
#define AppName "WHISP MEDIA DESK"
#define AppVersion "1.0.0"
[Setup]
AppId={{6E0D2A64-6B8C-4E3B-9A62-5B7E1D7B0F31}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=DmitryLeLeE
DefaultDirName={localappdata}\Programs\WHISP_MEDIA_DESK
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=WHISP_MEDIA_DESK-setup
Compression=lzma2/fast
SolidCompression=no
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\WHISP_MEDIA_DESK.exe
ArchitecturesInstallIn64BitMode=x64compatible
[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"
[Tasks]
Name: "desktopicon"; Description: "Ярлык на рабочем столе"; Flags: unchecked
[Files]
Source: "..\dist\WHISP_MEDIA_DESK.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\WHISP_MEDIA_DESK.exe"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\WHISP_MEDIA_DESK.exe"; Tasks: desktopicon
[Run]
Filename: "{app}\WHISP_MEDIA_DESK.exe"; Description: "Запустить {#AppName}"; Flags: nowait postinstall skipifsilent
