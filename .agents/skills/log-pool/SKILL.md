---
name: log-pool
description: Search and record structured events in a local Log Pool. Use to correlate events across processes, compare runs, inspect older logs, or add temporary probes to diagnose a bug.
---

# Log Pool

Use a local Log Pool when the output must survive a process or be correlated across runs. Continue with ordinary local logs if the developer has no running instance.

## Connect

Try the default loopback address. On Windows, Log Pool may select a different port. Read the `url` from the endpoint file and retry `/health` at that address.

```powershell
$poolUrl = 'http://127.0.0.1:39217'
Invoke-RestMethod "$poolUrl/health" -TimeoutSec 3

$poolUrl = (Get-Content -LiteralPath (Join-Path $env:ProgramData 'log-pool/endpoint.json') | ConvertFrom-Json).url
Invoke-RestMethod "$poolUrl/health" -TimeoutSec 3
```

Use a loopback address. Record synthetic identifiers and the minimum fields needed to answer the debugging question. Keep credentials, session cookies, order records, and personal data out of events and exports.

## Record and query events

Use a tag for each concern and one `trace` value per flow. Keep searchable values in `data`.

```powershell
$sampleEvent = @{
  tag = 'dama-local-tests'
  level = 'info'
  msg = 'Synthetic fixture loaded'
  trace = 'sample-run'
  data = @{ count = 3 }
} | ConvertTo-Json -Depth 4
Invoke-RestMethod "$poolUrl/ingest" -Method Post -ContentType 'application/json' -Body $sampleEvent

$filter = [uri]::EscapeDataString('data.count>=3')
Invoke-RestMethod "$poolUrl/query?tag=dama-local-tests&q=$filter&from=-15m&limit=20"
Invoke-RestMethod "$poolUrl/trace/sample-run"
```

Start with `tag`, `from`, and `limit`. Use `select=ts,msg,data.count` to return specific fields and `order=asc` for time order. A response with `truncated=true` covers only part of the data. Narrow the time window or tag and retry.

| Need | Request |
| --- | --- |
| List available tags | `GET /tags` |
| Find errors or warnings | `GET /query` with the encoded expression `level:error,warn` |
| Group matching events | `GET /query` with `groupBy=data.probe&agg=count` |
| Fetch known event IDs | `POST /events/bulk` with a JSON object containing an `ids` array |
| Record a batch | `POST /ingest` with a JSON array of events |
| Inspect a tag export locally | `GET /dump/<tag>?format=json` |

## Add and remove temporary probes

1. State what the probe should prove and assign the run a unique ID. Use `probe-<runId>` as its tag and `<runId>` as its trace.
2. For each event, set `data.probe` to the probe ID, `data.hyp` to the hypothesis ID, `data.loc` to the code location, and `data.payload` to the minimal observations. Mark every inserted line with `PROBE:<runId>`. Send events without blocking or changing the application path being measured.
3. Reproduce the issue and inspect `GET /trace/<runId>`. Count events by `data.probe` to see which code paths ran. Record what the evidence established with the fix.
4. Remove the probe code and verify the marker is gone with `rg -n 'PROBE:<runId>'`. Delete the temporary tag you created with `DELETE /tags/<tag>?confirm=<tag>` when the evidence is no longer needed.
