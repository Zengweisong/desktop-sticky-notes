param([Parameter(Mandatory=$true)][string]$SyncDirectory)
# Codex Stop hook: only enqueue local user/assistant text; never call AI in the hook.
$ErrorActionPreference = 'Stop'
try {
    $enabledPath = Join-Path $SyncDirectory 'enabled'
    if (-not (Test-Path -LiteralPath $enabledPath)) { exit 0 }
    $enabledAt = (Get-Item -LiteralPath $enabledPath).LastWriteTimeUtc
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    $eventData = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($eventData.hook_event_name -ne 'Stop' -or $eventData.stop_hook_active) { exit 0 }
    if (-not $eventData.session_id -or -not $eventData.turn_id -or -not $eventData.transcript_path) { exit 0 }
    $messages = [System.Collections.Generic.List[object]]::new()
    $tail = [System.Collections.Generic.Queue[object]]::new()
    $lineNumber = 0
    $projectDirectory = [string]$eventData.cwd
    $stream = [System.IO.File]::Open($eventData.transcript_path, [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read, ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8, $true)
    try {
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine()
            $lineNumber++
            if ([string]::IsNullOrWhiteSpace($projectDirectory)) {
                try {
                    $metadata = $line | ConvertFrom-Json
                    if ($metadata.type -eq 'session_meta' -and $metadata.payload.cwd) {
                        $projectDirectory = [string]$metadata.payload.cwd
                    }
                } catch { }
            }
            $tail.Enqueue(@{ index = $lineNumber; raw = $line })
            if ($tail.Count -gt 400) { $tail.Dequeue() | Out-Null }
        }
    } finally { $reader.Dispose() }
    foreach ($lineEntry in $tail) {
        try { $entry = $lineEntry.raw | ConvertFrom-Json } catch { continue }
        if ($entry.type -ne 'response_item' -or $entry.payload.type -ne 'message') { continue }
        # Never backfill messages from before the user enabled this connection.
        if (-not $entry.timestamp) { continue }
        try { $messageTime = [DateTimeOffset]::Parse($entry.timestamp).UtcDateTime } catch { continue }
        if ($messageTime -lt $enabledAt) { continue }
        $payload = $entry.payload
        if ($payload.role -notin @('user', 'assistant')) { continue }
        $parts = @($payload.content | Where-Object { $_.type -in @('input_text', 'output_text') } | ForEach-Object { $_.text })
        $text = $parts -join "`n"
        if ([string]::IsNullOrWhiteSpace($text)) { continue }
        # Exclude environment/context envelopes from user-visible messages.
        if ($text.StartsWith('<environment_context>') -or $text.StartsWith('<permissions instructions>')) { continue }
        $messages.Add(@{ index = $lineEntry.index; role = $payload.role; text = $text })
    }
    # Refuse oversized turns rather than silently losing task evidence.
    $recent = @($messages | Select-Object -Last 40)
    $job = @{ session_id = [string]$eventData.session_id; turn_id = [string]$eventData.turn_id; cwd = $projectDirectory; messages = $recent }
    $json = ConvertTo-Json -InputObject $job -Depth 8 -Compress
    if ([System.Text.Encoding]::UTF8.GetByteCount($json) -gt 98304) { throw '对话过长，请缩短后手动同步。' }
    $queue = Join-Path $SyncDirectory 'queue'
    [System.IO.Directory]::CreateDirectory($queue) | Out-Null
    $name = [DateTime]::UtcNow.ToString('yyyyMMddHHmmssfffffff') + '-' + [Guid]::NewGuid().ToString('N')
    $temp = Join-Path $queue ($name + '.tmp')
    [System.IO.File]::WriteAllText($temp, $json, [System.Text.UTF8Encoding]::new($false))
    [System.IO.File]::Move($temp, (Join-Path $queue ($name + '.json')))
} catch {
    try {
        [System.IO.File]::WriteAllText((Join-Path $SyncDirectory 'last-error'),
            ('对话采集失败：' + $_.Exception.Message), [System.Text.UTF8Encoding]::new($false))
    } catch { }
    # No transcript or credentials in hook output. Failure never blocks the conversation.
    [Console]::Error.WriteLine('桌面便签未能收集本轮对话；请检查同步设置和日志。')
}
exit 0
