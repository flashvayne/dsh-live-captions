# Always-on-top caption overlay window.
#
# ASCII only on purpose: Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI, so
# every user-visible string (Chinese included) is fetched from the plugin's own
# /overlay-boot payload instead of being embedded here.
#
# The window polls /state, renders the newest bilingual captions and posts its
# own settings (font size, opacity, lock, close) plus its screen geometry back to
# the plugin, so the panel and this window stay one system.
param(
  [Parameter(Mandatory = $true)][string]$ApiUrl
)

$ErrorActionPreference = 'Stop'
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Windows PowerShell starts DPI-unaware, which makes WPF render at 96 dpi and
# lets the OS bitmap-scale the window: blurry text and coordinates that do not
# match the screen. Ask for per-monitor v2 awareness before any window exists.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class LcDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static void Enable() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) { return; } } catch { }
    try { SetProcessDPIAware(); } catch { }
  }
}
"@
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class LcRect {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
}
"@
[LcDpi]::Enable()

function Invoke-LcApi {
  param([string]$Method, [string]$Path, $Body)
  try {
    if ($Method -eq 'GET') {
      return Invoke-RestMethod -Uri ($ApiUrl + $Path) -Method Get -TimeoutSec 5
    }
    $json = $Body | ConvertTo-Json -Depth 6 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    return Invoke-RestMethod -Uri ($ApiUrl + $Path) -Method Post -ContentType 'application/json;charset=utf-8' -Body $bytes -TimeoutSec 5
  } catch {
    return $null
  }
}

$boot = Invoke-LcApi -Method GET -Path '/overlay-boot'
if ($null -eq $boot) { exit 1 }
$labels = $boot.labels
$settings = $boot.settings
$geometry = $boot.geometry

function Save-Settings {
  param($Patch)
  Invoke-LcApi -Method POST -Path '/command' -Body @{ action = 'settings'; settings = $Patch } | Out-Null
}

# ------------------------------------------------------------------ window

$win = New-Object System.Windows.Window
$win.Title = [string]$labels.title
$win.WindowStyle = [System.Windows.WindowStyle]::None
$win.AllowsTransparency = $true
$win.Background = [System.Windows.Media.Brushes]::Transparent
$win.Topmost = $true
$win.ShowInTaskbar = $false
$win.ResizeMode = [System.Windows.ResizeMode]::NoResize
# Explicit geometry keeps WPF from sizing the window to its content; the Loaded
# handler replaces these with the remembered position and size.
$win.WindowStartupLocation = [System.Windows.WindowStartupLocation]::Manual
$win.Left = 200
$win.Top = 200
$win.Width = 748
$win.Height = 235

$color = [System.Windows.Media.Color]::FromArgb(255, 22, 24, 30)
$root = New-Object System.Windows.Controls.Border
$root.CornerRadius = New-Object System.Windows.CornerRadius(12)
$root.Background = New-Object System.Windows.Media.SolidColorBrush($color)
$root.BorderBrush = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(46, 255, 255, 255))
$root.BorderThickness = New-Object System.Windows.Thickness(1)
$root.Padding = New-Object System.Windows.Thickness(12, 8, 12, 8)

$grid = New-Object System.Windows.Controls.Grid
$rowTools = New-Object System.Windows.Controls.RowDefinition
$rowTools.Height = [System.Windows.GridLength]::Auto
$rowBody = New-Object System.Windows.Controls.RowDefinition
$rowBody.Height = [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star)
$grid.RowDefinitions.Add($rowTools)
$grid.RowDefinitions.Add($rowBody)

$tools = New-Object System.Windows.Controls.StackPanel
$tools.Orientation = 'Horizontal'
$tools.Margin = New-Object System.Windows.Thickness(0, 0, 0, 6)
[System.Windows.Controls.Grid]::SetRow($tools, 0)

function New-ToolButton {
  param([string]$Text, [string]$Tip, [scriptblock]$OnClick)
  $button = New-Object System.Windows.Controls.Button
  $button.Content = $Text
  $button.ToolTip = $Tip
  $button.Padding = New-Object System.Windows.Thickness(6, 1, 6, 1)
  $button.Margin = New-Object System.Windows.Thickness(0, 0, 4, 0)
  $button.FontSize = 11
  $button.Background = [System.Windows.Media.Brushes]::Transparent
  $button.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(230, 232, 234, 240))
  $button.BorderBrush = [System.Windows.Media.Brushes]::Transparent
  $button.Cursor = [System.Windows.Input.Cursors]::Hand
  $button.Add_Click($OnClick)
  return $button
}

