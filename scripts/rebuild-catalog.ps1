# Line-oriented rebuild of products.json from catalog YAML.
$ErrorActionPreference = 'Stop'
$root = 'E:\Dama\000 - New Website\smile-vault'

function Unquote([string]$s) {
  $s = $s.Trim()
  if ($s.Length -ge 2 -and $s.StartsWith('"') -and $s.EndsWith('"')) {
    return $s.Substring(1, $s.Length - 2)
  }
  return $s
}

function Expand-FlatItems([string]$path, [string]$type, [string]$section) {
  $rows = New-Object System.Collections.ArrayList
  $defaultPrice = 350
  $st = @{
    title = $null
    itemPrice = $null
    itemDefaultColor = $null
    itemDefaultSide = $null
    inVariants = $false
    vColor = $null
    vPrice = $null
    vFront = $null
    vBack = $null
    vImage = $null
    vDefault = $false
    vDefaultSide = $null
  }

  $flush = {
    if (-not $st.title) { return }
    $price = if ($null -ne $st.vPrice) { $st.vPrice } elseif ($null -ne $st.itemPrice) { $st.itemPrice } else { $defaultPrice }
    $isDefault = $st.vDefault -or ($null -ne $st.itemDefaultColor -and $st.vColor -eq $st.itemDefaultColor)
    $defSide = if ($st.vDefaultSide) { $st.vDefaultSide } elseif ($isDefault) { $st.itemDefaultSide } else { $null }
    $added = $false
    if ($st.vFront) {
      $r = @{ title = $st.title; price = $price; image = $st.vFront; type = $type; variantSide = 'front' }
      if ($st.vColor) { $r.variantColor = $st.vColor }
      if ($isDefault) { $r.variantDefault = $true }
      if ($isDefault -and $defSide) { $r.defaultSide = $defSide }
      if ($section) { $r.section = $section; $r.category = $section } else { $r.category = $type.ToLower() }
      [void]$rows.Add($r)
      $added = $true
    }
    if ($st.vBack) {
      $r = @{ title = $st.title; price = $price; image = $st.vBack; type = $type; variantSide = 'back' }
      if ($st.vColor) { $r.variantColor = $st.vColor }
      if ($isDefault) { $r.variantDefault = $true }
      if ($isDefault -and $defSide) { $r.defaultSide = $defSide }
      if ($section) { $r.section = $section; $r.category = $section } else { $r.category = $type.ToLower() }
      [void]$rows.Add($r)
      $added = $true
    }
    if (-not $added -and $st.vImage) {
      $r = @{ title = $st.title; price = $price; image = $st.vImage; type = $type }
      if ($st.vColor) { $r.variantColor = $st.vColor; $r.variantSide = 'back' }
      if ($isDefault) { $r.variantDefault = $true }
      if ($isDefault -and $defSide) { $r.defaultSide = $defSide }
      if ($section) { $r.section = $section; $r.category = $section } else { $r.category = $type.ToLower() }
      [void]$rows.Add($r)
    }
    $st.vColor = $null
    $st.vPrice = $null
    $st.vFront = $null
    $st.vBack = $null
    $st.vImage = $null
    $st.vDefault = $false
    $st.vDefaultSide = $null
  }.GetNewClosure()

  foreach ($line in [IO.File]::ReadAllLines($path, [Text.UTF8Encoding]::new($false))) {
    if ($line -match '^price:\s*(\d+)') { $defaultPrice = [int]$Matches[1]; continue }

    if ($line -match '^\s+- title:\s*(.+)$') {
      if ($st.inVariants) { & $flush }
      $st.title = Unquote $Matches[1]
      $st.itemPrice = $null
      $st.itemDefaultColor = $null
      $st.itemDefaultSide = $null
      $st.inVariants = $false
      $st.vColor = $null; $st.vPrice = $null; $st.vFront = $null; $st.vBack = $null; $st.vImage = $null
      $st.vDefault = $false; $st.vDefaultSide = $null
      continue
    }

    if ($line -match '^\s+defaultColor:\s*(.+)$' -and -not $st.inVariants) {
      $st.itemDefaultColor = Unquote $Matches[1]
      continue
    }
    if ($line -match '^\s+defaultSide:\s*(.+)$' -and -not $st.inVariants) {
      $side = (Unquote $Matches[1]).ToLower()
      if ($side -eq 'front' -or $side -eq 'back') { $st.itemDefaultSide = $side }
      continue
    }

    if ($line -match '^\s+price:\s*(\d+)\s*$' -and -not $st.inVariants) {
      $st.itemPrice = [int]$Matches[1]
      continue
    }

    if ($line -match '^\s+image:\s*(.+)$' -and -not $st.inVariants) {
      $img = Unquote $Matches[1]
      $price = if ($null -ne $st.itemPrice) { $st.itemPrice } else { $defaultPrice }
      $r = @{ title = $st.title; price = $price; image = $img; type = $type }
      if ($section) { $r.section = $section; $r.category = $section } else { $r.category = $type.ToLower() }
      [void]$rows.Add($r)
      continue
    }

    if ($line -match '^\s+variants:\s*$') {
      $st.inVariants = $true
      continue
    }

    if ($st.inVariants -and $line -match '^\s+- color:\s*(.+)$') {
      & $flush
      $st.vColor = Unquote $Matches[1]
      continue
    }
    if ($st.inVariants -and $line -match '^\s+- front:\s*(.+)$') {
      & $flush
      $st.vColor = $null
      $st.vFront = Unquote $Matches[1]
      continue
    }
    if ($st.inVariants -and $line -match '^\s+- back:\s*(.+)$') {
      & $flush
      $st.vColor = $null
      $st.vBack = Unquote $Matches[1]
      continue
    }
    if ($st.inVariants -and $line -match '^\s+- image:\s*(.+)$') {
      & $flush
      $st.vColor = $null
      $st.vImage = Unquote $Matches[1]
      continue
    }
    if ($st.inVariants -and $line -match '^\s+color:\s*(.+)$') { $st.vColor = Unquote $Matches[1]; continue }
    if ($st.inVariants -and $line -match '^\s+front:\s*(.+)$') { $st.vFront = Unquote $Matches[1]; continue }
    if ($st.inVariants -and $line -match '^\s+back:\s*(.+)$') { $st.vBack = Unquote $Matches[1]; continue }
    if ($st.inVariants -and $line -match '^\s+image:\s*(.+)$') { $st.vImage = Unquote $Matches[1]; continue }
    if ($st.inVariants -and $line -match '^\s+price:\s*(\d+)') { $st.vPrice = [int]$Matches[1]; continue }
    if ($st.inVariants -and $line -match '^\s+default:\s*(.+)$') {
      $val = (Unquote $Matches[1]).ToLower()
      $st.vDefault = ($val -eq 'true' -or $val -eq 'yes' -or $val -eq '1')
      continue
    }
    if ($st.inVariants -and $line -match '^\s+defaultSide:\s*(.+)$') {
      $side = (Unquote $Matches[1]).ToLower()
      if ($side -eq 'front' -or $side -eq 'back') { $st.vDefaultSide = $side }
      continue
    }
  }

  if ($st.inVariants) { & $flush }
  foreach ($r in $rows) { $r }
}

