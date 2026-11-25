; Custom NSIS uninstaller hooks for nextGx Browser.
; Cleans up any user-scope HTTP/HTTPS protocol handler registrations written
; when the user set nextGx as their default browser, so uninstalling never
; leaves dangling registry keys pointing to a removed executable.
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\nextgxbrowser"
!macroend
