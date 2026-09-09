<#
.SYNOPSIS
    Work out which IPv4 address employees actually reach this machine on.

.DESCRIPTION
    Dot-source this file and call Get-AosLanAddress. Used by aos-status.ps1 and
    register-aos-services.ps1, which must never disagree about the answer.

    WHY THIS EXISTS: both callers print an address to the operator as the URL to
    bookmark and to record in Docs/Deployment Topology.md. The original one-liner
    took the first non-loopback, non-APIPA IPv4 address it found, in no
    particular order. On the office server that picked a HotspotShield VPN tunnel
    instead of the LAN address, because a connected tunnel is neither loopback
    nor APIPA and nothing ordered the set. A confidently wrong address breaks
    every bookmark in the office and still looks like working software.

    WHAT DISCRIMINATES: Get-NetAdapter's HardwareInterface. A physical NIC is
    $true; a VPN TAP/TUN adapter is $false. That is a structural fact about the
    adapter, unlike matching descriptions against a list of vendor names, which
    is a list nobody ever finishes.

    WHEN IT CANNOT TELL, IT SAYS SO. Zero or several surviving candidates return
    no address plus the full candidate list, so the caller can ask the operator
    to set PFO_LAN_IP rather than nominate one. That is also the safety net for
    the case this filter gets wrong: a NIC team or a Hyper-V virtual switch on
    real server hardware is HardwareInterface $false but may be the true LAN
    path. Refusing to answer is recoverable; answering wrongly is not.

    NOTE ON ENCODING: plain ASCII, for the reason given in aos-status.ps1.
    Windows PowerShell 5.1 reads a BOM-less file as ANSI and a stray dash
    becomes a parse error.
#>

function Get-AosLanAddress {
    [CmdletBinding()]
    param(
        # PFO_LAN_IP as read from .env by the caller, if set. An operator who has
        # declared the address outranks any amount of detection.
        [string]$Override
    )

    if ($Override) {
        return [pscustomobject]@{
            Address    = $Override.Trim()
            Source     = "override"
            Candidates = @()
        }
    }

    $candidates = @()
    foreach ($addr in (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue)) {
        # WellKnown covers loopback and APIPA; a real LAN address is either
        # handed out by DHCP or set by hand.
        if ($addr.PrefixOrigin -notin @("Dhcp", "Manual")) { continue }
        if ($addr.AddressState -ne "Preferred") { continue }

        $adapter = Get-NetAdapter -InterfaceIndex $addr.InterfaceIndex -ErrorAction SilentlyContinue
        if (-not $adapter) { continue }
        if ($adapter.Status -ne "Up") { continue }
        if (-not $adapter.HardwareInterface) { continue }

        $candidates += [pscustomobject]@{
            Address     = $addr.IPAddress
            Adapter     = $adapter.Name
            Description = $adapter.InterfaceDescription
        }
    }

    if ($candidates.Count -eq 1) {
        return [pscustomobject]@{
            Address    = $candidates[0].Address
            Source     = "detected"
            Candidates = $candidates
        }
    }

    $source = "none"
    if ($candidates.Count -gt 1) { $source = "ambiguous" }

    return [pscustomobject]@{
        Address    = $null
        Source     = $source
        Candidates = $candidates
    }
}
