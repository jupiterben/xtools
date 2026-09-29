$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $root 'apps/desktop/src-tauri/icons'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(36, 119, 89))
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 11
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$points = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(128, 49),
    [System.Drawing.PointF]::new(198, 88),
    [System.Drawing.PointF]::new(198, 168),
    [System.Drawing.PointF]::new(128, 207),
    [System.Drawing.PointF]::new(58, 168),
    [System.Drawing.PointF]::new(58, 88)
)
$graphics.DrawPolygon($pen, $points)
$graphics.DrawLine($pen, 58, 88, 128, 128)
$graphics.DrawLine($pen, 198, 88, 128, 128)
$graphics.DrawLine($pen, 128, 128, 128, 207)
$graphics.DrawLine($pen, 94, 69, 164, 108)
$bitmap.Save((Join-Path $destination 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$pen.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
