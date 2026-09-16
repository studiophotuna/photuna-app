using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace CanonCameraHelper;

/// <summary>
/// Nikon DSLRs and older mirrorless bodies through Nikon's per-model MAID modules
/// (TypeXXXX.md3) — the D3 through D6 and D850 generation that the unified Remote SDK
/// v2 does not cover.
///
/// The booth still has one "USB camera" setting: this backend answers to the same
/// brand name as <see cref="NikonBackend"/> ("nikon"), so <see cref="AutoBackend"/>
/// reaches it from the same Nikon USB vendor id. It is registered after the Z backend,
/// so a Z body still connects over Remote SDK v2 and only a camera that backend turns
/// down falls through to here.
///
/// Which module fits the attached camera is settled by asking each module in turn
/// whether it can see a camera; the USB product id only decides what order to ask in.
///
/// Written from Nikon's headers, MAID3 documents and sample program without a Nikon
/// camera to test against — run scripts/test-camera-helper.js --hardware with a body
/// attached before relying on it at an event.
/// </summary>
public sealed class NikonMaidBackend : ICameraBackend
{
    private static readonly string SdkDirectory = Path.Combine(AppContext.BaseDirectory, "nikon");

    private static readonly (string Key, uint Capability)[] ExposureSettings =
    {
        (SettingKeys.Iso, NikonMaidSdk.CapSensitivity),
        (SettingKeys.ShutterSpeed, NikonMaidSdk.CapShutterSpeed),
        (SettingKeys.Aperture, NikonMaidSdk.CapAperture),
        (SettingKeys.WhiteBalance, NikonMaidSdk.CapWbMode),
    };

    /// <summary>
    /// USB product id → the module to try first. Compiled from Nikon's published device
    /// ids; it only orders the probe and never limits it, so an entry that is missing or
    /// wrong costs a moment of probing and nothing else.
    /// </summary>
    private static readonly Dictionary<string, string> ModuleHints = new(StringComparer.OrdinalIgnoreCase)
    {
        ["0421"] = "Type0003", // D90
        ["0422"] = "Type0001", // D700
        ["0425"] = "Type0001", // D300S
        ["0426"] = "Type0001", // D3S
        ["0428"] = "Type0004", // D7000
        ["0429"] = "Type0005", // D5100
        ["042A"] = "Type0006", // D800
        ["042B"] = "Type0007", // D4
        ["042E"] = "Type0008", // D600
        ["042F"] = "Type0009", // D5200
        ["0430"] = "Type0010", // D7100
        ["0431"] = "Type0011", // D5300
        ["0432"] = "Type0012", // Df
        ["0434"] = "Type0013", // D4S
        ["0435"] = "Type0014", // D810
        ["0436"] = "Type0015", // D750
        ["0437"] = "Type0016", // D5500
        ["0438"] = "Type0017", // D7200
        ["0439"] = "Type0018", // D5
        ["043A"] = "Type0020", // D500
        ["043C"] = "Type0016", // D5600
        ["043D"] = "Type0021", // D7500
        ["043F"] = "Type0022", // D850
        ["0442"] = "Type0023", // Z7
        ["0443"] = "Type0024", // Z6
        ["0444"] = "Type0025", // Z50
        ["0445"] = "Type0026", // D780
        ["0446"] = "Type0027", // D6
        ["0447"] = "Type0028", // Z5
        ["0448"] = "Type0029", // Z6II
        ["0449"] = "Type0029", // Z7II
        ["044C"] = "Type0030", // Z9
        ["044F"] = "Type0031", // Z8
    };

    private static readonly TimeSpan CommandTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan ProbeTimeout = TimeSpan.FromSeconds(2.5);
    private static readonly TimeSpan ProbeBudget = TimeSpan.FromSeconds(9);
    private static readonly TimeSpan CameraSettleWait = TimeSpan.FromSeconds(2);

    // The module keeps these function pointers for as long as it is open.
    private readonly NikonMaidSdk.CompletionProc _completionProc;
    private readonly NikonMaidSdk.EventProc _eventProc;
    private readonly NikonMaidSdk.ProgressProc _progressProc;
    private readonly NikonMaidSdk.DataProc _dataProc;
    private readonly NikonMaidSdk.UiRequestProc _uiRequestProc;

    private NikonMaidModule? _module;
    private IntPtr _moduleObject;
    private IntPtr _sourceObject;
    private Dictionary<uint, (uint Type, uint Operations)> _sourceCaps = new();
    private string? _model;
    private bool _connected;

    // MAID delivers completions, events and data while the client pumps Command_Async
    // on its own thread, so these need no locking: only one command is ever in flight.
    private int _completed;
    private int _completionResult;
    private readonly List<uint> _newItems = new();

    private byte[]? _acquireBuffer;
    private int _acquireOffset;
    private uint _acquireFileType;
    private bool _acquireWasPixelData;

    private bool _liveView;
    private long _frameNo;

    public NikonMaidBackend()
    {
        _completionProc = OnCompletion;
        _eventProc = OnEvent;
        _progressProc = (_, _, _, _, _) => { };
        _dataProc = OnData;
        _uiRequestProc = OnUiRequest;
    }

    public string Name => "nikon";

    private static string[] ModuleFiles() =>
        Directory.Exists(SdkDirectory)
            ? Directory.GetFiles(SdkDirectory, "Type*.md3")
            : Array.Empty<string>();