$tools.Children.Add((New-ToolButton -Text ([string]$labels.fontOut) -Tip ([string]$labels.font) -OnClick {
  $script:settings.lyricFontSize = [Math]::Max(14, [int]$script:settings.lyricFontSize - 2)
  Save-Settings @{ lyricFontSize = $script:settings.lyricFontSize }
  $script:dirty = $true
})) | Out-Null
$tools.Children.Add((New-ToolButton -Text ([string]$labels.fontIn) -Tip ([string]$labels.font) -OnClick {
  $script:settings.lyricFontSize = [Math]::Min(34, [int]$script:settings.lyricFontSize + 2)
  Save-Settings @{ lyricFontSize = $script:settings.lyricFontSize }
  $script:dirty = $true
})) | Out-Null
$tools.Children.Add((New-ToolButton -Text ([string]$labels.dimOut) -Tip ([string]$labels.dim) -OnClick {
  $script:settings.lyricOpacity = [Math]::Max(0.3, [double]$script:settings.lyricOpacity - 0.08)
  Save-Settings @{ lyricOpacity = $script:settings.lyricOpacity }
  $script:dirty = $true
})) | Out-Null
$tools.Children.Add((New-ToolButton -Text ([string]$labels.dimIn) -Tip ([string]$labels.dim) -OnClick {
  $script:settings.lyricOpacity = [Math]::Min(1, [double]$script:settings.lyricOpacity + 0.08)
  Save-Settings @{ lyricOpacity = $script:settings.lyricOpacity }
  $script:dirty = $true
})) | Out-Null
$tools.Children.Add((New-ToolButton -Text ([string]$labels.source) -Tip ([string]$labels.source) -OnClick {
  $script:settings.lyricShowSource = -not [bool]$script:settings.lyricShowSource
  Save-Settings @{ lyricShowSource = $script:settings.lyricShowSource }
  $script:dirty = $true
})) | Out-Null
$tools.Children.Add((New-ToolButton -Text ([string]$labels.lock) -Tip ([string]$labels.lockHint) -OnClick {
  $script:settings.lyricLocked = $true
  Save-Settings @{ lyricLocked = $true }
})) | Out-Null
$closeButton = New-ToolButton -Text ([string]$labels.closeGlyph) -Tip ([string]$labels.close) -OnClick {
  Invoke-LcApi -Method POST -Path '/command' -Body @{ action = 'overlay_close' } | Out-Null
  $script:running = $false
}
$closeButton.HorizontalAlignment = 'Right'
$closeButton.Margin = New-Object System.Windows.Thickness(0)
$closeHost = New-Object System.Windows.Controls.StackPanel
$closeHost.Orientation = 'Horizontal'
$closeHost.HorizontalAlignment = 'Right'
$closeHost.Children.Add($closeButton) | Out-Null
$tools.Children.Add($closeHost) | Out-Null
$tools.Children | ForEach-Object { if ($_ -is [System.Windows.Controls.Button]) { $_.HorizontalAlignment = 'Left' } }
$tools.Children[$tools.Children.Count - 1].HorizontalAlignment = 'Stretch'

$scroll = New-Object System.Windows.Controls.ScrollViewer
$scroll.VerticalScrollBarVisibility = 'Hidden'
$scroll.HorizontalScrollBarVisibility = 'Disabled'
[System.Windows.Controls.Grid]::SetRow($scroll, 1)

$items = New-Object System.Windows.Controls.StackPanel
$items.Margin = New-Object System.Windows.Thickness(0, 2, 4, 0)
$scroll.Content = $items

$grid.Children.Add($tools) | Out-Null
$grid.Children.Add($scroll) | Out-Null
$root.Child = $grid
$win.Content = $root

# ------------------------------------------------------------------ state

$script:settings = @{
  lyricFontSize = if ($null -ne $settings.lyricFontSize) { [int]$settings.lyricFontSize } else { 22 }
  lyricOpacity = if ($null -ne $settings.lyricOpacity) { [double]$settings.lyricOpacity } else { 0.92 }
  lyricShowSource = if ($null -ne $settings.lyricShowSource) { [bool]$settings.lyricShowSource } else { $true }
  lyricLocked = if ($null -ne $settings.lyricLocked) { [bool]$settings.lyricLocked } else { $false }
}
$script:running = $true
$script:dirty = $true
$script:signature = ''
$script:lockedShown = $false
$script:geomTimer = $null
$script:scale = 1.0

