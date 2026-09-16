using System.Runtime.InteropServices;

namespace CanonCameraHelper;

/// <summary>
/// Bindings for Nikon's MAID 3 interface — the per-model modules (TypeXXXX.md3) that
/// drive the D-series DSLRs and the mirrorless bodies older than the unified SDK.
///
/// This is a different interface from the one <see cref="NikonBackend"/> uses. Remote
/// SDK v2 is a single library with a small "simplified API"; MAID is one module per
/// camera family, all reached through one exported <c>MAIDEntryPoint</c> that drives a
/// tree of Module → Source → Item → Data objects with capability get/set/start calls.
/// Commands are asynchronous: they answer <see cref="ResultPending"/> and the real
/// result arrives at a completion callback while the client pumps
/// <see cref="CommandAsync"/>.
///
/// Constants and layouts are transcribed from the SDK's Maid3.h / Maid3d1.h, which are
/// licensed to the business and kept only under sdk/ (never committed). Maid3.h is
/// compiled under <c>#pragma pack(2)</c> on Windows, so pointers that follow an
/// odd-sized field sit at offsets .NET's default layout would not give — hence the
/// explicit offsets below. Where this interface overlaps Remote SDK v2 the numbers
/// match <see cref="NikonSdk"/> (NkMAIDEnum is 26 bytes in both, the UI request offsets
/// are 4 and 12, SaveMedia is 0x8305); that agreement is the cross-check that the
/// packing rules used here are right.
/// </summary>
internal static class NikonMaidSdk
{
    // eNkMAIDCommand
    public const uint CommandAsync = 0;
    public const uint CommandOpen = 1;
    public const uint CommandClose = 2;
    public const uint CommandGetCapCount = 3;
    public const uint CommandGetCapInfo = 4;
    public const uint CommandCapStart = 5;
    public const uint CommandCapSet = 6;
    public const uint CommandCapGet = 7;
    public const uint CommandCapGetArray = 9;
    public const uint CommandAbort = 12;
    public const uint CommandEnumChildren = 13;

    // eNkMAIDDataType
    public const uint DataTypeNull = 0;
    public const uint DataTypeUnsigned = 3;
    public const uint DataTypeIntegerPtr = 5;
    public const uint DataTypeUnsignedPtr = 6;
    public const uint DataTypeStringPtr = 11;
    public const uint DataTypeCallbackPtr = 13;
    public const uint DataTypeArrayPtr = 15;
    public const uint DataTypeEnumPtr = 16;
    public const uint DataTypeObjectPtr = 17;
    public const uint DataTypeCapInfoPtr = 18;

    // eNkMAIDCapType
    public const uint CapTypeUnsigned = 3;
    public const uint CapTypeInteger = 2;
    public const uint CapTypeString = 8;
    public const uint CapTypeArray = 11;
    public const uint CapTypeEnum = 12;

    // eNkMAIDCapOperations
    public const uint CapOperationStart = 0x0001;
    public const uint CapOperationGet = 0x0002;
    public const uint CapOperationSet = 0x0004;
    public const uint CapOperationGetArray = 0x0008;

    // eNkMAIDObjectType
    public const uint ObjectTypeModule = 1;
    public const uint ObjectTypeSource = 2;
    public const uint ObjectTypeItem = 3;
    public const uint ObjectTypeDataObj = 4;

    // eNkMAIDArrayType
    public const uint ArrayTypePackedString = 7;

    // eNkMAIDDataObjType
    public const uint DataObjTypeImage = 0x01;
    public const uint DataObjTypeThumbnail = 0x08;
    public const uint DataObjTypeFile = 0x10;

    // eNkMAIDFileDataTypes
    public const uint FileDataTypeJpeg = 1;

    // eNkMAIDResult
    public const int ResultNotSupported = -127;
    public const int ResultValueOutOfBounds = -125;
    public const int ResultBufferSize = -124;
    public const int ResultNoMedia = -122;
    public const int ResultZombieObject = -119;
    public const int ResultOutOfMemory = -118;
    public const int ResultUnexpectedError = -117;
    public const int ResultHardwareError = -116;
    public const int ResultNoError = 0;
    public const int ResultPending = 1;