    public CameraStatus GetStatus() => new(
        SdkAvailable: ModuleFiles().Length > 0,
        Connected: _connected,
        Model: _connected ? _model : null,
        BatteryPercent: _connected ? TryReadBattery() : null,
        ShotsRemaining: null,
        Backend: Name);

    public CameraStatus Connect()
    {
        if (_connected) return GetStatus();

        var modules = ModuleFiles();
        if (modules.Length == 0)
            throw new CameraException("SDK_NOT_INSTALLED", "Support for older Nikon cameras is not included in this build.");

        var deadline = DateTime.UtcNow + ProbeBudget;
        foreach (var path in OrderModules(modules))
        {
            if (DateTime.UtcNow >= deadline)
            {
                Log("ran out of time before every module had been tried");
                break;
            }
            if (TryConnectThrough(path)) return GetStatus();
        }

        throw new CameraException("NO_CAMERA", "No Nikon camera found.");
    }

    /// <summary>
    /// The modules whose cameras are plugged in first, then the rest newest-first: a
    /// newer body is the likelier guess when the product id is not in the hint table.
    /// </summary>
    private static IEnumerable<string> OrderModules(string[] modules)
    {
        var hinted = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var productId in UsbCameraBrands.NikonProductIds())
        {
            if (ModuleHints.TryGetValue(productId, out var typeName)) hinted.Add(typeName);
        }

