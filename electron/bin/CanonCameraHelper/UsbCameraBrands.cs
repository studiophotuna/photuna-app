using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace CanonCameraHelper;

/// <summary>
/// Which camera brands are plugged in by USB right now, read from the USB vendor IDs
/// of present devices.
///
/// Asking each brand's SDK to look for cameras is slow, and an SDK probing a camera
/// of another brand can stall (Nikon's and Sony's USB layers enumerate every
/// still-image device). Only the SDKs of brands actually connected are tried.
/// </summary>
internal static class UsbCameraBrands
{
    private static readonly Dictionary<string, string> VendorBrands = new(StringComparer.OrdinalIgnoreCase)
    {
        ["04A9"] = "canon",
        ["04B0"] = "nikon",
        ["054C"] = "sony",
    };

    private static readonly Regex VendorId = new(@"VID_([0-9A-F]{4})", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly Regex NikonVendorProduct =
        new(@"VID_04B0&PID_([0-9A-F]{4})", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private const uint FilterEnumerator = 0x00000001; // CM_GETIDLIST_FILTER_ENUMERATOR
    private const uint FilterPresent = 0x00000100;    // CM_GETIDLIST_FILTER_PRESENT
    private const uint CrSuccess = 0;

    /// <summary>
    /// Brand names ("canon", "nikon", "sony") with a device present on USB, or null
    /// when Windows could not be asked — callers then try every brand.
    /// </summary>
    public static HashSet<string>? Detect()
    {
        try
        {
            const uint flags = FilterEnumerator | FilterPresent;
            if (CM_Get_Device_ID_List_SizeW(out var length, "USB", flags) != CrSuccess || length == 0)
                return null;

            var buffer = new char[length];
            if (CM_Get_Device_ID_ListW("USB", buffer, length, flags) != CrSuccess)
                return null;

            var brands = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var id in new string(buffer).Split('\0', StringSplitOptions.RemoveEmptyEntries))
            {
                var match = VendorId.Match(id);
                if (match.Success && VendorBrands.TryGetValue(match.Groups[1].Value, out var brand))
                    brands.Add(brand);
            }
            return brands;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// The USB product IDs of the Nikon cameras attached right now, upper-case hex
    /// ("0436"), or an empty set when Windows could not be asked.
    ///
    /// Used only to decide which per-model MAID module to try first: which module fits
    /// a camera is settled by asking the module, never by this list.
    /// </summary>
    public static HashSet<string> NikonProductIds()
    {
        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var id in DeviceIds())
        {
            var match = NikonVendorProduct.Match(id);
            if (match.Success) ids.Add(match.Groups[1].Value.ToUpperInvariant());
        }
        return ids;
    }

    /// <summary>Every present USB device id, or nothing when Windows could not be asked.</summary>
    private static string[] DeviceIds()
    {
        try
        {
            const uint flags = FilterEnumerator | FilterPresent;
            if (CM_Get_Device_ID_List_SizeW(out var length, "USB", flags) != CrSuccess || length == 0)
                return Array.Empty<string>();

            var buffer = new char[length];
            if (CM_Get_Device_ID_ListW("USB", buffer, length, flags) != CrSuccess)
                return Array.Empty<string>();

            return new string(buffer).Split('\0', StringSplitOptions.RemoveEmptyEntries);
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    private static extern uint CM_Get_Device_ID_List_SizeW(out uint length, string filter, uint flags);

    [DllImport("cfgmgr32.dll", CharSet = CharSet.Unicode)]
    private static extern uint CM_Get_Device_ID_ListW(string filter, [Out] char[] buffer, uint bufferLength, uint flags);
}