    /// <summary>Not Nikon's: the client gave up waiting for a completion callback.</summary>
    public const int ResultClientTimeout = -1000;

    // eNkMAIDResultD1 (vendor results, all positive)
    public const int ResultMediaFull = 131;
    public const int ResultCameraNotFound = 134;
    public const int ResultBatteryDontWork = 135;
    public const int ResultOutOfFocus = 137;
    public const int ResultSessionFailure = 142;
    public const int ResultFileRemoved = 143;
    public const int ResultBusReset = 144;
    public const int ResultBatteryExhausted = 147;
    public const int ResultCaptureFailure = 148;
    public const int ResultNotInitialized = 150;
    public const int ResultCaptureDisable = 151;
    public const int ResultDeviceBusy = 152;
    public const int ResultNotLiveView = 159;
    public const int ResultBulbReleaseBusy = 164;
    public const int ResultSilentReleaseBusy = 165;
    public const int ResultMovieFrameReleaseBusy = 166;
    public const int ResultWaiting2ndRelease = 168;
    public const int ResultHighTemperature = 170;

    // eNkMAIDEvent (module/source events)
    public const uint EventAddChild = 0;
    public const uint EventRemoveChild = 1;
    public const uint EventCapChange = 4;
    public const uint EventCapChangeValueOnly = 6;
    // eNkMAIDEventDX2: DX2Origin = kNkMAIDEvent_CapChangeValueOnly + 0x100 = 0x106.
    public const uint EventCaptureComplete = 0x108;
    public const uint EventCapChangeOperationOnly = 0x10B;

    // eNkMAIDCapability — ordinals of the base enum in Maid3.h, which starts at
    // kNkMAIDCapability_AsyncRate = 1.
    public const uint CapProgressProc = 2;
    public const uint CapEventProc = 3;
    public const uint CapDataProc = 4;
    public const uint CapUiRequestProc = 5;
    public const uint CapIsAlive = 6;
    public const uint CapChildren = 7;
    public const uint CapName = 9;
    public const uint CapDataTypes = 12;
    public const uint CapCapture = 17;
    public const uint CapAcquire = 20;
    public const uint CapAutoFocus = 30;
    public const uint CapBatteryLevel = 49;

    // eNkMAIDCapabilityD1, based at kNkMAIDCapability_VendorBase + 0x100 = 0x8100.
    public const uint CapModuleMode = 0x8101;
    public const uint CapCompressionLevel = 0x8110;
    public const uint CapShutterSpeed = 0x8112;
    public const uint CapAperture = 0x8113;
    public const uint CapSensitivity = 0x8117;
    public const uint CapWbMode = 0x8118;
    public const uint CapAfCapture = 0x8225;
    public const uint CapLiveViewStatus = 0x823E;
    public const uint CapGetLiveViewImage = 0x8247;
    public const uint CapSaveMedia = 0x8305;

    // eNkMAIDModuleMode
    public const uint ModuleModeController = 1;

    // eNkMAIDSaveMedia
    public const uint SaveMediaCard = 0;
    public const uint SaveMediaSdram = 1;

    // ── structure layouts under pack(2) on x64 ────────────────────────────────
    // NKREF and LPVOID are 8 bytes here; ULONG, SLONG and Windows BOOL are 4.

    // NkMAIDObject: ULONG@0, ULONG@4, NKREF@8, NKREF@16.
    public const int ObjectSize = 24;
    public const int ObjectTypeOffset = 0;
    public const int ObjectIdOffset = 4;
    public const int ObjectRefClientOffset = 8;

    // NkMAIDCapInfo: ULONG×4 @0..12, SCHAR[256]@16.
    public const int CapInfoSize = 272;
    public const int CapInfoIdOffset = 0;
    public const int CapInfoTypeOffset = 4;
    public const int CapInfoOperationsOffset = 12;

    // NkMAIDCallback: LPNKFUNC@0, NKREF@8.
    public const int CallbackSize = 16;
    public const int CallbackProcOffset = 0;
    public const int CallbackRefOffset = 8;

