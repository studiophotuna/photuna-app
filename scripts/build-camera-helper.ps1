# Builds the USB camera helper ready to ship: the Sony bridge (when Sony's SDK is
# present), then a self-contained canon-camera-helper.exe with whichever camera SDKs
# this PC has, published to electron/bin/CanonCameraHelper/bin/publish.
#
#   powershell -ExecutionPolicy Bypass -File scripts/build-camera-helper.ps1
#
# A build PC needs:
#   - .NET SDK 8 or newer                       (dotnet --list-sdks)
#   - Camera SDKs unpacked under electron/bin/CanonCameraHelper/sdk/ (licensed to the
#     business, never committed):  sdk/nikon/S-SDKZ-200BF-ALLIN for the Z series,
#     sdk/nikon/S-SDK<model>-* for the D-series modules, sdk/sony/RemoteCli
#   - For Sony only: Visual Studio 2022 Build Tools with the C++ workload
# Brands whose SDK is missing are simply left out; the booth then keeps the webcam
# for them.

$ErrorActionPreference = 'Stop'

$repo = Split-Path $PSScriptRoot -Parent
$helper = Join-Path $repo 'electron\bin\CanonCameraHelper'
# Its own folder, never one the app's resolveHelperPath uses: a dev app running at the
# same time keeps its helper (and the camera SDK DLLs) open, which would block this
# build from clearing the folder.
$publish = Join-Path $helper 'bin\ship'

$sdks = & dotnet --list-sdks 2>$null
if (-not ($sdks | Where-Object { [int]($_.Split('.')[0]) -ge 8 })) {
    throw '.NET SDK 8 or newer is not installed.'
}

$hasCanon = Test-Path (Join-Path $helper 'sdk\canon\Windows\EDSDK_64\Dll\EDSDK.dll')
$hasNikon = Test-Path (Join-Path $helper 'sdk\nikon\S-SDKZ-200BF-ALLIN\Module\Win\BinaryFile\ControlServiceLayer.dll')
$hasSony = Test-Path (Join-Path $helper 'sdk\sony\RemoteCli\external\crsdk\Cr_Core.lib')

# Nikon's per-model modules for the older bodies, one TypeXXXX.md3 per camera family.
$nikonSdkDir = Join-Path $helper 'sdk\nikon'
$maidModules = @()
if (Test-Path $nikonSdkDir) {
    $maidModules = @(Get-ChildItem -Path $nikonSdkDir -Recurse -Filter 'Type*.md3' -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like '*\Binary Files\x64\*' })
}
$hasNikonMaid = $maidModules.Count -gt 0

if ($hasSony) {
    & (Join-Path $PSScriptRoot 'build-sony-bridge.ps1')
}

if (Test-Path $publish) { Remove-Item -Recurse -Force $publish }

& dotnet publish $helper -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o $publish
if ($LASTEXITCODE -ne 0) { throw 'The camera helper did not build.' }

$exe = Join-Path $publish 'canon-camera-helper.exe'
if (-not (Test-Path $exe)) { throw "Build finished but $exe is missing." }

$included = @()
if (Test-Path (Join-Path $publish 'canon\EDSDK.dll')) { $included += 'Canon' }
if (Test-Path (Join-Path $publish 'nikon\ControlServiceLayer.dll')) { $included += 'Nikon Z' }
$shippedMaid = @(Get-ChildItem -Path (Join-Path $publish 'nikon') -Filter 'Type*.md3' -ErrorAction SilentlyContinue)
if ($shippedMaid.Count -gt 0) { $included += "Nikon DSLR ($($shippedMaid.Count) modules)" }
if (Test-Path (Join-Path $publish 'sony\photuna_sony_bridge.dll')) { $included += 'Sony' }
if ($hasCanon -and -not ($included -contains 'Canon')) { throw 'Canon SDK is present but was not copied into the build.' }
if ($hasNikon -and -not ($included -contains 'Nikon Z')) { throw 'Nikon SDK is present but was not copied into the build.' }
if ($hasNikonMaid -and $shippedMaid.Count -eq 0) { throw "Nikon's per-model modules are present but were not copied into the build." }
if ($hasSony -and -not ($included -contains 'Sony')) { throw 'Sony SDK is present but was not copied into the build.' }

