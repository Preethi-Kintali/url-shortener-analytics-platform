# Module 03 Verification Script
# Boots NestJS API on port 3000, executes all security abuse checks, CRUD checks, redirect checks, and health checks.

$ErrorActionPreference = "Continue"
$apiDir = Split-Path -Parent $PSScriptRoot
$evidenceDir = "D:\Knack labs\progress\evidence\module-03"
if (!(Test-Path $evidenceDir)) {
    New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null
}
$logFile = "$evidenceDir\api-tests.txt"
"" | Out-File -FilePath $logFile -Encoding utf8

function Log-Output($str) {
    Write-Host $str
    $str | Out-File -FilePath $logFile -Append -Encoding utf8
}

Log-Output "=================================================="
Log-Output "Module 03: Core API & Validation Security Drill"
Log-Output "Timestamp: $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK')"
Log-Output "=================================================="
Log-Output ""

# Start NestJS API server
Log-Output "[SETUP] Starting NestJS API server on port 3000..."
$serverProcess = Start-Process -FilePath "node" -ArgumentList "$apiDir\dist\main.js" -WorkingDirectory $apiDir -PassThru -NoNewWindow
Start-Sleep -Seconds 4

# Check health
Log-Output "`n--- STEP 1: Verify Health Endpoint ---"
$healthRes = curl.exe -s -w "\nHTTP_STATUS:%{http_code}" http://localhost:3000/health
Log-Output $healthRes

# Security Abuse Tests
Log-Output "`n--- STEP 2: Security Validation Abuse Matrix (Expect HTTP 400) ---"

$abusePayloads = @(
    @{ name = "Direct JavaScript Scheme"; url = 'javascript:alert(1)' },
    @{ name = "Case-Insensitive Bypass"; url = 'JaVaScRiPt:alert(1)' },
    @{ name = "Whitespace Evasion"; url = '  javascript:alert(1)  ' },
    @{ name = "Data URI Payload"; url = 'data:text/html,<svg/onload=alert(1)>' },
    @{ name = "Scheme-Relative Bypass"; url = '//evil.example.com' },
    @{ name = "Encoded Slashes"; url = 'http:%2f%2fevil.example.com' },
    @{ name = "Encoded Scheme"; url = 'http%3A%2F%2Fevil.example.com' },
    @{ name = "Backslash Authority"; url = 'http:\\evil.example.com' },
    @{ name = "Userinfo Phishing Trick"; url = 'https://good.com@evil.example.com' },
    @{ name = "Control Characters / Newline"; url = "https://example.com`n" }
)

$abusePassed = 0
foreach ($test in $abusePayloads) {
    $payloadJson = @{ long_url = $test.url } | ConvertTo-Json -Compress
    $res = curl.exe -s -w "\nHTTP_STATUS:%{http_code}" -X POST "http://localhost:3000/links" -H "Content-Type: application/json" -d $payloadJson
    $lines = $res -split "`n"
    $statusCode = ($lines | Select-String "HTTP_STATUS:(\d+)").Matches.Groups[1].Value
    $body = ($lines | Where-Object { $_ -notmatch "^HTTP_STATUS:" }) -join ""

    if ($statusCode -eq "400") {
        Log-Output "[PASSED (400)] $($test.name) -> Payload: '$($test.url)'"
        Log-Output "   Response: $body"
        $abusePassed++
    } else {
        Log-Output "[FAILED ($statusCode)] $($test.name) -> Expected 400 but got $statusCode. Response: $body"
    }
}
Log-Output "`nAbuse Matrix Result: $abusePassed / $($abusePayloads.Count) properly rejected with HTTP 400 Bad Request."

# Valid Link Creation Test
Log-Output "`n--- STEP 3: Valid Link Creation (POST /links) ---"
$validPayload = '{"long_url":"https://example.com/dest-module-03-test"}'
$createRes = curl.exe -s -w "\nHTTP_STATUS:%{http_code}" -X POST "http://localhost:3000/links" -H "Content-Type: application/json" -d $validPayload
$lines = $createRes -split "`n"
$createStatus = ($lines | Select-String "HTTP_STATUS:(\d+)").Matches.Groups[1].Value
$createBody = ($lines | Where-Object { $_ -notmatch "^HTTP_STATUS:" }) -join ""
Log-Output "Status: $createStatus"
Log-Output "Body: $createBody"

$createdObj = $createBody | ConvertFrom-Json
$createdCode = $createdObj.code
$createdId = $createdObj.id
$createdShortUrl = $createdObj.short_url

# List Links (GET /links)
Log-Output "`n--- STEP 4: List Links (GET /links) ---"
$listRes = curl.exe -s -w "\nHTTP_STATUS:%{http_code}" "http://localhost:3000/links?page=1&limit=5"
$lines = $listRes -split "`n"
$listStatus = ($lines | Select-String "HTTP_STATUS:(\d+)").Matches.Groups[1].Value
$listBody = ($lines | Where-Object { $_ -notmatch "^HTTP_STATUS:" }) -join ""
Log-Output "Status: $listStatus"
Log-Output "Body: $listBody"

# Get Link by ID (GET /links/:id)
Log-Output "`n--- STEP 5: Inspect Link by ID (GET /links/$createdId) ---"
$getRes = curl.exe -s -w "\nHTTP_STATUS:%{http_code}" "http://localhost:3000/links/$createdId"
$lines = $getRes -split "`n"
$getStatus = ($lines | Select-String "HTTP_STATUS:(\d+)").Matches.Groups[1].Value
$getBody = ($lines | Where-Object { $_ -notmatch "^HTTP_STATUS:" }) -join ""
Log-Output "Status: $getStatus"
Log-Output "Body: $getBody"

# Redirect by Code (GET /r/:code)
Log-Output "`n--- STEP 6: Public Redirect (GET /r/$createdCode) ---"
$redirHeader = curl.exe -s -i "http://localhost:3000/r/$createdCode"
Log-Output $redirHeader

# Nonexistent code redirect (Expect 404)
Log-Output "`n--- STEP 7: Unknown Code Redirect (GET /r/nonexistent_code_999) ---"
$notFoundRes = curl.exe -s -i "http://localhost:3000/r/nonexistent_code_999"
Log-Output $notFoundRes

# Stop Server
Log-Output "`n[TEARDOWN] Stopping NestJS API server process (PID $($serverProcess.Id))..."
Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
Log-Output "Verification complete. Evidence recorded in $logFile."

