using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace CanonCameraHelper;

/// <summary>
/// Line-delimited JSON over stdin/stdout, one request per line:
///
///   → {"id":"7","cmd":"capture","args":{"directory":"C:\\...","fileName":"shot_00.jpg"}}
///   ← {"id":"7","ok":true,"result":{"path":"...","width":6000,...}}
///   ← {"id":"7","ok":false,"error":{"code":"FOCUS_FAILED","message":"..."}}
///
/// Unsolicited messages carry "event" instead of "id" (the first is always
/// {"event":"ready",...}). stdout carries protocol messages only; anything
/// human-readable goes to stderr, so a stray log line can never corrupt a reply.
/// </summary>
internal static class Program
{
    private const int ProtocolVersion = 1;
    private const int MaxLineLength = 64_000;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    // A file name the app chose, never a path: the helper writes only inside the
    // directory it is given, so a malformed request cannot write anywhere else.
    private static readonly Regex SafeFileName =
        new(@"^[A-Za-z0-9][A-Za-z0-9_\-]{0,79}\.jpe?g$", RegexOptions.CultureInvariant);

    private static TextWriter _protocol = Console.Out;

    [STAThread]
    private static int Main(string[] args)
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
        _protocol = IsolateProtocolOutput();

        ICameraBackend backend = args.Contains("--simulate")
            ? new SimulatedBackend()
            // NikonBackend (Remote SDK v2, Z series) is tried before NikonMaidBackend
            // (the per-model modules), so a Z body keeps the interface it was built for
            // and only a camera that backend turns down falls through to the older one.
            : new AutoBackend(new NikonBackend(), new NikonMaidBackend(), new SonyBackend(), new CanonBackend());

        Log($"starting with backend {backend.Name}");
        Emit(new JsonObject
        {
            ["event"] = "ready",
            ["backend"] = backend.Name,
            ["protocol"] = ProtocolVersion,
        });

        try
        {
            string? line;
            while ((line = Console.In.ReadLine()) != null)
            {
                if (line.Length == 0) continue;
                if (!Handle(backend, line)) break;
            }
        }
        finally
        {
            try { backend.Disconnect(); } catch (Exception ex) { Log($"disconnect on exit failed: {ex.Message}"); }
            backend.Dispose();
            Log("stopped");
        }

