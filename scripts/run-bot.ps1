[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $ProjectRoot

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($null -eq $npmCommand) {
    $npmCommand = Get-Command npm -ErrorAction Stop
}

$startedAt = [DateTime]::UtcNow.ToString('o')
Write-Output "$startedAt [runner] Starting bot."
& $npmCommand.Source run dev
$stoppedAt = [DateTime]::UtcNow.ToString('o')
Write-Output "$stoppedAt [runner] Bot exited with code $LASTEXITCODE."
exit $LASTEXITCODE
