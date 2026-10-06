# Opens the Dealio admin panel through an SSH tunnel.
# The panel listens on 127.0.0.1 on the VM only; this forwards a local port to it
# and opens the browser. Close the window (or press Ctrl+C) to end the tunnel.
#
#   powershell -ExecutionPolicy Bypass -File scripts/admin-tunnel.ps1
#
# If %USERPROFILE%\.dealio\admin-token holds the panel token, the browser opens
# already signed in (the token travels in the URL fragment, which never leaves
# this computer, and the page removes it at once). Otherwise the sign-in form asks.
param(
  [string]$SshTarget = 'dealiobot@20.240.162.55',
  [int]$LocalPort = 8787,
  [int]$RemotePort = 8787,
  [string]$TokenFile = (Join-Path $env:USERPROFILE '.dealio\admin-token')
)

$ErrorActionPreference = 'Stop'

function Open-Panel {
  $url = "http://localhost:$LocalPort/"
  if (Test-Path $TokenFile) {
    $token = (Get-Content -Raw $TokenFile).Trim()
    if ($token) { $url += '#login=' + [uri]::EscapeDataString($token) }
  }
  Start-Process $url
}

if (Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "Port $LocalPort is already in use; opening the panel on the existing tunnel."
  Open-Panel
  exit 0
}

Write-Host "Opening SSH tunnel localhost:$LocalPort -> $SshTarget 127.0.0.1:$RemotePort ..."
$ssh = Start-Process -FilePath 'ssh' -PassThru -NoNewWindow -ArgumentList @(
  '-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30',
  '-L', "127.0.0.1:${LocalPort}:127.0.0.1:${RemotePort}", $SshTarget
)

$deadline = (Get-Date).AddSeconds(30)
while (-not (Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue)) {
  if ($ssh.HasExited) { throw "SSH exited with code $($ssh.ExitCode); check the key and host." }
  if ((Get-Date) -gt $deadline) { $ssh.Kill(); throw 'The tunnel did not open within 30 seconds.' }
  Start-Sleep -Milliseconds 300
}

Open-Panel
Write-Host "Admin panel: http://localhost:$LocalPort/  (close this window to end the tunnel)"
try {
  $ssh.WaitForExit()
} finally {
  if (-not $ssh.HasExited) { $ssh.Kill() }
}
