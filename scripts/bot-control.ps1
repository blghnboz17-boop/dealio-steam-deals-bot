[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Start', 'Stop', 'Restart')]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'
$resolvedProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd('\')
$runtimeDirectory = Join-Path $resolvedProjectRoot '.runtime'
$pidPath = Join-Path $runtimeDirectory 'bot.pid'
$nodePidPath = Join-Path $runtimeDirectory 'bot.node.pid'
$stdoutPath = Join-Path $runtimeDirectory 'bot.stdout.log'
$stderrPath = Join-Path $runtimeDirectory 'bot.stderr.log'
$shutdownRequestPath = Join-Path $runtimeDirectory 'shutdown.request'
$runnerPath = Join-Path $resolvedProjectRoot 'scripts\run-bot.ps1'

function Write-Status {
    param([string]$Message)

    Write-Host "[bot] $Message"
}

function Get-ProcessCommandLine {
    param([int]$ProcessId)

    return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
}

function Test-ReferencesProject {
    param([string]$CommandLine)

    $commandLine = $CommandLine.Replace('/', '\').ToLowerInvariant()
    $normalizedRoot = $resolvedProjectRoot.Replace('/', '\').ToLowerInvariant()
    return $commandLine.Contains('"' + $normalizedRoot + '"') -or `
        $commandLine.Contains($normalizedRoot + '\')
}

function Test-IsBotRunner {
    param([int]$ProcessId)

    $processInfo = Get-ProcessCommandLine -ProcessId $ProcessId
    if ($null -eq $processInfo -or [string]::IsNullOrWhiteSpace($processInfo.CommandLine)) {
        return $false
    }

    $commandLine = $processInfo.CommandLine.Replace('/', '\').ToLowerInvariant()
    return $commandLine.Contains('run-bot.ps1') -and `
        (Test-ReferencesProject -CommandLine $processInfo.CommandLine)
}

function Test-IsBotNode {
    param([int]$ProcessId)

    $processInfo = Get-ProcessCommandLine -ProcessId $ProcessId
    if ($null -eq $processInfo -or [string]::IsNullOrWhiteSpace($processInfo.CommandLine)) {
        return $false
    }

    $commandLine = $processInfo.CommandLine.Replace('/', '\').ToLowerInvariant()
    return $processInfo.Name.ToLowerInvariant().StartsWith('node') -and `
        (Test-ReferencesProject -CommandLine $processInfo.CommandLine) -and `
        ($commandLine.Contains('src\index.ts') -or $commandLine.Contains('dist\index.js'))
}

function Get-TrackedProcessId {
    if (-not (Test-Path -LiteralPath $pidPath)) {
        return $null
    }

    $rawPid = (Get-Content -LiteralPath $pidPath -Raw).Trim()
    $processId = 0
    if (-not [int]::TryParse($rawPid, [ref]$processId) -or $processId -le 0) {
        Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
        return $null
    }

    if (Test-IsBotRunner -ProcessId $processId) {
        return $processId
    }

    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    return $null
}

function Find-BotRunners {
    return Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $commandLine = ([string]$_.CommandLine).Replace('/', '\').ToLowerInvariant()
        $commandLine.Contains('run-bot.ps1') -and `
            (Test-ReferencesProject -CommandLine ([string]$_.CommandLine))
    }
}

function Find-BotNodes {
    return Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        Test-IsBotNode -ProcessId ([int]$_.ProcessId)
    }
}

function Get-TrackedNodeProcessId {
    if (-not (Test-Path -LiteralPath $nodePidPath)) {
        return $null
    }

    $rawPid = (Get-Content -LiteralPath $nodePidPath -Raw).Trim()
    $processId = 0
    if (-not [int]::TryParse($rawPid, [ref]$processId) -or $processId -le 0) {
        Remove-Item -LiteralPath $nodePidPath -Force -ErrorAction SilentlyContinue
        return $null
    }

    if (Test-IsBotNode -ProcessId $processId) {
        return $processId
    }

    Remove-Item -LiteralPath $nodePidPath -Force -ErrorAction SilentlyContinue
    return $null
}

function Stop-Bot {
    $processId = Get-TrackedProcessId
    $nodeProcessId = Get-TrackedNodeProcessId
    if ($null -eq $nodeProcessId) {
        $node = @(Find-BotNodes | Select-Object -First 1)
        if ($node.Count -gt 0) {
            $nodeProcessId = [int]$node[0].ProcessId
        }
    }
    if ($null -eq $processId) {
        $runner = @(Find-BotRunners | Select-Object -First 1)
        if ($runner.Count -gt 0) {
            $processId = [int]$runner[0].ProcessId
        } elseif ($null -eq $nodeProcessId) {
            Write-Status 'Bot is not running.'
            return
        }
    }

    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    $displayProcessId = if ($null -ne $nodeProcessId) { $nodeProcessId } else { $processId }
    Write-Status "Requesting graceful shutdown (PID $displayProcessId)..."
    $requestTarget = if ($null -ne $nodeProcessId) { [string]$nodeProcessId } else { 'all' }
    $requestWritten = $true
    try {
        Set-Content -LiteralPath $shutdownRequestPath -Value $requestTarget -NoNewline
    } catch {
        $requestWritten = $false
        Write-Status "Could not write the graceful shutdown request: $($_.Exception.Message)"
    }

    if ($requestWritten) {
        $deadline = [DateTime]::UtcNow.AddSeconds(40)
        while ([DateTime]::UtcNow -lt $deadline) {
            $runnerRunning = $null -ne $processId -and (Test-IsBotRunner -ProcessId $processId)
            $nodeRunning = $null -ne $nodeProcessId -and (Test-IsBotNode -ProcessId $nodeProcessId)
            if (-not $runnerRunning -and -not $nodeRunning) {
                break
            }
            Start-Sleep -Milliseconds 500
        }
    }

    $runnerRunning = $null -ne $processId -and (Test-IsBotRunner -ProcessId $processId)
    $nodeRunning = $null -ne $nodeProcessId -and (Test-IsBotNode -ProcessId $nodeProcessId)
    if ($runnerRunning -or $nodeRunning) {
        if ($requestWritten) {
            Write-Status 'Graceful shutdown timed out; forcing the process tree to stop.'
        } else {
            Write-Status 'Graceful shutdown was unavailable; forcing the process tree to stop.'
        }
        $forceProcessId = if ($runnerRunning) { $processId } else { $nodeProcessId }
        & taskkill.exe /PID $forceProcessId /T /F *> $null
        Start-Sleep -Milliseconds 500
    }

    $runnerRunning = $null -ne $processId -and (Test-IsBotRunner -ProcessId $processId)
    $nodeRunning = $null -ne $nodeProcessId -and (Test-IsBotNode -ProcessId $nodeProcessId)
    if ($runnerRunning -or $nodeRunning) {
        Write-Status "Could not stop the bot process tree (PID $displayProcessId)."
        exit 1
    }

    Remove-Item -LiteralPath $shutdownRequestPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $nodePidPath -Force -ErrorAction SilentlyContinue
    Write-Status 'Bot stopped.'
}

function Start-Bot {
    $processId = Get-TrackedProcessId
    if ($null -ne $processId) {
        Write-Status "Bot is already running (PID $processId)."
        return
    }

    $nodeProcessId = Get-TrackedNodeProcessId
    if ($null -ne $nodeProcessId) {
        Write-Status "Bot is already running (Node PID $nodeProcessId)."
        return
    }

    $node = @(Find-BotNodes | Select-Object -First 1)
    if ($node.Count -gt 0) {
        $nodeProcessId = [int]$node[0].ProcessId
        New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
        Set-Content -LiteralPath $nodePidPath -Value $nodeProcessId -NoNewline
        Write-Status "Bot is already running (Node PID $nodeProcessId)."
        return
    }

    $runner = @(Find-BotRunners | Select-Object -First 1)
    if ($runner.Count -gt 0) {
        $processId = [int]$runner[0].ProcessId
        New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
        Set-Content -LiteralPath $pidPath -Value $processId -NoNewline
        Write-Status "Bot is already running (PID $processId)."
        return
    }

    if (Test-Path -LiteralPath $shutdownRequestPath) {
        Remove-Item -LiteralPath $shutdownRequestPath -Force
    }
    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    $shellPath = (Get-Process -Id $PID).Path
    if ([string]::IsNullOrWhiteSpace($shellPath)) {
        $shellPath = 'powershell.exe'
    }

    $argumentList = '-NoProfile -ExecutionPolicy Bypass -File "' + $runnerPath + '" -ProjectRoot "' + $resolvedProjectRoot + '"'
    $process = Start-Process `
        -FilePath $shellPath `
        -ArgumentList $argumentList `
        -WorkingDirectory $resolvedProjectRoot `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -PassThru

    Set-Content -LiteralPath $pidPath -Value $process.Id -NoNewline
    Start-Sleep -Seconds 1
    if (-not (Test-IsBotRunner -ProcessId $process.Id)) {
        Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
        Write-Status "Bot runner exited during startup. See $stderrPath."
        exit 1
    }
    Write-Status "Bot started (PID $($process.Id))."
    Write-Status "Output: $stdoutPath"
}

switch ($Action) {
    'Start' { Start-Bot }
    'Stop' { Stop-Bot }
    'Restart' {
        Stop-Bot
        Start-Sleep -Milliseconds 500
        Start-Bot
    }
}