function Esc([string]$s) {
  return ($s -replace '\\', '\\' -replace '"', '\"')
}

$all = New-Object System.Collections.ArrayList
foreach ($row in Expand-FlatItems "$root\catalog\shop\stickers\curated\items.yaml" 'Stickers' 'curated') { [void]$all.Add($row) }
foreach ($row in Expand-FlatItems "$root\catalog\shop\stickers\nuggets\items.yaml" 'Stickers' 'nuggets') { [void]$all.Add($row) }
foreach ($row in Expand-FlatItems "$root\catalog\shop\tshirts\items.yaml" 'Tshirts' $null) { [void]$all.Add($row) }

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('[')
for ($i = 0; $i -lt $all.Count; $i++) {
  $p = $all[$i]
  $id = $i + 1
  [void]$sb.AppendLine('    {')
  [void]$sb.AppendLine(('        "id": {0},' -f $id))
  [void]$sb.AppendLine(('        "name": "{0}",' -f (Esc $p.title)))
  [void]$sb.AppendLine(('        "title": "{0}",' -f (Esc $p.title)))
  [void]$sb.AppendLine(('        "price": {0},' -f $p.price))
  [void]$sb.AppendLine(('        "image": "{0}",' -f (Esc $p.image)))
  [void]$sb.AppendLine(('        "type": "{0}",' -f $p.type))
  if ($p.ContainsKey('variantColor') -and $p.variantColor) {
    [void]$sb.AppendLine(('        "variantColor": "{0}",' -f (Esc $p.variantColor)))
  }
  if ($p.ContainsKey('variantSide') -and $p.variantSide) {
    [void]$sb.AppendLine(('        "variantSide": "{0}",' -f (Esc $p.variantSide)))
  }
  if ($p.ContainsKey('variantDefault') -and $p.variantDefault) {
    [void]$sb.AppendLine('        "variantDefault": true,')
  }
  if ($p.ContainsKey('defaultSide') -and $p.defaultSide) {
    [void]$sb.AppendLine(('        "defaultSide": "{0}",' -f (Esc $p.defaultSide)))
  }
  if ($p.ContainsKey('section') -and $p.section) {
    [void]$sb.AppendLine(('        "section": "{0}",' -f $p.section))
    [void]$sb.AppendLine(('        "category": "{0}"' -f $p.category))
  } else {
    [void]$sb.AppendLine(('        "category": "{0}"' -f $p.category))
  }
  if ($i -lt $all.Count - 1) { [void]$sb.AppendLine('    },') } else { [void]$sb.AppendLine('    }') }
}
[void]$sb.AppendLine(']')
[IO.File]::WriteAllText("$root\products.json", $sb.ToString(), [Text.UTF8Encoding]::new($false))
Write-Output ("total={0} curated={1} nuggets={2} shirts={3}" -f $all.Count, (@($all | Where-Object section -eq 'curated')).Count, (@($all | Where-Object section -eq 'nuggets')).Count, (@($all | Where-Object type -eq 'Tshirts')).Count)