function Get-Scale {
  # DIP -> physical pixel factor for this monitor (1 for 100% scaling).
  try {
    $source = [System.Windows.PresentationSource]::FromVisual($win)
    if ($null -ne $source) { return [double]$source.CompositionTarget.TransformToDevice.M11 }
  } catch { }
  return 1.0
}

function Save-Geometry {
  # Settings hold DIPs (the same unit the web overlay uses), never raw pixels.
  Save-Settings @{ lyricX = [int]$win.Left; lyricY = [int]$win.Top; lyricW = [int]$win.Width; lyricH = [int]$win.Height }
}

# ------------------------------------------------------------------ resize
# A transparent WPF window cannot use the native resize frame, so the edges are
# handled here: mouse down near an edge starts a drag, SetWindowPos follows it,
# and the final rect is persisted.

$script:resize = $null
$EDGE = 7

function Get-Zone {
  param([System.Windows.Point]$Point)
  $w = $win.ActualWidth
  $h = $win.ActualHeight
  $left = $Point.X -lt $EDGE
  $right = $Point.X -gt ($w - $EDGE)
  $top = $Point.Y -lt $EDGE
  $bottom = $Point.Y -gt ($h - $EDGE)
  if ($left -and $top) { return 'nw' }
  if ($right -and $top) { return 'ne' }
  if ($left -and $bottom) { return 'sw' }
  if ($right -and $bottom) { return 'se' }
  if ($left) { return 'w' }
  if ($right) { return 'e' }
  if ($top) { return 'n' }
  if ($bottom) { return 's' }
  return ''
}

$root.Add_PreviewMouseMove({
  param($sender, $event)
  if ($null -ne $script:resize) {
    $now = [System.Windows.Forms.Cursor]::Position
    $state = $script:resize
    $scale = $script:scale
    $dx = ($now.X - $state.startX) / $scale
    $dy = ($now.Y - $state.startY) / $scale
    $x = $state.x; $y = $state.y; $w = $state.w; $h = $state.h
    if ($state.zone.Contains('e')) { $w = [Math]::Max(320, $state.w + $dx) }
    if ($state.zone.Contains('s')) { $h = [Math]::Max(140, $state.h + $dy) }
    if ($state.zone.Contains('w')) {
      $w = [Math]::Max(320, $state.w - $dx)
      $x = $state.x + ($state.w - $w)
    }
    if ($state.zone.Contains('n')) {
      $h = [Math]::Max(140, $state.h - $dy)
      $y = $state.y + ($state.h - $h)
    }
    $script:resize.x = $x; $script:resize.y = $y; $script:resize.w = $w; $script:resize.h = $h
    $win.Left = $x; $win.Top = $y; $win.Width = $w; $win.Height = $h
    $event.Handled = $true
    return
  }
  if (-not $win.IsMouseOver) { return }
  $zone = Get-Zone -Point $event.GetPosition($win)
  switch ($zone) {
    'w' { $win.Cursor = [System.Windows.Input.Cursors]::SizeWE }
    'e' { $win.Cursor = [System.Windows.Input.Cursors]::SizeWE }
    'n' { $win.Cursor = [System.Windows.Input.Cursors]::SizeNS }
    's' { $win.Cursor = [System.Windows.Input.Cursors]::SizeNS }
    'nw' { $win.Cursor = [System.Windows.Input.Cursors]::SizeNWSE }
    'se' { $win.Cursor = [System.Windows.Input.Cursors]::SizeNWSE }
    'ne' { $win.Cursor = [System.Windows.Input.Cursors]::SizeNESW }
    'sw' { $win.Cursor = [System.Windows.Input.Cursors]::SizeNESW }
    default { $win.Cursor = [System.Windows.Input.Cursors]::Arrow }
  }
})

$root.Add_PreviewMouseLeftButtonDown({
  param($sender, $event)
  if ($script:settings.lyricLocked) { return }
  $zone = Get-Zone -Point $event.GetPosition($win)
  if ($zone -ne '') {
    $cursor = [System.Windows.Forms.Cursor]::Position
    $script:resize = @{
      zone = $zone; startX = $cursor.X; startY = $cursor.Y
      x = [double]$win.Left; y = [double]$win.Top; w = [double]$win.Width; h = [double]$win.Height
    }
    $root.CaptureMouse() | Out-Null
    $event.Handled = $true
  }
})

$root.Add_PreviewMouseLeftButtonUp({
  param($sender, $event)
  if ($null -ne $script:resize) {
    $script:resize = $null
    $root.ReleaseMouseCapture()
    Save-Geometry
    $event.Handled = $true
  }
})