    // NkMAIDEnum: ULONG×4 @0..12, SWORD@16, LPVOID@18. Same 26 bytes as NikonSdk.
    public const int EnumSize = 26;
    public const int EnumTypeOffset = 0;
    public const int EnumElementsOffset = 4;
    public const int EnumValueOffset = 8;
    public const int EnumPhysicalBytesOffset = 16;
    public const int EnumDataOffset = 18;

    // NkMAIDArray: ULONG×5 @0..16, UWORD@20, UWORD@22, LPVOID@24.
    public const int ArraySize = 32;
    public const int ArrayElementsOffset = 4;
    public const int ArrayPhysicalBytesOffset = 20;
    public const int ArrayDataOffset = 24;

    // NkMAIDUIRequestInfo: ULONG@0, ULONG@4, BOOL@8, SCHAR*@12, SCHAR*@20, ...
    public const int UiRequestDefaultOffset = 4;
    public const int UiRequestPromptOffset = 12;

    // NkMAIDFileInfo: NkMAIDDataInfo@0, then ULONG/BOOL fields every 4 bytes.
    public const int DataInfoTypeOffset = 0;
    public const int FileInfoDataTypeOffset = 4;
    public const int FileInfoTotalLengthOffset = 8;
    public const int FileInfoLengthOffset = 16;
    public const int FileInfoRemoveObjectOffset = 24;

    /// <summary>A camera will not send the booth a file larger than this.</summary>
    public const int MaxFileBytes = 128 * 1024 * 1024;

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate int MaidEntryPointFn(IntPtr pObject, uint command, uint param, uint dataType,
        IntPtr data, IntPtr completionProc, IntPtr refComplete);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate void CompletionProc(IntPtr pObject, uint command, uint param, uint dataType,
        IntPtr data, IntPtr refComplete, int result);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate void EventProc(IntPtr refClient, uint eventId, IntPtr data);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate int DataProc(IntPtr refClient, IntPtr dataInfo, IntPtr data);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate void ProgressProc(uint command, uint param, IntPtr refProc, uint done, uint total);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate uint UiRequestProc(IntPtr refProc, IntPtr request);
}

/// <summary>One TypeXXXX.md3 loaded from disk, with its MAIDEntryPoint bound.</summary>
internal sealed class NikonMaidModule : IDisposable
{
    private const uint LoadWithAlteredSearchPath = 0x00000008;

    /// <summary>The module's file name without extension, e.g. "Type0015".</summary>
    public string TypeName { get; }

    public NikonMaidSdk.MaidEntryPointFn EntryPoint { get; }

    private IntPtr _library;

    private NikonMaidModule(string typeName, IntPtr library, NikonMaidSdk.MaidEntryPointFn entryPoint)
    {
        TypeName = typeName;
        _library = library;
        EntryPoint = entryPoint;
    }

    /// <summary>
    /// Loads one module, or returns null when it cannot be used. Probing walks every
    /// module in the folder, so a module that will not load must not be fatal.
    ///
    /// LOAD_WITH_ALTERED_SEARCH_PATH makes Windows resolve the module's own imports
    /// (NkdPTP.dll, dnssd.dll, NkRoyalmile.dll) from the folder the module sits in,
    /// rather than from the process directory — which is why the modules are shipped
    /// beside those DLLs instead of in a subfolder of their own.
    /// </summary>
    public static NikonMaidModule? TryLoad(string path)
    {
        var library = LoadLibraryExW(path, IntPtr.Zero, LoadWithAlteredSearchPath);
        if (library == IntPtr.Zero) return null;

        try
        {
            var export = NativeLibrary.GetExport(library, "MAIDEntryPoint");
            return new NikonMaidModule(
                Path.GetFileNameWithoutExtension(path),
                library,
                Marshal.GetDelegateForFunctionPointer<NikonMaidSdk.MaidEntryPointFn>(export));
        }
        catch (Exception)
        {
            FreeLibrary(library);
            return null;
        }
    }

    public void Dispose()
    {
        if (_library == IntPtr.Zero) return;
        var library = _library;
        _library = IntPtr.Zero;
        try { FreeLibrary(library); } catch { /* shutting down */ }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibraryExW(string fileName, IntPtr reserved, uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeLibrary(IntPtr library);
}
