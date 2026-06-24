param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$fullPath = [System.IO.Path]::GetFullPath($Path)
$directory = [System.IO.Path]::GetDirectoryName($fullPath)
if (-not [System.IO.Directory]::Exists($directory)) {
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
}

if ([System.IO.File]::Exists($fullPath)) {
  Write-Output "Arquivo Access ja existe: $fullPath"
  exit 0
}

$connectionStrings = @(
  "Provider=Microsoft.ACE.OLEDB.16.0;Data Source=$fullPath;Jet OLEDB:Engine Type=5",
  "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$fullPath;Jet OLEDB:Engine Type=5"
)

$lastError = $null
foreach ($connectionString in $connectionStrings) {
  try {
    $catalog = New-Object -ComObject ADOX.Catalog
    $catalog.Create($connectionString)
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($catalog) | Out-Null
    Write-Output "Arquivo Access criado: $fullPath"
    exit 0
  } catch {
    $lastError = $_.Exception.Message
  }
}

throw "Nao foi possivel criar o Access .accdb. Instale o Microsoft Access Database Engine 2016 ou crie o arquivo manualmente. Ultimo erro: $lastError"
