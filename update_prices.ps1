$ErrorActionPreference = 'Stop'
$path = 'products.json'
if (Test-Path $path) {
  $json = Get-Content $path -Raw | ConvertFrom-Json
  foreach ($item in $json) {
    $item.price = 5000
  }
  $json | ConvertTo-Json -Depth 5 | Set-Content $path -Encoding UTF8
}

$idx = 'index.html'
if (Test-Path $idx) {
  $c = Get-Content $idx -Raw
  $c = $c -replace '\.toFixed\(\s*2\s*\)', '.toLocaleString()'
  Set-Content $idx $c -Encoding UTF8
}

$sj = 's.js'
if (Test-Path $sj) {
  $cs = Get-Content $sj -Raw
  $cs = $cs -replace 'price:\s*10\.0', 'price: 5000'
  Set-Content $sj $cs -Encoding UTF8
}

Write-Host 'Update completed.'