$root.Add_MouseLeftButtonDown({
  param($sender, $event)
  if ($script:settings.lyricLocked) { return }
  # The toolbar holds buttons: a press there must not become a window drag.
  if ($event.GetPosition($win).Y -lt 36) { return }
  if ((Get-Zone -Point $event.GetPosition($win)) -ne '') { return }
  try { $win.DragMove() } catch { return }
  Save-Geometry
})

# ------------------------------------------------------------------ render

function New-TextBlock {
  param([string]$Text, [double]$Size, [bool]$Bold, [int]$Alpha)
  $block = New-Object System.Windows.Controls.TextBlock
  $block.Text = $Text
  $block.FontSize = $Size
  $block.TextWrapping = 'Wrap'
  $block.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb($Alpha, 232, 234, 240))
  if ($Bold) { $block.FontWeight = [System.Windows.FontWeights]::SemiBold }
  return $block
}

function Update-Entries {
  param($State)
  $state = $State
  if ($null -eq $state) { return }
  $settings = $state.settings
  if ($null -ne $settings) {
    if ($null -ne $settings.lyricFontSize) { $script:settings.lyricFontSize = [int]$settings.lyricFontSize }
    if ($null -ne $settings.lyricOpacity) { $script:settings.lyricOpacity = [double]$settings.lyricOpacity }
    if ($null -ne $settings.lyricShowSource) { $script:settings.lyricShowSource = [bool]$settings.lyricShowSource }
    if ($null -ne $settings.lyricLocked) { $script:settings.lyricLocked = [bool]$settings.lyricLocked }
    if ($null -eq $settings.translate) { $translate = $true } else { $translate = [bool]$settings.translate }
  } else {
    $translate = $true
  }
  if ($state.settings -and $state.settings.lyricVisible -eq $false) { $script:running = $false; return }

  $baseSize = [double]$script:settings.lyricFontSize
  $win.Opacity = [double]$script:settings.lyricOpacity

  $locked = [bool]$script:settings.lyricLocked
  if ($locked -ne $script:lockedShown) {
    $script:lockedShown = $locked
    $root.IsHitTestVisible = -not $locked
    if ($locked) { $tools.Visibility = 'Collapsed' } else { $tools.Visibility = 'Visible' }
  }

  $running = ($state.status -eq 'running' -or $state.status -eq 'starting')
  $rows = @($state.entries)
  $signature = ''
  foreach ($row in $rows) { $signature += ([string]$row.seq + '|' + [string]$row.translation + ';') }
  $signature = [string]$baseSize + '|' + [string]$script:settings.lyricShowSource + '|' + [string]$translate + '|' + [string]$running + '|' + $signature
  if ($signature -eq $script:signature) { return }
  $script:signature = $signature

  $items.Children.Clear()
  if ($rows.Count -eq 0) {
    $idle = if ($running) { [string]$labels.listening } else { [string]$labels.idle }
    $items.Children.Add((New-TextBlock -Text $idle -Size ($baseSize * 0.8) -Bold $false -Alpha 200)) | Out-Null
  } else {
    $limit = [Math]::Max(0, $rows.Count - 60)
    for ($index = $limit; $index -lt $rows.Count; $index++) {
      $row = $rows[$index]
      $entry = New-Object System.Windows.Controls.Grid
      $entry.Margin = New-Object System.Windows.Thickness(0, 0, 0, 8)
      $colTime = New-Object System.Windows.Controls.ColumnDefinition
      $colTime.Width = [System.Windows.GridLength]::Auto
      $colText = New-Object System.Windows.Controls.ColumnDefinition
      $colText.Width = [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star)
      $entry.ColumnDefinitions.Add($colTime) | Out-Null
      $entry.ColumnDefinitions.Add($colText) | Out-Null
      $time = New-TextBlock -Text ([string]$row.at) -Size ([Math]::Max(9, $baseSize * 0.45)) -Bold $false -Alpha 170
      $time.Margin = New-Object System.Windows.Thickness(0, 2, 8, 0)
      $time.TextWrapping = 'NoWrap'
      $time.VerticalAlignment = 'Top'
      $stack = New-Object System.Windows.Controls.StackPanel
      if ($script:settings.lyricShowSource) {
        $stack.Children.Add((New-TextBlock -Text ([string]$row.text) -Size ($baseSize * 0.72) -Bold $false -Alpha 210)) | Out-Null
      }
      $hasTranslation = $null -ne $row.translation -and [string]$row.translation -ne [string]$row.text
      if ($translate -and $hasTranslation) {
        $stack.Children.Add((New-TextBlock -Text ([string]$row.translation) -Size $baseSize -Bold $true -Alpha 255)) | Out-Null
      }
      $entry.Children.Add($time) | Out-Null
      $entry.Children.Add($stack) | Out-Null
      [System.Windows.Controls.Grid]::SetColumn($stack, 1)
      $items.Children.Add($entry) | Out-Null
    }
    $scroll.ScrollToEnd()
  }
}

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(400)
$script:misses = 0
$timer.Add_Tick({
  if (-not $script:running) { $timer.Stop(); $win.Close(); return }
  $state = Invoke-LcApi -Method GET -Path '/state?since=0'
  if ($null -eq $state -or $null -eq $state.state) {
    # The Host is gone (app quit or plugin unloaded): never leave an orphan
    # window floating on top of everything forever.
    $script:misses += 1
    if ($script:misses -gt 15) { $timer.Stop(); $win.Close() }
    return
  }
  $script:misses = 0
  Update-Entries -State $state.state
})
$timer.Start()