# Third-party notices shipped with the helper. Sony's CrAdapter includes libusb
# (LGPL-2.1, so its source goes along too), libssh2 (BSD) and OpenSSL (Apache-2.0);
# Sony's licence also requires that users are not led to think Sony made the app.
$notices = New-Object System.Collections.Generic.List[string]
$notices.Add('Photuna Booth App - USB camera helper')
$notices.Add('')
$notices.Add('The camera helper uses camera makers'' software development kits. Photuna is not made,')
$notices.Add('endorsed or supported by Canon Inc., Nikon Corporation or Sony Group Corporation.')
$notices.Add('Camera support is provided by Photuna, not by the camera makers.')
$notices.Add('')
if ($included -contains 'Canon') {
    # Required by the EDSDK readme for distributing its executable code.
    $notices.Add('=' * 78)
    $notices.Add('Canon EOS Digital SDK (canon\EDSDK.dll, canon\EdsImage.dll)')
    $notices.Add('=' * 78)
    $notices.Add('This software is based in part on the work of the Independent JPEG Group.')
    $notices.Add('')
}
if ($included -contains 'Sony') {
    $sonyReadme = Join-Path $helper 'sdk\sony\RemoteCli\README.md'
    $lines = Get-Content $sonyReadme
    $start = ($lines | Select-String -Pattern '^## copyright notice and disclaimer for OSS' | Select-Object -First 1).LineNumber
    if (-not $start) { throw "Could not find the open-source notices in $sonyReadme." }
    $notices.Add('=' * 78)
    $notices.Add('Open-source components included with the Sony Camera Remote SDK')
    $notices.Add('=' * 78)
    $notices.AddRange([string[]]$lines[($start - 1)..($lines.Count - 1)])

    # libusb-1.0.dll is LGPL-2.1: ship its licence and complete source with it.
    $ossDir = Join-Path $helper 'sdk\sony\SourceCodeOfOpenSourceSoftware'
    $libusbZip = Join-Path $ossDir 'libusb.zip'
    if (-not (Test-Path $libusbZip)) { throw "libusb source ($libusbZip) is required to ship Sony support." }
    $sourceDir = Join-Path $publish 'third-party-source'
    New-Item -ItemType Directory -Force $sourceDir | Out-Null
    Copy-Item $libusbZip $sourceDir
    Copy-Item (Join-Path $ossDir 'libssh2.zip') $sourceDir -ErrorAction SilentlyContinue

    $temp = Join-Path ([IO.Path]::GetTempPath()) ("photuna-libusb-" + [Guid]::NewGuid().ToString('N'))
    Expand-Archive $libusbZip $temp
    $copying = Get-ChildItem $temp -Recurse -File -Filter 'COPYING' | Select-Object -First 1
    if (-not $copying) { Remove-Item -Recurse -Force $temp; throw 'libusb.zip has no COPYING file.' }
    $notices.Add('')
    $notices.Add('=' * 78)
    $notices.Add('libusb (sony\CrAdapter\libusb-1.0.dll) - GNU Lesser General Public License 2.1')
    $notices.Add('Complete source: third-party-source\libusb.zip')
    $notices.Add('=' * 78)
    $notices.AddRange([string[]](Get-Content $copying.FullName))
    Remove-Item -Recurse -Force $temp
}
Set-Content -Path (Join-Path $publish 'THIRD_PARTY_NOTICES.txt') -Value $notices -Encoding utf8

$sizeMb = [math]::Round(((Get-ChildItem $publish -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host ''
Write-Host "Camera helper built: $publish ($sizeMb MB)"
Write-Host ("Camera brands included: " + $(if ($included.Count) { $included -join ', ' } else { 'none (webcam only)' }))
