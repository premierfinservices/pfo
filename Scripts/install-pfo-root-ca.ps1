<#
.SYNOPSIS
    Makes this PC's browsers trust https://<PFO server LAN IP>:4300 instead of
    showing "Not secure".

.DESCRIPTION
    PFO's office server presents a certificate signed by a small internal
    Certificate Authority created for this purpose - it is not signed by a
    public CA, because the office server has no public hostname. Every
    employee PC needs that CA's certificate (pfo-root-ca.pem, checked into
    this repo next to this script) imported once so Chrome/Edge stop
    flagging the connection.

    This only imports the CA's public certificate - never a private key - so
    it grants no ability to decrypt or intercept traffic; it just tells
    Windows "connections signed by this CA are trustworthy," the same trust
    decision a public CA's inclusion in Windows already makes for you.

    Installs to the CURRENT USER's trust store (Cert:\CurrentUser\Root), which
    needs no administrator rights and is what Chrome/Edge read on Windows.
    Run this once per employee account on the PC they use to reach PFO.

.EXAMPLE
    .\Scripts\install-pfo-root-ca.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$CertPath = Join-Path $PSScriptRoot "pfo-root-ca.pem"

if (-not (Test-Path $CertPath)) {
    Write-Error "Could not find $CertPath - pull the latest PFO repo and try again."
    exit 1
}

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($CertPath)

$existing = Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
if ($existing) {
    Write-Host "PFO's internal certificate is already trusted on this account. Nothing to do."
    exit 0
}

Import-Certificate -FilePath $CertPath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null

Write-Host "Done. PFO's internal certificate is now trusted for this Windows account."
Write-Host "Close and reopen the browser, then reload the PFO page - the 'Not secure' warning should be gone."
