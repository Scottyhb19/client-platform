# Odyssey PWA icon generator.
#
# Generates the install icons for the client portal:
#   public/icons/icon-192.png            (any, 192x192)
#   public/icons/icon-512.png            (any, 512x512)
#   public/icons/icon-maskable-512.png   (maskable, 512x512)
#   public/icons/icon-apple-touch.png    (iOS home screen, 180x180)
#
# Composition: charcoal background, white "O" in a bold condensed display
# font, accent-green dot to the O's right. The mark fits inside the inner
# 80% (maskable safe zone) of every variant so the same composition serves
# both `any` and `maskable` purposes.
#
# Design tokens used here MUST match docs/polish/client-portal.md sec 4.1
# trace table. If you change a colour, update both.
#
# Run from the repo root:
#   powershell.exe -ExecutionPolicy Bypass -File scripts/generate-pwa-icons.ps1
#
# Re-runnable. New PWA installs pick up the new icon immediately; existing
# installs (none yet pre-launch) keep the cached icon until reinstall.

Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $repoRoot "public\icons"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

# Design tokens (must match @theme in src/app/globals.css).
$bgHex = "#231f20"   # --color-charcoal
$fgHex = "#ffffff"   # white literal (matches topbar text colour)
$dotHex = "#2db24c"  # --color-accent

$bgColor = [System.Drawing.ColorTranslator]::FromHtml($bgHex)
$fgColor = [System.Drawing.ColorTranslator]::FromHtml($fgHex)
$dotColor = [System.Drawing.ColorTranslator]::FromHtml($dotHex)

# Font fallback chain. Barlow Condensed (the design-system display font) is
# loaded by Next.js at runtime, not installed as a Windows system font, so
# we use the closest bundled alternative. Bahnschrift Condensed ships with
# Windows 10/11; Impact and Arial Black are universal fallbacks.
$fontCandidates = @("Bahnschrift Condensed", "Bahnschrift", "Impact", "Arial Black", "Arial")
$installed = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }
$fontName = $fontCandidates | Where-Object { $installed -contains $_ } | Select-Object -First 1
if (-not $fontName) {
    throw "No usable font found. Install one of: $($fontCandidates -join ', ')"
}
Write-Host "Font: $fontName"

function New-OdysseyIcon {
    param(
        [Parameter(Mandatory=$true)][int]$Size,
        [Parameter(Mandatory=$true)][string]$OutputPath
    )

    $bmp = New-Object System.Drawing.Bitmap $Size, $Size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    # Charcoal background.
    $bgBrush = New-Object System.Drawing.SolidBrush $bgColor
    $g.FillRectangle($bgBrush, 0, 0, $Size, $Size)
    $bgBrush.Dispose()

    # Safe zone (maskable spec: keep meaningful content inside the inner 80%).
    $safe = $Size * 0.8

    # Letter "O" — render via GraphicsPath so we get the actual glyph bounds
    # (not the em-box padded MeasureString returns). Pick a font size that
    # produces a glyph height of ~85% of the safe zone, leaving headroom
    # for the dot's vertical offset.
    $fontFamily = New-Object System.Drawing.FontFamily $fontName
    $style = [int]([System.Drawing.FontStyle]::Bold)

    # Probe at unit size to learn the glyph-height : font-size ratio.
    $probe = New-Object System.Drawing.Drawing2D.GraphicsPath
    $probe.AddString("O", $fontFamily, $style, 100.0, [System.Drawing.PointF]::new(0, 0), [System.Drawing.StringFormat]::GenericDefault)
    $probeBounds = $probe.GetBounds()
    $probe.Dispose()

    if ($probeBounds.Height -le 0) {
        throw "GraphicsPath produced zero-height bounds for 'O' in font '$fontName'."
    }
    $glyphRatio = $probeBounds.Height / 100.0
    $targetGlyphHeight = $safe * 0.85
    $letterPx = $targetGlyphHeight / $glyphRatio

    # Real path at target size.
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddString("O", $fontFamily, $style, $letterPx, [System.Drawing.PointF]::new(0, 0), [System.Drawing.StringFormat]::GenericDefault)
    $oBounds = $path.GetBounds()

    # Dot — diameter proportional to glyph height. ~22% reads as a confident
    # punctuation mark, not a stray pixel, at any size.
    $dotDiameter = $oBounds.Height * 0.22
    $gap = $oBounds.Height * 0.06

    # Group bounds: (O bounds) + (gap) + (dot diameter), width-wise.
    $groupWidth = $oBounds.Width + $gap + $dotDiameter
    $groupHeight = $oBounds.Height

    # Centre the group in the canvas.
    $groupX = ($Size - $groupWidth) / 2.0
    $groupY = ($Size - $groupHeight) / 2.0

    # Translate path so its top-left sits at ($groupX, $groupY).
    $matrix = New-Object System.Drawing.Drawing2D.Matrix
    $matrix.Translate(($groupX - $oBounds.X), ($groupY - $oBounds.Y))
    $path.Transform($matrix)
    $matrix.Dispose()

    # Fill white "O".
    $fgBrush = New-Object System.Drawing.SolidBrush $fgColor
    $g.FillPath($fgBrush, $path)
    $fgBrush.Dispose()
    $path.Dispose()

    # Draw accent-green dot at the O's baseline (bottom of glyph bbox).
    $dotBrush = New-Object System.Drawing.SolidBrush $dotColor
    $dotX = $groupX + $oBounds.Width + $gap
    $dotY = $groupY + $groupHeight - $dotDiameter
    $g.FillEllipse($dotBrush, $dotX, $dotY, $dotDiameter, $dotDiameter)
    $dotBrush.Dispose()

    $g.Dispose()

    $bmp.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()

    $bytes = (Get-Item $OutputPath).Length
    Write-Host ("  {0,-30} {1,7} bytes" -f (Split-Path $OutputPath -Leaf), $bytes)
}

Write-Host "Output: $outDir"
New-OdysseyIcon -Size 192 -OutputPath (Join-Path $outDir "icon-192.png")
New-OdysseyIcon -Size 512 -OutputPath (Join-Path $outDir "icon-512.png")
New-OdysseyIcon -Size 512 -OutputPath (Join-Path $outDir "icon-maskable-512.png")
New-OdysseyIcon -Size 180 -OutputPath (Join-Path $outDir "icon-apple-touch.png")
Write-Host "Done."
