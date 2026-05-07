$connections = Get-NetTCPConnection -LocalPort 8787 -ErrorAction SilentlyContinue
foreach ($connection in $connections) {
    Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
}
