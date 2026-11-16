; Miniaturas dos projetos (.gfxs e .vectorstudio) no Explorador do Windows: registra o provedor
; resources\thumbs\GfxThumbnail.dll (COM do .NET Framework 4, que já vem no Windows). Ver build/thumbs/GfxThumbnail.cs.
!include "WordFunc.nsh"
!define GFX_THUMB_CLSID "{361a5dd4-1f6c-4336-9e32-cd4d9f01174c}"
!define GFX_THUMB_IID "{e357fccd-a995-4576-b01f-234630154e96}"

!macro customInstall
  ${WordReplace} "$INSTDIR\resources\thumbs\GfxThumbnail.dll" "\" "/" "+" $R0
  WriteRegStr SHCTX "Software\Classes\CLSID\${GFX_THUMB_CLSID}" "" "GFX Studio - miniaturas"
  WriteRegStr SHCTX "Software\Classes\CLSID\${GFX_THUMB_CLSID}\InprocServer32" "" "mscoree.dll"
  WriteRegStr SHCTX "Software\Classes\CLSID\${GFX_THUMB_CLSID}\InprocServer32" "ThreadingModel" "Both"
  WriteRegStr SHCTX "Software\Classes\CLSID\${GFX_THUMB_CLSID}\InprocServer32" "Class" "GfxThumbnail.Provider"
  WriteRegStr SHCTX "Software\Classes\CLSID\${GFX_THUMB_CLSID}\InprocServer32" "Assembly" "GfxThumbnail, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null"
  WriteRegStr SHCTX "Software\Classes\CLSID\${GFX_THUMB_CLSID}\InprocServer32" "RuntimeVersion" "v4.0.30319"
  WriteRegStr SHCTX "Software\Classes\CLSID\${GFX_THUMB_CLSID}\InprocServer32" "CodeBase" "file:///$R0"
  WriteRegStr SHCTX "Software\Classes\CLSID\${GFX_THUMB_CLSID}\InprocServer32\1.0.0.0" "Class" "GfxThumbnail.Provider"
  WriteRegStr SHCTX "Software\Classes\CLSID\${GFX_THUMB_CLSID}\InprocServer32\1.0.0.0" "Assembly" "GfxThumbnail, Version=1.0.0.0, Culture=neutral, PublicKeyToken=null"
  WriteRegStr SHCTX "Software\Classes\CLSID\${GFX_THUMB_CLSID}\InprocServer32\1.0.0.0" "RuntimeVersion" "v4.0.30319"
  WriteRegStr SHCTX "Software\Classes\CLSID\${GFX_THUMB_CLSID}\InprocServer32\1.0.0.0" "CodeBase" "file:///$R0"
  WriteRegStr SHCTX "Software\Classes\.gfxs\ShellEx\${GFX_THUMB_IID}" "" "${GFX_THUMB_CLSID}"
  WriteRegStr SHCTX "Software\Classes\.vectorstudio\ShellEx\${GFX_THUMB_IID}" "" "${GFX_THUMB_CLSID}"
  ; Avisa o Explorador para recarregar associações e miniaturas.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\.gfxs\ShellEx\${GFX_THUMB_IID}"
  DeleteRegKey SHCTX "Software\Classes\.vectorstudio\ShellEx\${GFX_THUMB_IID}"
  DeleteRegKey SHCTX "Software\Classes\CLSID\${GFX_THUMB_CLSID}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
