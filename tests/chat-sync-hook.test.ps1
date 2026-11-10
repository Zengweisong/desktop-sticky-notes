$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('sticky-notes-hook-' + [Guid]::NewGuid().ToString('N'))
try {
    [System.IO.Directory]::CreateDirectory($testRoot) | Out-Null
    $scriptPath = Join-Path $testRoot 'hook.ps1'
    $source = Join-Path $PSScriptRoot '..\scripts\chat-sync-hook.ps1'
    [System.IO.File]::WriteAllText($scriptPath, [System.IO.File]::ReadAllText($source), [System.Text.UTF8Encoding]::new($true))
    $transcript = Join-Path $testRoot '中文对话.jsonl'
    $entries = @(
        @{ type = 'session_meta'; payload = @{ cwd = 'C:\项目\中文项目' } },
        @{ type = 'response_item'; payload = @{ type = 'message'; role = 'system'; content = @(@{type='input_text';text='PRIVATE SYSTEM INSTRUCTIONS'}) } },
        @{ type = 'response_item'; payload = @{ type = 'message'; role = 'user'; content = @(@{type='input_text';text='明天给客户发报价'}) } },
        @{ type = 'response_item'; payload = @{ type = 'message'; role = 'assistant'; content = @(@{type='output_text';text='报价计划已经整理好了'}) } },
        @{ type = 'response_item'; payload = @{ type = 'function_call'; name = 'secret_tool'; arguments = 'NOT INCLUDED' } }
    )
    foreach ($entry in $entries) { $entry.timestamp = [DateTimeOffset]::UtcNow.AddSeconds(10).ToString('o') }
    $oldMessage = @{ timestamp='2020-01-01T00:00:00Z'; type='response_item';payload=@{type='message';role='user';content=@(@{type='input_text';text='Do not backfill this historical task'})} }
    $entries += $oldMessage
    $lines = @($entries | ForEach-Object { ConvertTo-Json -InputObject $_ -Depth 10 -Compress })
    [System.IO.File]::WriteAllLines($transcript, $lines, [System.Text.UTF8Encoding]::new($false))
    $eventJson = ConvertTo-Json -Compress @{session_id='test-session';turn_id='test-turn';hook_event_name='Stop';transcript_path=$transcript;stop_hook_active=$false}
    # Native hooks send UTF-8 JSON, including paths containing unicode characters.
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $eventJson | & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $scriptPath -SyncDirectory $testRoot
    if (@(Get-ChildItem (Join-Path $testRoot 'queue') -Filter '*.json' -ErrorAction SilentlyContinue).Count -ne 0) { throw 'Disabled hook unexpectedly queued a conversation' }
    [System.IO.File]::WriteAllText((Join-Path $testRoot 'enabled'), '1')
    # The real client keeps the transcript open for writing while Stop hooks run.
    $writer = [System.IO.File]::Open($transcript, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::ReadWrite)
    try {
        $eventJson | & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $scriptPath -SyncDirectory $testRoot
    } finally { $writer.Dispose() }
    $files = @(Get-ChildItem (Join-Path $testRoot 'queue') -Filter '*.json')
    if ($files.Count -ne 1) { throw 'Enabled Stop hook did not enqueue exactly one turn' }
    $job = [System.IO.File]::ReadAllText($files[0].FullName) | ConvertFrom-Json
    if ($job.messages.Count -ne 2 -or $job.messages[0].role -ne 'user' -or $job.messages[0].text -ne '明天给客户发报价') { throw 'Transcript roles or unicode text were not preserved' }
    if ($job.messages[0].index -ne 3 -or $job.messages[1].index -ne 4) { throw 'Transcript cursor positions were not preserved' }
    if ($job.cwd -ne 'C:\项目\中文项目') { throw 'Session metadata project directory was not preserved' }
    $repeatEvent = ConvertTo-Json -Compress @{session_id='test-session';turn_id='test-turn';hook_event_name='Stop';transcript_path=$transcript;stop_hook_active=$true}
    $repeatEvent | & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $scriptPath -SyncDirectory $testRoot
    if (@(Get-ChildItem (Join-Path $testRoot 'queue') -Filter '*.json').Count -ne 1) { throw 'Continuation hook unexpectedly queued another turn' }
    $cwdEvent = ConvertTo-Json -Compress @{session_id='test-session';turn_id='second-turn';hook_event_name='Stop';transcript_path=$transcript;cwd='C:\项目\当前项目';stop_hook_active=$false}
    $cwdEvent | & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $scriptPath -SyncDirectory $testRoot
    $jobs = @(Get-ChildItem (Join-Path $testRoot 'queue') -Filter '*.json' | ForEach-Object { [System.IO.File]::ReadAllText($_.FullName) | ConvertFrom-Json })
    if ($jobs.Count -ne 2 -or @($jobs | Where-Object { $_.turn_id -eq 'second-turn' -and $_.cwd -eq 'C:\项目\当前项目' }).Count -ne 1) { throw 'Hook event cwd did not take precedence over session metadata' }
    Write-Output 'PASS: disabled hook, unicode transcript, role filtering, cursors, project directories, and continuation exclusion'
} finally {
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if ($resolvedTestRoot.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedTestRoot -Leaf).StartsWith('sticky-notes-hook-')) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
