using System.Diagnostics;

namespace CanonCameraHelper;

/// <summary>
/// Uses whichever brand's camera is attached. Only backends whose SDK is in this build
/// are tried, in order; the first that connects handles every command until the
/// camera is disconnected.
/// </summary>
public sealed class AutoBackend : ICameraBackend
{
    private readonly IReadOnlyList<ICameraBackend> _backends;
    private ICameraBackend? _active;

    public AutoBackend(params ICameraBackend[] backends)
    {
        _backends = backends;
    }

    public string Name => _active?.Name ?? "auto";

    public CameraStatus GetStatus()
    {
        if (_active is not null) return _active.GetStatus();

        var statuses = _backends.Select(b => b.GetStatus()).ToList();
        // Distinct: one brand can have more than one backend (Nikon has one for the Z
        // series and one for the older per-model modules), and the operator sees a brand.
        var available = statuses.Where(s => s.SdkAvailable).Select(s => s.Backend).Distinct().ToList();
        return new CameraStatus(
            SdkAvailable: available.Count > 0,
            Connected: false,
            Model: null,
            BatteryPercent: null,
            ShotsRemaining: null,
            Backend: available.Count > 0 ? string.Join("+", available) : "none");
    }

    public CameraStatus Connect()
    {
        if (_active is not null && _active.GetStatus().Connected) return _active.GetStatus();
        _active = null;

        var candidates = _backends.Where(b => b.GetStatus().SdkAvailable).ToList();
        if (candidates.Count == 0)
            throw new CameraException("SDK_NOT_INSTALLED", "No camera brand's SDK is included in this build. The booth will use the webcam.");

        // Troubleshooting only: PHOTUNA_CAMERA_BACKENDS=canon,nikon limits the brands tried.
        var only = Environment.GetEnvironmentVariable("PHOTUNA_CAMERA_BACKENDS");
        if (!string.IsNullOrWhiteSpace(only))
        {
            var names = new HashSet<string>(
                only.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries),
                StringComparer.OrdinalIgnoreCase);
            candidates = candidates.Where(b => names.Contains(b.Name)).ToList();
        }

        // Only ask the SDKs of brands actually plugged in: probing is slow, and one
        // brand's SDK enumerating another brand's camera can stall.
        var attached = UsbCameraBrands.Detect();
        if (attached is not null)
        {
            Log($"USB camera brands present: {(attached.Count == 0 ? "none" : string.Join(", ", attached))}");
            if (attached.Count == 0)
                throw new CameraException("NO_CAMERA", "No Canon, Nikon or Sony camera is connected by USB. Check the cable and that the camera is on.");
            candidates = candidates.Where(b => attached.Contains(b.Name)).ToList();
            if (candidates.Count == 0)
                throw new CameraException("SDK_NOT_INSTALLED",
                    $"Support for the connected camera ({string.Join(", ", attached)}) is not included in this build.");
        }

        CameraException? firstRealError = null;
        foreach (var backend in candidates)
        {
            var stopwatch = Stopwatch.StartNew();
            Log($"trying {backend.Name}");
            try
            {
                var status = backend.Connect();
                _active = backend;
                Log($"{backend.Name} connected in {stopwatch.ElapsedMilliseconds} ms: {status.Model}");
                return status;
            }
            catch (CameraException ex) when (ex.Code == "NO_CAMERA")
            {
                Log($"{backend.Name}: no camera ({stopwatch.ElapsedMilliseconds} ms)");
            }
            catch (CameraException ex)
            {
                Log($"{backend.Name}: {ex.Code} {ex.Message} ({stopwatch.ElapsedMilliseconds} ms)");
                firstRealError ??= ex;
            }
        }

        if (firstRealError is not null) throw firstRealError;
        throw new CameraException("NO_CAMERA", "No supported camera found. Check the USB cable and that the camera is on.");
    }

    private static void Log(string message)
    {
        Console.Error.WriteLine($"[canon-camera-helper] auto: {message}");
        Console.Error.Flush();
    }

    public void Disconnect()
    {
        _active?.Disconnect();
        _active = null;
    }

    public CaptureResult Capture(string destinationPath, TimeSpan timeout) =>
        Active().Capture(destinationPath, timeout);

    public IReadOnlyDictionary<string, SettingValue> GetSettings() => Active().GetSettings();

    public IReadOnlyDictionary<string, SettingValue> SetSetting(string key, string value) =>
        Active().SetSetting(key, value);

    public void StartLiveView() => Active().StartLiveView();

    public void StopLiveView() => _active?.StopLiveView();

    public LiveViewFrame? GetLiveViewFrame() => Active().GetLiveViewFrame();

    public void Dispose()
    {
        foreach (var backend in _backends)
        {
            try { backend.Dispose(); } catch { /* shutting down */ }
        }
    }

    private ICameraBackend Active() =>
        _active ?? throw new CameraException("NOT_CONNECTED", "Camera is not connected.");
}