        return modules
            .OrderByDescending(path => hinted.Contains(Path.GetFileNameWithoutExtension(path)))
            .ThenByDescending(path => Path.GetFileNameWithoutExtension(path), StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Opens one module and keeps it only if it can see a camera. Anything that goes
    /// wrong closes it again and answers false: the next module still gets its turn.
    /// </summary>
    private bool TryConnectThrough(string path)
    {
        var stopwatch = Stopwatch.StartNew();
        var module = NikonMaidModule.TryLoad(path);
        if (module is null) return false;

        _module = module;
        try
        {
            _moduleObject = AllocObject(refClient: 1);
            if (Command(IntPtr.Zero, NikonMaidSdk.CommandOpen, 0, NikonMaidSdk.DataTypeObjectPtr, _moduleObject,
                    ProbeTimeout, pumpOn: _moduleObject) != NikonMaidSdk.ResultNoError)
                return Abandon();

            var moduleCaps = ReadCapabilities(_moduleObject, ProbeTimeout);
            SetCallbacks(_moduleObject, moduleCaps, NikonMaidSdk.ObjectTypeModule);
            if (Supports(moduleCaps, NikonMaidSdk.CapModuleMode, NikonMaidSdk.CapOperationSet))
                Command(_moduleObject, NikonMaidSdk.CommandCapSet, NikonMaidSdk.CapModuleMode,
                    NikonMaidSdk.DataTypeUnsigned, (IntPtr)NikonMaidSdk.ModuleModeController, ProbeTimeout);

            var sourceId = FindSource(moduleCaps);
            if (sourceId is null) return Abandon();

            _sourceObject = AllocObject(refClient: 2);
            if (Command(_moduleObject, NikonMaidSdk.CommandOpen, sourceId.Value, NikonMaidSdk.DataTypeObjectPtr,
                    _sourceObject, CommandTimeout) != NikonMaidSdk.ResultNoError)
                return Abandon();

            _sourceCaps = ReadCapabilities(_sourceObject, CommandTimeout);
            SetCallbacks(_sourceObject, _sourceCaps, NikonMaidSdk.ObjectTypeSource);

            _model = ReadString(_sourceObject, NikonMaidSdk.CapName) is { Length: > 0 } name
                ? name
                : $"Nikon camera ({module.TypeName})";

            // Send shots to the PC only, so the booth never depends on a card being in
            // the camera or having room.
            if (Supports(_sourceCaps, NikonMaidSdk.CapSaveMedia, NikonMaidSdk.CapOperationSet))
            {
                var rc = SetUnsigned(_sourceObject, NikonMaidSdk.CapSaveMedia, NikonMaidSdk.SaveMediaSdram);
                if (rc != NikonMaidSdk.ResultNoError)
                    Log($"could not set save media to PC (NKERROR {rc}); shots may also go to the card");
            }

            _connected = true;
            Log($"{module.TypeName} connected in {stopwatch.ElapsedMilliseconds} ms: {_model}");
            return true;
        }
        catch (Exception ex)
        {
            Log($"{module.TypeName} failed: {ex.Message}");
            return Abandon();
        }
    }

    /// <summary>Closes whatever was opened for a module that turned out not to fit.</summary>
    private bool Abandon()
    {
        CloseObjects();
        _module?.Dispose();
        _module = null;
        return false;
    }

    /// <summary>
    /// The source (camera) id this module can see, or null. A camera plugged in a moment
    /// ago is announced through an AddChild event, so the pump runs for a short while
    /// before giving up on the module.
    /// </summary>
    private uint? FindSource(Dictionary<uint, (uint Type, uint Operations)> moduleCaps)
    {
        if (!Supports(moduleCaps, NikonMaidSdk.CapChildren, NikonMaidSdk.CapOperationGet)) return null;

        var deadline = DateTime.UtcNow + CameraSettleWait;
        while (true)
        {
            var children = ReadUnsignedEnum(_moduleObject, NikonMaidSdk.CapChildren, ProbeTimeout);
            if (children is { Length: > 0 }) return children[0];

            if (DateTime.UtcNow >= deadline) return null;
            Pump(_moduleObject);
            Thread.Sleep(50);
        }
    }

    public void Disconnect()
    {
        if (!_connected) return;
        _connected = false;
        _liveView = false;
        CloseObjects();
        _module?.Dispose();
        _module = null;
        _sourceCaps = new Dictionary<uint, (uint, uint)>();
        _model = null;
    }

    public CaptureResult Capture(string destinationPath, TimeSpan timeout)
    {
        EnsureConnected();
        var stopwatch = Stopwatch.StartNew();

        lock (_newItems) _newItems.Clear();

        var rc = StartCapture(timeout);
        if (rc != NikonMaidSdk.ResultNoError)
            throw Map(rc, "CAPTURE_FAILED", "The Nikon camera did not take the photo");

        var jpeg = CollectJpeg(stopwatch, timeout);
        File.WriteAllBytes(destinationPath, jpeg);
        var (width, height) = JpegInfo.ReadSize(destinationPath);

        return new CaptureResult(
            Path: destinationPath,
            Width: width,
            Height: height,
            Bytes: jpeg.LongLength,
            ElapsedMs: stopwatch.ElapsedMilliseconds);
    }

    /// <summary>
    /// Fires the shutter, focusing first. Bodies that offer AFCapture do both in one
    /// call; the rest get an autofocus pass before the plain capture.
    /// </summary>
    private int StartCapture(TimeSpan timeout)
    {
        if (Supports(_sourceCaps, NikonMaidSdk.CapAfCapture, NikonMaidSdk.CapOperationStart))
            return CapStart(NikonMaidSdk.CapAfCapture, timeout);

        if (Supports(_sourceCaps, NikonMaidSdk.CapAutoFocus, NikonMaidSdk.CapOperationStart))
        {
            var focus = CapStart(NikonMaidSdk.CapAutoFocus, timeout);
            if (focus == NikonMaidSdk.ResultOutOfFocus)
                throw new CameraException("FOCUS_FAILED", "The camera could not focus.");
            if (focus != NikonMaidSdk.ResultNoError) Log($"autofocus answered NKERROR {focus}; taking the shot anyway");
        }

        return CapStart(NikonMaidSdk.CapCapture, timeout);
    }

    private int CapStart(uint capability, TimeSpan timeout)
    {
        var rc = Command(_sourceObject, NikonMaidSdk.CommandCapStart, capability, NikonMaidSdk.DataTypeNull,
            IntPtr.Zero, timeout);

        // The camera reporting itself busy with a release it is already finishing is not
        // a failure; the photo still arrives.
        return rc is NikonMaidSdk.ResultBulbReleaseBusy or NikonMaidSdk.ResultSilentReleaseBusy
            or NikonMaidSdk.ResultMovieFrameReleaseBusy
            ? NikonMaidSdk.ResultNoError
            : rc;
    }

    /// <summary>
    /// Waits for the camera to hand over an image and returns its JPEG. RAW + JPEG
    /// produces more than one item, so each is tried until one yields a JPEG.
    /// </summary>
    private byte[] CollectJpeg(Stopwatch stopwatch, TimeSpan timeout)
    {
        var sawRawOnly = false;

        while (true)
        {
            uint? itemId = null;
            lock (_newItems)
            {
                if (_newItems.Count > 0)
                {
                    itemId = _newItems[0];
                    _newItems.RemoveAt(0);
                }
            }

            if (itemId is not null)
            {
                var jpeg = TryAcquire(itemId.Value, timeout, out var wasRaw);
                if (jpeg is not null) return jpeg;
                sawRawOnly |= wasRaw;
            }
            else
            {
                if (stopwatch.Elapsed >= timeout)
                {
                    throw sawRawOnly
                        ? new CameraException("IMAGE_NOT_JPEG",
                            "The camera saved RAW only. Set its image quality to JPEG or RAW + JPEG.")
                        : new CameraException("CAPTURE_FAILED", "The Nikon camera did not send the photo to the PC in time.");
                }
                Pump(_sourceObject);
                Thread.Sleep(20);
            }
        }
    }

    /// <summary>Opens one item, acquires its image, and closes it again.</summary>
    private byte[]? TryAcquire(uint itemId, TimeSpan timeout, out bool wasRaw)
    {
        wasRaw = false;
        var item = AllocObject(refClient: 3);
        var data = IntPtr.Zero;

        try
        {
            if (Command(_sourceObject, NikonMaidSdk.CommandOpen, itemId, NikonMaidSdk.DataTypeObjectPtr, item,
                    timeout) != NikonMaidSdk.ResultNoError)
                return null;

            var itemCaps = ReadCapabilities(item, timeout);
            SetCallbacks(item, itemCaps, NikonMaidSdk.ObjectTypeItem);

            data = AllocObject(refClient: 4);
            if (Command(item, NikonMaidSdk.CommandOpen, NikonMaidSdk.DataObjTypeImage,
                    NikonMaidSdk.DataTypeObjectPtr, data, timeout) != NikonMaidSdk.ResultNoError)
            {
                Marshal.FreeHGlobal(data);
                data = IntPtr.Zero;
                return null;
            }

            var dataCaps = ReadCapabilities(data, timeout);
            if (!Supports(dataCaps, NikonMaidSdk.CapDataProc, NikonMaidSdk.CapOperationSet)) return null;

            _acquireBuffer = null;
            _acquireOffset = 0;
            _acquireFileType = 0;
            _acquireWasPixelData = false;

            SetCallback(data, NikonMaidSdk.CapDataProc, Marshal.GetFunctionPointerForDelegate(_dataProc));
            var rc = Command(data, NikonMaidSdk.CommandCapStart, NikonMaidSdk.CapAcquire, NikonMaidSdk.DataTypeNull,
                IntPtr.Zero, timeout);
            Command(data, NikonMaidSdk.CommandCapSet, NikonMaidSdk.CapDataProc, NikonMaidSdk.DataTypeNull,
                IntPtr.Zero, timeout);

            if (rc != NikonMaidSdk.ResultNoError)
            {
                Log($"acquiring item {itemId} answered NKERROR {rc}");
                return null;
            }

            if (_acquireWasPixelData || (_acquireFileType != NikonMaidSdk.FileDataTypeJpeg && _acquireOffset > 0))
            {
                wasRaw = true;
                return null;
            }
            if (_acquireBuffer is null || _acquireOffset == 0) return null;

            var jpeg = _acquireBuffer.Length == _acquireOffset
                ? _acquireBuffer
                : _acquireBuffer[.._acquireOffset];
            return jpeg.Length > 2 && jpeg[0] == 0xFF && jpeg[1] == 0xD8 ? jpeg : null;
        }
        finally
        {
            _acquireBuffer = null;
            if (data != IntPtr.Zero)
            {
                Command(data, NikonMaidSdk.CommandClose, 0, NikonMaidSdk.DataTypeNull, IntPtr.Zero, timeout);
                Marshal.FreeHGlobal(data);
            }
            Command(item, NikonMaidSdk.CommandClose, 0, NikonMaidSdk.DataTypeNull, IntPtr.Zero, timeout);
            Marshal.FreeHGlobal(item);
        }
    }

    public IReadOnlyDictionary<string, SettingValue> GetSettings()
    {
        EnsureConnected();

        var settings = new Dictionary<string, SettingValue>();
        foreach (var (key, capability) in ExposureSettings)
        {
            if (!Supports(_sourceCaps, capability, NikonMaidSdk.CapOperationGet)) continue;

            var read = ReadPackedStringEnum(capability);
            if (read is null || read.Value.Values.Count == 0) continue;

            var (values, index) = read.Value;
            var current = index >= 0 && index < values.Count ? values[index] : values[0];
            settings[key] = new SettingValue(
                ToDisplay(key, current),
                values.Select(v => ToDisplay(key, v)).ToList());
        }
        return settings;
    }

    public IReadOnlyDictionary<string, SettingValue> SetSetting(string key, string value)
    {
        EnsureConnected();

        var capability = ExposureSettings.FirstOrDefault(s => s.Key == key).Capability;
        if (capability == 0)
            throw new CameraException("UNKNOWN_SETTING", $"Unknown setting '{key}'.");

        var read = ReadPackedStringEnum(capability)
            ?? throw new CameraException("VALUE_NOT_ALLOWED", $"The camera does not offer {key} right now.");
        var index = read.Values.IndexOf(FromDisplay(key, value));
        if (index < 0)
            throw new CameraException("VALUE_NOT_ALLOWED", $"'{value}' is not an allowed value for {key}.");

        if (!Supports(_sourceCaps, capability, NikonMaidSdk.CapOperationSet))
            throw new CameraException("SETTING_REJECTED", $"The camera will not let this app change {key} right now.");

        // Nikon's sample sends the index back as a plain unsigned, which every module
        // accepts for an enum capability.
        var rc = SetUnsigned(_sourceObject, capability, (uint)index);
        if (rc != NikonMaidSdk.ResultNoError)
        {
            throw rc == NikonMaidSdk.ResultValueOutOfBounds
                ? new CameraException("VALUE_NOT_ALLOWED", $"'{value}' is not an allowed value for {key}.")
                : new CameraException("SETTING_REJECTED",
                    $"The camera refused this change (NKERROR {rc}). Its mode dial may be locking {key}.");
        }

        return GetSettings();
    }

    public void StartLiveView()
    {
        EnsureConnected();

        if (!Supports(_sourceCaps, NikonMaidSdk.CapLiveViewStatus, NikonMaidSdk.CapOperationSet)
            || !Supports(_sourceCaps, NikonMaidSdk.CapGetLiveViewImage, NikonMaidSdk.CapOperationGet))
            throw new CameraException("LIVE_VIEW_UNAVAILABLE", "This Nikon camera does not offer live view to the booth.");

        var rc = SetUnsigned(_sourceObject, NikonMaidSdk.CapLiveViewStatus, 1);
        if (rc != NikonMaidSdk.ResultNoError)
            throw new CameraException("LIVE_VIEW_UNAVAILABLE", $"The Nikon camera did not start live view (NKERROR {rc}).");

        _liveView = true;
    }

    public void StopLiveView()
    {
        if (!_liveView || !_connected) return;
        _liveView = false;
        try
        {
            var rc = SetUnsigned(_sourceObject, NikonMaidSdk.CapLiveViewStatus, 0);
            if (rc != NikonMaidSdk.ResultNoError) Log($"stopping live view answered NKERROR {rc}");
        }
        catch (Exception ex)
        {
            Log($"stopping live view failed: {ex.Message}");
        }
    }

    public LiveViewFrame? GetLiveViewFrame()
    {
        EnsureConnected();
        if (!_liveView) throw new CameraException("LIVE_VIEW_OFF", "Live view is not started.");

        var payload = ReadArray(NikonMaidSdk.CapGetLiveViewImage, out var rc);
        if (payload is null)
        {
            if (rc == NikonMaidSdk.ResultNotLiveView)
            {
                _liveView = false;
                throw new CameraException("LIVE_VIEW_OFF", "The camera left live view.");
            }
            return null;
        }

        // Nikon's frame is a header followed by the JPEG, and the header's length
        // differs between bodies — so the JPEG is found by its own start marker rather
        // than by trusting a fixed offset.
        var start = IndexOfJpegStart(payload);
        if (start < 0) return null;

        var jpeg = payload[start..];
        return new LiveViewFrame(jpeg, ++_frameNo);
    }

    private static int IndexOfJpegStart(byte[] buffer)
    {
        for (var i = 0; i + 2 < buffer.Length; i++)
        {
            if (buffer[i] == 0xFF && buffer[i + 1] == 0xD8 && buffer[i + 2] == 0xFF) return i;
        }
        return -1;
    }

    public void Dispose()
    {
        Disconnect();
    }

    // ── MAID plumbing ──────────────────────────────────────────────────────────

    private void EnsureConnected()
    {
        if (!_connected || _module is null || _sourceObject == IntPtr.Zero)
            throw new CameraException("NOT_CONNECTED", "Camera is not connected.");
    }

    /// <summary>
    /// Runs one command and waits for its completion callback. MAID answers
    /// <see cref="NikonMaidSdk.ResultPending"/> for work that finishes later, and only
    /// delivers that result while the client pumps Command_Async.
    /// </summary>
    private int Command(IntPtr target, uint command, uint param, uint dataType, IntPtr data,
        TimeSpan timeout, IntPtr? pumpOn = null)
    {
        if (_module is null) return NikonMaidSdk.ResultNotInitialized;

        var start = _completed;
        int rc;
        try
        {
            rc = _module.EntryPoint(target, command, param, dataType, data,
                Marshal.GetFunctionPointerForDelegate(_completionProc), IntPtr.Zero);
        }
        catch (SEHException ex)
        {
            Log($"command {command} on 0x{param:X} faulted: {ex.Message}");
            return NikonMaidSdk.ResultHardwareError;
        }

        if (rc != NikonMaidSdk.ResultNoError && rc != NikonMaidSdk.ResultPending) return rc;

        // Opening an object has no object of its own to pump on yet, so the caller says
        // which one to use.
        var pump = pumpOn ?? (target != IntPtr.Zero ? target : _moduleObject);
        var deadline = DateTime.UtcNow + timeout;
        while (_completed == start)
        {
            if (DateTime.UtcNow >= deadline)
            {
                Log($"command {command} on 0x{param:X} never completed");
                return rc == NikonMaidSdk.ResultPending ? NikonMaidSdk.ResultClientTimeout : rc;
            }
            Pump(pump);
            Thread.Sleep(10);
        }

        return _completionResult;
    }

    private void Pump(IntPtr target)
    {
        if (_module is null || target == IntPtr.Zero) return;
        try
        {
            _module.EntryPoint(target, NikonMaidSdk.CommandAsync, 0, NikonMaidSdk.DataTypeNull,
                IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        }
        catch (SEHException ex)
        {
            Log($"pumping the module faulted: {ex.Message}");
        }
    }

    private Dictionary<uint, (uint Type, uint Operations)> ReadCapabilities(IntPtr target, TimeSpan timeout)
    {
        var caps = new Dictionary<uint, (uint, uint)>();

        // The count can change between the two calls; the module says so with
        // kNkMAIDResult_BufferSize and the pair is asked for again.
        for (var attempt = 0; attempt < 4; attempt++)
        {
            var countBuffer = Marshal.AllocHGlobal(sizeof(uint));
            var count = 0;
            try
            {
                Marshal.WriteInt32(countBuffer, 0);
                if (Command(target, NikonMaidSdk.CommandGetCapCount, 0, NikonMaidSdk.DataTypeUnsignedPtr,
                        countBuffer, timeout) != NikonMaidSdk.ResultNoError)
                    return caps;
                count = Marshal.ReadInt32(countBuffer);
            }
            finally
            {
                Marshal.FreeHGlobal(countBuffer);
            }

            if (count <= 0 || count > 4096) return caps;

            var array = Marshal.AllocHGlobal(count * NikonMaidSdk.CapInfoSize);
            try
            {
                var rc = Command(target, NikonMaidSdk.CommandGetCapInfo, (uint)count,
                    NikonMaidSdk.DataTypeCapInfoPtr, array, timeout);
                if (rc == NikonMaidSdk.ResultBufferSize) continue;
                if (rc != NikonMaidSdk.ResultNoError) return caps;

                for (var i = 0; i < count; i++)
                {
                    var entry = array + i * NikonMaidSdk.CapInfoSize;
                    var id = (uint)Marshal.ReadInt32(entry, NikonMaidSdk.CapInfoIdOffset);
                    caps[id] = (
                        (uint)Marshal.ReadInt32(entry, NikonMaidSdk.CapInfoTypeOffset),
                        (uint)Marshal.ReadInt32(entry, NikonMaidSdk.CapInfoOperationsOffset));
                }
                return caps;
            }
            finally
            {
                Marshal.FreeHGlobal(array);
            }
        }

        return caps;
    }

    private static bool Supports(Dictionary<uint, (uint Type, uint Operations)> caps, uint id, uint operation) =>
        caps.TryGetValue(id, out var info) && (info.Operations & operation) != 0;

    private void SetCallbacks(IntPtr target, Dictionary<uint, (uint Type, uint Operations)> caps, uint objectType)
    {
        if (Supports(caps, NikonMaidSdk.CapProgressProc, NikonMaidSdk.CapOperationSet))
            SetCallback(target, NikonMaidSdk.CapProgressProc, Marshal.GetFunctionPointerForDelegate(_progressProc));

        if (Supports(caps, NikonMaidSdk.CapEventProc, NikonMaidSdk.CapOperationSet))
            SetCallback(target, NikonMaidSdk.CapEventProc, Marshal.GetFunctionPointerForDelegate(_eventProc));

        // Only the module object shows prompts.
        if (objectType == NikonMaidSdk.ObjectTypeModule
            && Supports(caps, NikonMaidSdk.CapUiRequestProc, NikonMaidSdk.CapOperationSet))
            SetCallback(target, NikonMaidSdk.CapUiRequestProc, Marshal.GetFunctionPointerForDelegate(_uiRequestProc));
    }

    private void SetCallback(IntPtr target, uint capability, IntPtr proc)
    {
        var buffer = Marshal.AllocHGlobal(NikonMaidSdk.CallbackSize);
        try
        {
            Marshal.WriteIntPtr(buffer, NikonMaidSdk.CallbackProcOffset, proc);
            Marshal.WriteIntPtr(buffer, NikonMaidSdk.CallbackRefOffset, IntPtr.Zero);
            Command(target, NikonMaidSdk.CommandCapSet, capability, NikonMaidSdk.DataTypeCallbackPtr,
                buffer, CommandTimeout);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private int SetUnsigned(IntPtr target, uint capability, uint value) =>
        Command(target, NikonMaidSdk.CommandCapSet, capability, NikonMaidSdk.DataTypeUnsigned,
            (IntPtr)value, CommandTimeout);

    /// <summary>Reads an enum capability whose elements are 4-byte unsigned values.</summary>
    private uint[]? ReadUnsignedEnum(IntPtr target, uint capability, TimeSpan timeout)
    {
        var header = Marshal.AllocHGlobal(NikonMaidSdk.EnumSize);
        var values = IntPtr.Zero;
        try
        {
            Zero(header, NikonMaidSdk.EnumSize);
            if (Command(target, NikonMaidSdk.CommandCapGet, capability, NikonMaidSdk.DataTypeEnumPtr, header,
                    timeout) != NikonMaidSdk.ResultNoError)
                return null;

            var elements = Marshal.ReadInt32(header, NikonMaidSdk.EnumElementsOffset);
            var physicalBytes = Marshal.ReadInt16(header, NikonMaidSdk.EnumPhysicalBytesOffset);
            if (elements <= 0 || elements > 4096 || physicalBytes != 4) return elements == 0 ? Array.Empty<uint>() : null;

            values = Marshal.AllocHGlobal(elements * physicalBytes);
            Marshal.WriteIntPtr(header, NikonMaidSdk.EnumDataOffset, values);
            if (Command(target, NikonMaidSdk.CommandCapGetArray, capability, NikonMaidSdk.DataTypeEnumPtr, header,
                    timeout) != NikonMaidSdk.ResultNoError)
                return null;

            var result = new uint[elements];
            for (var i = 0; i < elements; i++) result[i] = (uint)Marshal.ReadInt32(values, i * 4);
            return result;
        }
        finally
        {
            if (values != IntPtr.Zero) Marshal.FreeHGlobal(values);
            Marshal.FreeHGlobal(header);
        }
    }

    /// <summary>
    /// Reads an enum capability whose elements are packed strings — how Nikon reports
    /// the ISO, shutter, aperture and white balance values a camera will accept right
    /// now ("100\0200\0400\0").
    /// </summary>
    private (List<string> Values, int Index)? ReadPackedStringEnum(uint capability)
    {
        var header = Marshal.AllocHGlobal(NikonMaidSdk.EnumSize);
        var values = IntPtr.Zero;
        try
        {
            Zero(header, NikonMaidSdk.EnumSize);
            if (Command(_sourceObject, NikonMaidSdk.CommandCapGet, capability, NikonMaidSdk.DataTypeEnumPtr, header,
                    CommandTimeout) != NikonMaidSdk.ResultNoError)
                return null;

            if ((uint)Marshal.ReadInt32(header, NikonMaidSdk.EnumTypeOffset) != NikonMaidSdk.ArrayTypePackedString)
                return null;

            // For packed strings ulElements is the byte length of the whole buffer.
            var bytes = Marshal.ReadInt32(header, NikonMaidSdk.EnumElementsOffset);
            var physicalBytes = Marshal.ReadInt16(header, NikonMaidSdk.EnumPhysicalBytesOffset);
            var index = Marshal.ReadInt32(header, NikonMaidSdk.EnumValueOffset);
            if (bytes <= 0 || bytes > 64 * 1024 || physicalBytes != 1) return null;

            values = Marshal.AllocHGlobal(bytes);
            Zero(values, bytes);
            Marshal.WriteIntPtr(header, NikonMaidSdk.EnumDataOffset, values);
            if (Command(_sourceObject, NikonMaidSdk.CommandCapGetArray, capability, NikonMaidSdk.DataTypeEnumPtr,
                    header, CommandTimeout) != NikonMaidSdk.ResultNoError)
                return null;

            var list = new List<string>();
            var offset = 0;
            while (offset < bytes)
            {
                var text = Marshal.PtrToStringAnsi(values + offset) ?? "";
                if (text.Length == 0) break;
                list.Add(text);
                offset += Encoding.Latin1.GetByteCount(text) + 1;
            }
            return (list, index);
        }
        finally
        {
            if (values != IntPtr.Zero) Marshal.FreeHGlobal(values);
            Marshal.FreeHGlobal(header);
        }
    }

    /// <summary>Reads an array capability — how the live view frame is delivered.</summary>
    private byte[]? ReadArray(uint capability, out int result)
    {
        var header = Marshal.AllocHGlobal(NikonMaidSdk.ArraySize);
        var values = IntPtr.Zero;
        result = NikonMaidSdk.ResultNoError;
        try
        {
            Zero(header, NikonMaidSdk.ArraySize);
            result = Command(_sourceObject, NikonMaidSdk.CommandCapGet, capability, NikonMaidSdk.DataTypeArrayPtr,
                header, CommandTimeout);
            if (result != NikonMaidSdk.ResultNoError) return null;

            var elements = Marshal.ReadInt32(header, NikonMaidSdk.ArrayElementsOffset);
            var physicalBytes = Marshal.ReadInt16(header, NikonMaidSdk.ArrayPhysicalBytesOffset);
            if (physicalBytes <= 0) physicalBytes = 1;
            var total = (long)elements * physicalBytes;
            if (elements <= 0 || total > NikonMaidSdk.MaxFileBytes) return null;

            values = Marshal.AllocHGlobal((int)total);
            Marshal.WriteIntPtr(header, NikonMaidSdk.ArrayDataOffset, values);
            result = Command(_sourceObject, NikonMaidSdk.CommandCapGetArray, capability,
                NikonMaidSdk.DataTypeArrayPtr, header, CommandTimeout);
            if (result != NikonMaidSdk.ResultNoError) return null;

            var buffer = new byte[total];
            Marshal.Copy(values, buffer, 0, (int)total);
            return buffer;
        }
        finally
        {
            if (values != IntPtr.Zero) Marshal.FreeHGlobal(values);
            Marshal.FreeHGlobal(header);
        }
    }

    private string? ReadString(IntPtr target, uint capability)
    {
        // NkMAIDString is a flat SCHAR[256].
        var buffer = Marshal.AllocHGlobal(256);
        try
        {
            Zero(buffer, 256);
            if (Command(target, NikonMaidSdk.CommandCapGet, capability, NikonMaidSdk.DataTypeStringPtr, buffer,
                    CommandTimeout) != NikonMaidSdk.ResultNoError)
                return null;
            return Marshal.PtrToStringAnsi(buffer)?.Trim();
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private int? TryReadBattery()
    {
        if (!Supports(_sourceCaps, NikonMaidSdk.CapBatteryLevel, NikonMaidSdk.CapOperationGet)) return null;

        var buffer = Marshal.AllocHGlobal(sizeof(int));
        try
        {
            Marshal.WriteInt32(buffer, 0);
            if (Command(_sourceObject, NikonMaidSdk.CommandCapGet, NikonMaidSdk.CapBatteryLevel,
                    NikonMaidSdk.DataTypeIntegerPtr, buffer, CommandTimeout) != NikonMaidSdk.ResultNoError)
                return null;
            var level = Marshal.ReadInt32(buffer);
            return level is >= 0 and <= 100 ? level : null;
        }
        catch
        {
            return null;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static IntPtr AllocObject(long refClient)
    {
        var buffer = Marshal.AllocHGlobal(NikonMaidSdk.ObjectSize);
        Zero(buffer, NikonMaidSdk.ObjectSize);
        // A tag, not a pointer: it comes back as refProc on the event callback and only
        // has to tell the four object kinds apart.
        Marshal.WriteIntPtr(buffer, NikonMaidSdk.ObjectRefClientOffset, (IntPtr)refClient);
        return buffer;
    }

    private static void Zero(IntPtr buffer, int length) =>
        Marshal.Copy(new byte[length], 0, buffer, length);

    private void CloseObjects()
    {
        if (_sourceObject != IntPtr.Zero)
        {
            try { Command(_sourceObject, NikonMaidSdk.CommandClose, 0, NikonMaidSdk.DataTypeNull, IntPtr.Zero, CommandTimeout); }
            catch (Exception ex) { Log($"closing the camera failed: {ex.Message}"); }
            Marshal.FreeHGlobal(_sourceObject);
            _sourceObject = IntPtr.Zero;
        }
        if (_moduleObject != IntPtr.Zero)
        {
            try { Command(_moduleObject, NikonMaidSdk.CommandClose, 0, NikonMaidSdk.DataTypeNull, IntPtr.Zero, CommandTimeout); }
            catch (Exception ex) { Log($"closing the module failed: {ex.Message}"); }
            Marshal.FreeHGlobal(_moduleObject);
            _moduleObject = IntPtr.Zero;
        }
    }

    // ── MAID callbacks (must never throw back into native code) ────────────────

    private void OnCompletion(IntPtr target, uint command, uint param, uint dataType, IntPtr data,
        IntPtr refComplete, int result)
    {
        _completionResult = result;
        _completed++;
    }

    private void OnEvent(IntPtr refClient, uint eventId, IntPtr data)
    {
        try
        {
            switch (eventId)
            {
                case NikonMaidSdk.EventAddChild:
                    // On the source object a new child is the item the shutter just made.
                    if ((long)refClient == 2)
                    {
                        lock (_newItems) _newItems.Add((uint)(long)data);
                    }
                    break;
                case NikonMaidSdk.EventRemoveChild:
                    if ((long)refClient == 2)
                    {
                        lock (_newItems) _newItems.Remove((uint)(long)data);
                    }
                    break;
            }
        }
        catch (Exception ex)
        {
            Log($"event 0x{eventId:X} handling failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Copies one delivery of the camera's file into the buffer. MAID hands a large
    /// image over in pieces, so this is called repeatedly for one photo.
    /// </summary>
    private int OnData(IntPtr refClient, IntPtr dataInfo, IntPtr data)
    {
        try
        {
            if (dataInfo == IntPtr.Zero || data == IntPtr.Zero) return NikonMaidSdk.ResultUnexpectedError;

            var objectType = (uint)Marshal.ReadInt32(dataInfo, NikonMaidSdk.DataInfoTypeOffset);
            if ((objectType & NikonMaidSdk.DataObjTypeFile) == 0)
            {
                // Raw pixel data rather than a file: the booth wants the camera's own JPEG.
                _acquireWasPixelData = true;
                return NikonMaidSdk.ResultNoError;
            }

            var total = Marshal.ReadInt32(dataInfo, NikonMaidSdk.FileInfoTotalLengthOffset);
            var length = Marshal.ReadInt32(dataInfo, NikonMaidSdk.FileInfoLengthOffset);
            _acquireFileType = (uint)Marshal.ReadInt32(dataInfo, NikonMaidSdk.FileInfoDataTypeOffset);

            if (total <= 0 || total > NikonMaidSdk.MaxFileBytes) return NikonMaidSdk.ResultUnexpectedError;
            if (length < 0 || length > total) return NikonMaidSdk.ResultUnexpectedError;

            _acquireBuffer ??= new byte[total];
            if (_acquireOffset + length > _acquireBuffer.Length) return NikonMaidSdk.ResultBufferSize;

            if (length > 0)
            {
                Marshal.Copy(data, _acquireBuffer, _acquireOffset, length);
                _acquireOffset += length;
            }
            return NikonMaidSdk.ResultNoError;
        }
        catch (Exception ex)
        {
            Log($"receiving the photo failed: {ex.Message}");
            return NikonMaidSdk.ResultUnexpectedError;
        }
    }

    /// <summary>No one is at the helper to answer, so every prompt gets its default.</summary>
    private uint OnUiRequest(IntPtr refProc, IntPtr request)
    {
        try
        {
            if (request == IntPtr.Zero) return 0;
            var prompt = Marshal.ReadIntPtr(request, NikonMaidSdk.UiRequestPromptOffset);
            if (prompt != IntPtr.Zero) Log($"camera prompt answered with default: {Marshal.PtrToStringAnsi(prompt)}");
            return (uint)Marshal.ReadInt32(request, NikonMaidSdk.UiRequestDefaultOffset);
        }
        catch
        {
            return 0;
        }
    }

    // Nikon reports apertures as "5.6"; the booth shows "f/5.6" for every brand.
    private static string ToDisplay(string key, string value) =>
        key == SettingKeys.Aperture && value.Length > 0 && char.IsDigit(value[0]) ? $"f/{value}" : value;

    private static string FromDisplay(string key, string value) =>
        key == SettingKeys.Aperture && value.StartsWith("f/", StringComparison.Ordinal) ? value[2..] : value;

    private static CameraException Map(int rc, string fallbackCode, string context) => rc switch
    {
        NikonMaidSdk.ResultOutOfFocus => new("FOCUS_FAILED", "The camera could not focus."),
        NikonMaidSdk.ResultCameraNotFound or NikonMaidSdk.ResultSessionFailure or NikonMaidSdk.ResultBusReset
            or NikonMaidSdk.ResultZombieObject
            => new("DISCONNECTED", "The Nikon camera was disconnected."),
        NikonMaidSdk.ResultMediaFull => new("CAPTURE_FAILED", "The camera's memory is full."),
        NikonMaidSdk.ResultNoMedia => new("CAPTURE_FAILED", "The camera has no memory card."),
        NikonMaidSdk.ResultBatteryDontWork or NikonMaidSdk.ResultBatteryExhausted
            => new("CAPTURE_FAILED", "The camera battery is too low."),
        NikonMaidSdk.ResultHighTemperature => new("CAPTURE_FAILED", "The camera is too hot to shoot."),
        NikonMaidSdk.ResultDeviceBusy => new("CAPTURE_FAILED", "The camera is busy."),
        NikonMaidSdk.ResultCaptureDisable => new("CAPTURE_FAILED",
            "The camera will not take a photo right now. Check that a lens is fitted and the mode dial is not locked."),
        NikonMaidSdk.ResultWaiting2ndRelease => new("CAPTURE_FAILED", "The camera is waiting for a second shutter press."),
        NikonMaidSdk.ResultClientTimeout => new("CAPTURE_FAILED", "The Nikon camera stopped answering."),
        _ => new(fallbackCode, $"{context} (NKERROR {rc})."),
    };

    private static void Log(string message)
    {
        Console.Error.WriteLine($"[canon-camera-helper] nikon-maid: {message}");
        Console.Error.Flush();
    }
}
