param(
    [int]$Port = 8080,
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$mimeMap = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.mjs'  = 'application/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.svg'  = 'image/svg+xml'
    '.webp' = 'image/webp'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
    '.ttf'  = 'font/ttf'
    '.map'  = 'application/json; charset=utf-8'
    '.txt'  = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving '$Root' at http://localhost:$Port/"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        try {
            $urlPath = [Uri]::UnescapeDataString($request.Url.AbsolutePath)
            if ($urlPath -eq '/') { $urlPath = '/index.html' }
            $fsPath = Join-Path $Root ($urlPath.TrimStart('/'))

            if (Test-Path $fsPath -PathType Container) {
                $fsPath = Join-Path $fsPath 'index.html'
            }

            $fullRoot = (Resolve-Path $Root).Path
            $resolved = $null
            if (Test-Path $fsPath) { $resolved = (Resolve-Path $fsPath).Path }

            if ($resolved -and $resolved.StartsWith($fullRoot) -and (Test-Path $resolved -PathType Leaf)) {
                $ext = [System.IO.Path]::GetExtension($resolved).ToLower()
                $contentType = $mimeMap[$ext]
                if (-not $contentType) { $contentType = 'application/octet-stream' }
                $bytes = [System.IO.File]::ReadAllBytes($resolved)
                $response.ContentType = $contentType
                $response.ContentLength64 = $bytes.Length
                $response.StatusCode = 200
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $notFound = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $urlPath")
                $response.StatusCode = 404
                $response.ContentLength64 = $notFound.Length
                $response.OutputStream.Write($notFound, 0, $notFound.Length)
            }
        } catch {
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes("500 Internal Server Error: $_")
            $response.StatusCode = 500
            $response.ContentLength64 = $errBytes.Length
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
        } finally {
            $response.OutputStream.Close()
        }
    }
} finally {
    $listener.Stop()
}