# A geometry change is persisted once the drag/resize has settled.
$geomTimer = New-Object System.Windows.Threading.DispatcherTimer
$geomTimer.Interval = [TimeSpan]::FromMilliseconds(1200)
$script:lastRect = ''
$script:lastSaved = ''
$geomTimer.Add_Tick({
  $signature = [string][int]$win.Left + ',' + [string][int]$win.Top + ',' + [string][int]$win.Width + ',' + [string][int]$win.Height
  if ($signature -eq $script:lastRect) { return }
  if ($signature -eq $script:lastSaved) { return }
  $script:lastRect = $signature
  $script:lastSaved = $signature
  Save-Geometry
})
$geomTimer.Start()

$win.Add_Loaded({
  $script:scale = Get-Scale
  $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $areaW = $area.Width / $script:scale
  $areaH = $area.Height / $script:scale
  $areaX = $area.Left / $script:scale
  $areaY = $area.Top / $script:scale
  $w = 748
  $h = 235
  if ($null -ne $geometry) {
    if ($null -ne $geometry.w) { $w = [int]$geometry.w }
    if ($null -ne $geometry.h) { $h = [int]$geometry.h }
  }
  $w = [Math]::Max(320, [Math]::Min($w, $areaW - 16))
  $h = [Math]::Max(140, [Math]::Min($h, $areaH - 16))
  $x = $areaX + [int](($areaW - $w) / 2)
  $y = $areaY + $areaH - $h - [int]($areaH * 0.12)
  if ($null -ne $geometry) {
    if ($null -ne $geometry.x) { $x = [int]$geometry.x }
    if ($null -ne $geometry.y) { $y = [int]$geometry.y }
  }
  $x = [Math]::Max($areaX + 8, [Math]::Min($x, $areaX + $areaW - $w - 8))
  $y = [Math]::Max($areaY + 8, [Math]::Min($y, $areaY + $areaH - $h - 8))
  $win.Left = $x; $win.Top = $y; $win.Width = $w; $win.Height = $h
  # Prime the view immediately instead of waiting for the first tick.
  $state = Invoke-LcApi -Method GET -Path '/state?since=0'
  if ($null -ne $state -and $null -ne $state.state) { Update-Entries -State $state.state }
  # A one-line diagnostic makes DPI/geometry bugs visible without a debugger.
  try {
    $hwnd = (New-Object System.Windows.Interop.WindowInteropHelper($win)).Handle
    $rect = New-Object LcRect+RECT
    [void][LcRect]::GetWindowRect($hwnd, [ref]$rect)
    $diag = 'scale=' + $script:scale + ' dip=' + [int]$win.Left + ',' + [int]$win.Top + ' size=' + [int]$win.Width + 'x' + [int]$win.Height
    $diag += ' phys=' + $rect.Left + ',' + $rect.Top + ' ' + ($rect.Right - $rect.Left) + 'x' + ($rect.Bottom - $rect.Top)
    $diag += ' area=' + $area.Width + 'x' + $area.Height + ' dpi=' + [System.Windows.Media.VisualTreeHelper]::GetDpi($win).DpiScaleX
    [System.IO.File]::WriteAllText((Join-Path $env:TEMP 'lc-overlay.log'), $diag)
  } catch { }
})

$win.Add_Closed({
  $timer.Stop()
  $geomTimer.Stop()
  try { $root.ReleaseMouseCapture() } catch { }
})

[void]$win.ShowDialog()