        return 0;
    }

    /// <returns>false when the helper should exit.</returns>
    private static bool Handle(ICameraBackend backend, string line)
    {
        string? id = null;

        try
        {
            if (line.Length > MaxLineLength)
                throw new CameraException("BAD_REQUEST", "Request is too large.");

            var request = JsonNode.Parse(line)?.AsObject()
                ?? throw new CameraException("BAD_REQUEST", "Request is not a JSON object.");

            id = request["id"]?.GetValue<string>();
            var cmd = request["cmd"]?.GetValue<string>()
                ?? throw new CameraException("BAD_REQUEST", "Missing cmd.");
            var args = request["args"] as JsonObject ?? new JsonObject();

            switch (cmd)
            {
                case "status":
                    Reply(id, backend.GetStatus());
                    return true;

                case "connect":
                    Reply(id, backend.Connect());
                    return true;

                case "disconnect":
                    backend.Disconnect();
                    Reply(id, backend.GetStatus());
                    return true;

                case "capture":
                    Reply(id, Capture(backend, args));
                    return true;

                case "getSettings":
                    Reply(id, backend.GetSettings());
                    return true;

                case "setSetting":
                {
                    var key = RequiredString(args, "key");
                    if (!SettingKeys.All.Contains(key))
                        throw new CameraException("UNKNOWN_SETTING", $"Unknown setting '{key}'.");
                    Reply(id, backend.SetSetting(key, RequiredString(args, "value")));
                    return true;
                }

                case "startLiveView":
                    backend.StartLiveView();
                    Reply(id, new { started = true });
                    return true;

                case "stopLiveView":
                    backend.StopLiveView();
                    Reply(id, new { stopped = true });
                    return true;

                case "liveViewFrame":
                {
                    var frame = backend.GetLiveViewFrame()
                        ?? throw new CameraException("NO_FRAME", "No new live view frame yet.");
                    Reply(id, new { jpeg = Convert.ToBase64String(frame.Jpeg), frameNo = frame.FrameNo });
                    return true;
                }

                case "shutdown":
                    Reply(id, new { stopping = true });
                    return false;

                default:
                    throw new CameraException("UNKNOWN_COMMAND", $"Unknown command '{cmd}'.");
            }
        }
        catch (CameraException ex)
        {
            Fail(id, ex.Code, ex.Message);
        }
        catch (JsonException ex)
        {
            Fail(id, "BAD_REQUEST", $"Malformed JSON: {ex.Message}");
        }
        catch (InvalidOperationException ex)
        {
            Fail(id, "BAD_REQUEST", ex.Message);
        }
        catch (Exception ex)
        {
            Log($"unexpected failure: {ex}");
            Fail(id, "INTERNAL", ex.Message);
        }

        return true;
    }

    private static CaptureResult Capture(ICameraBackend backend, JsonObject args)
    {
        var directory = RequiredString(args, "directory");
        var fileName = RequiredString(args, "fileName");

        if (!Path.IsPathFullyQualified(directory))
            throw new CameraException("BAD_REQUEST", "directory must be an absolute path.");
        if (!Directory.Exists(directory))
            throw new CameraException("BAD_REQUEST", "directory does not exist.");
        if (!SafeFileName.IsMatch(fileName))
            throw new CameraException("BAD_REQUEST", "fileName must be a plain .jpg name.");

        var timeoutMs = args["timeoutMs"]?.GetValue<int>() ?? 10_000;
        timeoutMs = Math.Clamp(timeoutMs, 1_000, 30_000);

        return backend.Capture(Path.Combine(directory, fileName), TimeSpan.FromMilliseconds(timeoutMs));
    }

    private static string RequiredString(JsonObject args, string name)
    {
        var value = args[name]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(value))
            throw new CameraException("BAD_REQUEST", $"Missing {name}.");
        return value;
    }

    private static void Reply(string? id, object result)
    {
        Emit(new JsonObject
        {
            ["id"] = id,
            ["ok"] = true,
            ["result"] = JsonSerializer.SerializeToNode(result, result.GetType(), JsonOptions),
        });
    }

    private static void Fail(string? id, string code, string message)
    {
        Emit(new JsonObject
        {
            ["id"] = id,
            ["ok"] = false,
            ["error"] = new JsonObject { ["code"] = code, ["message"] = message },
        });
    }

    private static void Emit(JsonNode message)
    {
        _protocol.Write(message.ToJsonString(JsonOptions));
        _protocol.Write('\n');
        _protocol.Flush();
    }

    /// <summary>
    /// Camera SDKs print their own diagnostics to stdout (Nikon's prints "InitializeSDK
    /// Execution duration: …"), which could land in the middle of a protocol line. The
    /// protocol keeps a private duplicate of the original stdout; the process's stdout —
    /// both the Win32 handle and the C runtime's descriptor 1 that native code writes
    /// through — is pointed at stderr for everyone else.
    /// </summary>
    private static TextWriter IsolateProtocolOutput()
    {
        try
        {
            var process = GetCurrentProcess();
            var stdout = GetStdHandle(StdOutputHandle);
            var stderr = GetStdHandle(StdErrorHandle);
            if (!DuplicateHandle(process, stdout, process, out var protocolHandle, 0, false, DuplicateSameAccess))
                return Console.Out;

            var stream = new FileStream(new SafeFileHandle(protocolHandle, ownsHandle: true), FileAccess.Write, bufferSize: 1);
            var writer = new StreamWriter(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

            SetStdHandle(StdOutputHandle, stderr);
            try { _dup2(2, 1); } catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException) { }
            Console.SetOut(Console.Error);

            return writer;
        }
        catch (Exception ex)
        {
            Log($"could not separate protocol output from native output: {ex.Message}");
            return Console.Out;
        }
    }

    private const int StdOutputHandle = -11;
    private const int StdErrorHandle = -12;
    private const uint DuplicateSameAccess = 0x2;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int stdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetStdHandle(int stdHandle, IntPtr handle);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr sourceHandle, IntPtr targetProcess,
        out IntPtr targetHandle, uint desiredAccess, bool inheritHandle, uint options);

    [DllImport("ucrtbase.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int _dup2(int sourceFd, int targetFd);

    private static void Log(string message)
    {
        Console.Error.WriteLine($"[canon-camera-helper] {message}");
        Console.Error.Flush();
    }
}
