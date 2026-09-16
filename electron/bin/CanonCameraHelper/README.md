# Canon camera helper

Gives the booth full-resolution captures and manual exposure control from a Canon
camera connected by USB, instead of screenshots of a webcam feed.

It is a separate process on purpose. Camera SDKs are native code that can crash,
hang in a driver call, or stop answering when a cable is pulled. Running outside
Electron means only this process dies; `electron/services/cameraHelper.js` times
the call out, kills the helper, restarts it on the next request, and the booth
falls back to the webcam for that shot.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Process, protocol, timeouts, restart limits, simulated camera | done |
| 1 | A real camera backend: connect, full-resolution capture to the PC, battery | Canon: **tested on an EOS M50 Mark II** (2026-09-14). Nikon (Z series and D-series) and Sony: built, not yet tested with a camera |
| 2 | ISO / shutter / aperture / white balance controls in the dashboard | done (Settings → Camera, from camera-reported values) |
| 3 | Live view from the camera for preview and burst clips | done: `startLiveView` / `liveViewFrame` / `stopLiveView`; simulator-tested, not yet with a camera |
| 4 | Booth flow integration with per-shot webcam fallback, beta flag | done (`cameraSource: "usb"`), simulator-tested |

The booth side is brand-neutral (`electron/services/cameraCapture.js`,
`camera:*` IPC, `PhotoScreen.js`, the dashboard's Photo source setting). A brand
is added by implementing one `ICameraBackend` here; nothing else changes.

Until a backend has its SDK, the real backend reports `sdkAvailable: false`, the
dashboard does not offer the USB camera option, and every call fails with
`SDK_NOT_INSTALLED`.

**Shipping.** `npm run dist:win` first runs `scripts/build-camera-helper.ps1`,
which publishes a self-contained exe with whichever brands' SDKs the build PC has
(plus `THIRD_PARTY_NOTICES.txt`) to `bin/ship`; electron-builder ships that folder
as `resources/bin/camera-helper`. `bin/ship` is never used by a running dev app, so
the dev app holding its helper open cannot block a release build. It has been in the installer since 0.4.11.

Full-resolution originals are saved to the session's `originals/` folder, never
`captures/` — `captures:list` and the booth pipeline treat every image there as
a booth shot. The booth gets a copy at most 3000 px on the long edge.

## Other brands

Both are free, and both are licensed to the business, which must download them.
Neither can be tested without that brand's camera attached.

| Brand | SDK | Getting it | Notes |
|---|---|---|---|
| Sony | Camera Remote SDK | Registration form on Sony's SDK download page, download is immediate | Licence allows bundling the library inside a commercial app; end users must be told Sony did not make the app. Alpha / ZV / FX bodies. |
| Nikon | Camera Remote SDK (unified module) | Apply at sdk.nikonimaging.com | Windows 11 64-bit only; Z9, Z8, Z6III, Z7II, Z6II, Z7, Z6, Z5II, Z5, Zf, Z50II, Z50, Z30, Zfc, ZR. Read the licence's redistribution terms when downloading. |
| Nikon | Per-model module SDKs (MAID) | Same download page | The D-series DSLRs and the older mirrorless bodies, 31 modules covering D3 → D6, D850, D780, Z5 → Z9. Windows 10/11 64-bit. Same licence question as above. |

## Nikon (Z series)

`NikonBackend.cs` drives Nikon's Remote SDK v2 "simplified API"
(`ControlServiceLayer.dll`) by P/Invoke — Nikon's interface is plain C, so no C++
bridge is needed. It was written from Nikon's headers, documents and sample
program. On a PC with no camera it loads the SDK, starts it and reports
`NO_CAMERA` cleanly (checked by `scripts/test-camera-helper.js`); **taking a real
photo has not been tested**, because no Nikon body was available.

With a Z camera attached and switched on:

```bash
node scripts/test-camera-helper.js --hardware
```

It connects, prints status and the camera's ISO / shutter / aperture / white
balance lists, takes one photo and prints where it saved it.

Setup:

- Unpack Nikon's download under `sdk/nikon/`. The build copies
  `S-SDKZ-200BF-ALLIN/Module/Win/BinaryFile/` (four DLLs, three `.config`
  profiles) into `nikon/` next to the helper. A newer SDK folder name needs the
  `NikonSdkBin` path in the csproj updated. The per-model folders in the same
  download are used by the D-series backend below.
- Booth PCs need 64-bit Windows 11 and the Microsoft Visual C++ 2022 runtime.
- On first use the helper copies the three profiles into
  `%LOCALAPPDATA%\Nikon\NXTether` if they are missing (Nikon requires them
  there). The SDK also writes a daily log file into that folder.
- Close NX Tether, Camera Control Pro and Nikon Transfer: the camera answers only
  one app (`CAMERA_IN_USE`). The SDK controls one camera at a time.

Behaviour:

- Photos are sent to the PC only (Save media = SDRAM), so no memory card is
  needed. They are saved in a private temporary folder first, because the SDK
  names files itself and RAW + JPEG produces two; only the JPEG is moved to where
  the booth asked. A camera set to RAW only fails with `IMAGE_NOT_JPEG`.
- The single shot uses autofocus. Nikon's "out of focus" result maps to
  `FOCUS_FAILED`, so the booth takes that shot from the webcam.
- Settings list exactly the strings the camera reports (apertures shown as
  `f/5.6`); a change the camera's mode dial locks comes back as `SETTING_REJECTED`.
- The SDK prints diagnostics to stdout. `Program.cs` gives the protocol a private
  copy of stdout and points everything else at stderr, so SDK output can never
  corrupt a reply.

Nikon's documents are marked confidential and the SDK is licensed to the business:
keep all of it under `sdk/` (git-ignored). Confirm the licence allows bundling the
DLLs before they go in the installer.

## Nikon (D-series and older mirrorless)

`NikonMaidBackend.cs` covers the bodies Remote SDK v2 does not: the D-series DSLRs
and the mirrorless models older than the unified SDK. Nikon ships these as one
module per camera family (`TypeXXXX.md3`) speaking the older MAID 3 interface —
a single exported `MAIDEntryPoint` driving a tree of Module → Source → Item →
Data objects, with commands that answer `Pending` and finish while the client
pumps `Command_Async`. `NikonMaidSdk.cs` holds the bindings. **Not tested with a
camera**, because no Nikon body was available.

The booth still has one "USB camera" setting. This backend answers to the same
brand name (`nikon`) as the Z backend, so `AutoBackend` reaches it from the same
Nikon USB vendor id, and it is registered second — a Z body keeps Remote SDK v2
and only a camera that backend turns down falls through to here.

Setup:

- The same `sdk/nikon/` download. The build copies every
  `*/Module/Win/Binary Files/x64/Type*.md3` into `nikon/`, beside the Remote SDK
  v2 files. That is deliberate: a module resolves `NkdPTP.dll`, `dnssd.dll` and
  `NkRoyalmile.dll` from its own folder, and those three are the same version
  (1.4.1.3000 / 1.0.0.3002) in every one of Nikon's SDK folders, so one copy
  serves all of them. About 38 MB for 31 modules.
- One module covers a family, so several of Nikon's per-model folders hold the
  same `TypeXXXX.md3` (Type0001 is the D3, D300, D300S, D3S and D700); the copies
  are byte-identical.
- 64-bit only, which costs nothing: every per-model folder in the download has an
  x64 module. Cameras older than the D90 (D40, D60, D80, D200) have no module in
  the download at all.

Behaviour:

- On connect the modules are tried in turn until one reports a camera. The USB
  product id picks which to try first (`ModuleHints`); that table only orders the
  probe, so a missing or wrong entry costs a moment and nothing else. Probing is
  capped at 9 s, inside the app's 25 s connect timeout.
- Photos are sent to the PC only (Save media = SDRAM), so no memory card is
  needed. The shot uses `AFCapture` where the body offers it, otherwise autofocus
  then capture; "out of focus" maps to `FOCUS_FAILED`. RAW + JPEG produces more
  than one item and each is tried until one yields a JPEG; RAW only fails with
  `IMAGE_NOT_JPEG`.
- Live view reads `GetLiveViewImage` and finds the JPEG by its own start marker
  rather than trusting a fixed header length, which differs between bodies.
- Every capability is checked against the camera's own enumerated list before it
  is used, so a body that does not offer something reports it as unsupported
  instead of failing.

## Sony (Alpha / ZV / FX)

Sony's Camera Remote SDK is C++: connecting needs an `IDeviceCallback` object the SDK
calls from its own threads. C# cannot implement a C++ interface, so
`SonyBridge/photuna_sony_bridge.cpp` (Photuna's own code) owns that object and
exposes a few plain C functions; `SonyBackend.cs` calls them. Checked on a PC with no
camera: the SDK loads and starts and connect answers `NO_CAMERA`. **Taking a real
photo has not been tested.**

Building (Visual Studio 2022 Build Tools with the C++ workload):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-sony-bridge.ps1
dotnet build -c Release electron/bin/CanonCameraHelper
```

The script builds against Sony's headers and `Cr_Core.lib` from
`sdk/sony/RemoteCli` into `sdk/_build` (git-ignored). The helper build then copies the
bridge, `Cr_Core.dll`, `monitor_protocol*.dll` and `CrAdapter/` into `sony/` — only
when both the SDK and the bridge exist.

Setup on the camera and PC:

- On the camera: turn **PC Remote** on and set the USB connection mode to PC Remote.
- Close Imaging Edge Desktop / Remote (`CAMERA_IN_USE` otherwise).
- Some models need Sony's USB driver (`sdk/sony/Driver`) on the booth PC.
- USB only: network-connected cameras need pairing the booth has no screen for.

Behaviour:

- On connect the PC is given priority over the camera's dials (Priority Key = PC
  Remote) and photos are sent to the PC (Still Image Store Destination = Host PC).
- A shot is a half-press for autofocus, a full press, then waiting for Sony's
  download-complete callback. Files land in a private temp folder; only the JPEG is
  moved to the requested path. RAW only fails with `IMAGE_NOT_JPEG`.
- ISO, shutter speed, aperture and white balance come from the camera's candidate
  values (multi-frame noise reduction ISO modes are hidden); battery is reported in
  the quarter/third steps Sony provides.

Licensing: Sony's licence allows including the SDK library in a commercial app, as
long as users are not led to think Sony made it. `CrAdapter/libusb-1.0.dll` is LGPL and
`libssh2.dll` BSD — the installer must carry their notices (Sony's `RemoteCli/README.md`
has the text).

## Canon (EOS)

`CanonEdsdkBackend.cs` (class `CanonBackend`) drives Canon's EOS Digital SDK
(EDSDK 13.20.21) by P/Invoke; `CanonSdk.cs` holds the bindings. It was written from
Canon's API reference, headers and C# sample.

Tested on an **EOS M50 Mark II** (2026-09-14): connect in ~0.6 s with model and
battery, first live view frame in ~0.2 s, a 5328×4000 JPEG downloaded in ~1.9 s,
and in M mode ISO (26 values), shutter (52), aperture (17) and white balance (10)
listed, changed and read back correctly. In Scene Intelligent Auto (A+) the camera
offers only its current values — the helper logs the exposure mode on connect and
the dashboard asks for the mode dial to be set to M (or Av / Tv).

Setup:

- Unpack Canon's download under `sdk/canon/`. The build copies
  `Windows/EDSDK_64/Dll/EDSDK.dll` and `EdsImage.dll` into `canon/` next to the
  helper.
- Close EOS Utility and EOS Webcam Utility before connecting: the camera answers
  one app at a time (`CAMERA_IN_USE`).

Behaviour:

- The helper has no Windows message loop, so camera events are fetched with
  `EdsGetEvent` (Canon's reference requires this for console applications) while
  waiting for a photo, before each live view frame and on status checks.
- On connect photos are sent to the PC (SaveTo = Host) and the SDK is told the PC
  has free space (`EdsSetCapacity`), as Canon's sample does.
- A shot is a full shutter press with autofocus, then the JPEG is downloaded when
  the camera asks for the transfer. RAW or HEIF only fails with `IMAGE_NOT_JPEG`;
  Canon's "AF failed" maps to `FOCUS_FAILED`. When the camera is about to power
  off it is asked to stay on.
- ISO, shutter speed, aperture and white balance list the values the camera
  allows, labelled from Canon's API reference tables (`CanonValues`); Bulb is not
  offered, as Canon does not allow setting it from a computer.
- Live view is sent to the PC (Evf output device |= PC) and each frame is
  downloaded on request.

Licensing: the EDSDK is licensed to the business by Canon, which confirmed bundling
`EDSDK.dll` and `EdsImage.dll` is allowed. Canon's readme requires stating that the
software is based in part on the work of the Independent JPEG Group; the build
writes that into `THIRD_PARTY_NOTICES.txt`. Keep the SDK under `sdk/` (git-ignored);
**never commit Canon's DLLs, headers or sample code.**

## Building

```bash
dotnet build -c Release electron/bin/CanonCameraHelper
```

## Testing without a camera

```bash
node scripts/test-camera-helper.js
```

Runs the helper with `--simulate` and checks capture, settings validation, path
safety, and every failure mode below. The simulator is selected only by
`--simulate`, which the app passes only when `PHOTUNA_CAMERA_SIMULATOR=1`, so an
operator can never choose it.

`PHOTUNA_CAMERA_SIM_FAIL` injects failures:

| Value | Simulates |
|---|---|
| `connect` | no camera found |
| `capture` | shutter did not fire |
| `focus` | autofocus failed — the most common real-world failure |
| `hang` | a driver call that never returns |
| `crash` | the helper dying mid-capture |
| `unplug-after-2` | the USB cable pulled after two shots |

## Protocol

Line-delimited JSON over stdin/stdout. stdout carries protocol messages only;
logs go to stderr.

```
→ {"id":"1","cmd":"connect"}
← {"id":"1","ok":true,"result":{"sdkAvailable":true,"connected":true,"model":"...","batteryPercent":87,...}}

→ {"id":"2","cmd":"capture","args":{"directory":"C:\\...\\captures","fileName":"shot_00.jpg","timeoutMs":10000}}
← {"id":"2","ok":false,"error":{"code":"FOCUS_FAILED","message":"..."}}
```

The first line is always `{"event":"ready","backend":"...","protocol":1}`.

| Command | Args | Result |
|---|---|---|
| `status` | | camera status |
| `connect` | | camera status |
| `disconnect` | | camera status |
| `capture` | `directory` (absolute, must exist), `fileName` (plain `.jpg`), `timeoutMs` 1000–30000 | path, width, height, bytes, elapsedMs |
| `getSettings` | | `{ iso, shutterSpeed, aperture, whiteBalance }` each `{ current, allowed[] }` |
| `setSetting` | `key`, `value` (must be in `allowed`) | all settings |
| `startLiveView` | | `{ started }` |
| `liveViewFrame` | | `{ jpeg (base64), frameNo }`; `NO_FRAME` when nothing newer |
| `stopLiveView` | | `{ stopped }` |
| `shutdown` | | helper exits |

The helper writes only inside `directory`, and only a plain `.jpg` file name, so
a malformed request cannot write elsewhere on the PC.

Error codes the booth acts on: `NO_CAMERA`, `NOT_CONNECTED`, `FOCUS_FAILED`,
`CAPTURE_FAILED`, `DISCONNECTED`, `VALUE_NOT_ALLOWED`, `UNKNOWN_SETTING`,
`SDK_NOT_INSTALLED`, `BAD_REQUEST`; and from the app side `TIMEOUT`,
`HELPER_EXITED`, `HELPER_UNSTABLE`, `HELPER_NOT_FOUND`, `HELPER_START_FAILED`.
