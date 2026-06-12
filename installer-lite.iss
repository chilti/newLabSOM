[Setup]
AppName=Sinapsis Map (newLabSOM)
AppVersion=1.0.0
DefaultDirName={localappdata}\SinapsisMap
DefaultGroupName=Sinapsis Map
OutputDir=Output
OutputBaseFilename=SinapsisMap_Installer_Lite
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
SetupIconFile=frontend\public\icon.ico
UninstallDisplayIcon={app}\LabSOM.Backend.Core.exe
WizardImageFile=wizard_large.bmp
WizardSmallImageFile=wizard_small.bmp

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; C# Photino Application files
Source: "publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; Python Engine scripts
Source: "engine\*"; DestDir: "{app}\engine"; Excludes: "__pycache__\, .venv\, venv\, temp\"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Sinapsis Map"; Filename: "{app}\LabSOM.Backend.Core.exe"
Name: "{autodesktop}\Sinapsis Map"; Filename: "{app}\LabSOM.Backend.Core.exe"; Tasks: desktopicon

[Code]
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
begin
  // Check if Python is installed
  if not Exec('cmd.exe', '/c python --version', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    MsgBox('Python no fue encontrado en el sistema. Sinapsis Map requiere Python para procesar algoritmos de IA. Por favor, instala Python 3 y marca la opcion "Add Python to PATH" durante la instalacion.', mbCriticalError, MB_OK);
    Result := False;
    Exit;
  end;
  Result := True;
end;

[Run]
; Install Python requirements automatically upon finish
Filename: "cmd.exe"; Parameters: "/c pip install -r ""{app}\engine\requirements.txt"""; Description: "Installing AI dependencies (Python)"; Flags: postinstall runhidden waituntilterminated
Filename: "{app}\LabSOM.Backend.Core.exe"; Description: "{cm:LaunchProgram,Sinapsis Map}"; Flags: nowait postinstall skipifsilent
