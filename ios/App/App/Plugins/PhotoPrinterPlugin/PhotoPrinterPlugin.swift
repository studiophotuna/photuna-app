import Foundation
import Capacitor

/// Capacitor plugin bridge for photo printer communication.
///
/// Exposes three JS-callable commands:
///   - discoverPrinters   → [{id, name, model, brand, status, mediaRemaining}]
///   - printPhoto         → {ok, jobId?, error?}
///   - getPrinterStatus   → {status, mediaRemaining, error?}
///
/// Drop the DNP DS Mobile Print SDK (.xcframework) into the Xcode project,
/// set DNPSDK_AVAILABLE=1 in the target's Build Settings → Preprocessor Macros,
/// and the real SDK calls activate automatically. Until then the plugin runs
/// in simulation mode so the rest of the app can compile and run.

@objc(PhotoPrinterPlugin)
public class PhotoPrinterPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier   = "PhotoPrinterPlugin"
    public let jsName       = "PhotoPrinter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "discoverPrinters",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printPhoto",        returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPrinterStatus",  returnType: CAPPluginReturnPromise),
    ]

    private let dnp  = DNPPrinterManager()
    private let hiti = HiTiPrinterManager()

    // ── discoverPrinters ──────────────────────────────────────────────────────

    @objc func discoverPrinters(_ call: CAPPluginCall) {
        Task {
            var results: [[String: Any]] = []

            let dnpList  = await dnp.discover()
            let hitiList = await hiti.discover()

            results.append(contentsOf: dnpList)
            results.append(contentsOf: hitiList)

            call.resolve(["printers": results])
        }
    }

    // ── printPhoto ────────────────────────────────────────────────────────────

    @objc func printPhoto(_ call: CAPPluginCall) {
        guard let imageBase64 = call.getString("imageBase64") else {
            call.reject("imageBase64 is required")
            return
        }

        guard let imageData = Data(base64Encoded: imageBase64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: imageData) else {
            call.reject("Failed to decode imageBase64 into a UIImage")
            return
        }

        let printerId  = call.getString("printerId")
        let copies     = call.getInt("copies") ?? 1
        let mediaType  = call.getString("mediaType") ?? "4x6"  // "4x6" | "2x6"
        let brand      = call.getString("brand") ?? "dnp"       // "dnp" | "hiti"

        Task {
            let result: [String: Any]

            switch brand.lowercased() {
            case "hiti":
                result = await hiti.print(
                    image: image,
                    printerId: printerId,
                    copies: copies,
                    mediaType: mediaType
                )
            default:
                result = await dnp.print(
                    image: image,
                    printerId: printerId,
                    copies: copies,
                    mediaType: mediaType
                )
            }

            if let error = result["error"] as? String {
                call.reject(error)
            } else {
                call.resolve(result)
            }
        }
    }

    // ── getPrinterStatus ──────────────────────────────────────────────────────

    @objc func getPrinterStatus(_ call: CAPPluginCall) {
        let printerId = call.getString("printerId")
        let brand     = call.getString("brand") ?? "dnp"

        Task {
            let result: [String: Any]

            switch brand.lowercased() {
            case "hiti":
                result = await hiti.status(printerId: printerId)
            default:
                result = await dnp.status(printerId: printerId)
            }

            call.resolve(result)
        }
    }
}
