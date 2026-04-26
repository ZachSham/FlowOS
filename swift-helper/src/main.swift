import Cocoa
import ApplicationServices
import Foundation

struct WindowOp: Codable {
  let appName: String
  let x: Double
  let y: Double
  let width: Double
  let height: Double
  let focus: Bool?
}

struct HelperRequest: Codable {
  let action: String
  let operations: [WindowOp]
  let focusApp: String?
}

struct HelperResult: Codable {
  let ok: Bool
  let moved: Int
  let focused: Bool
  let error: String?
}

func readStdin() -> Data {
  return FileHandle.standardInput.readDataToEndOfFile()
}

func writeStdout(_ text: String) {
  if let data = text.data(using: .utf8) {
    FileHandle.standardOutput.write(data)
  }
}

func bestMatchingApp(named target: String) -> NSRunningApplication? {
  let apps = NSWorkspace.shared.runningApplications
  let normalizedTarget = target.lowercased()

  if let exact = apps.first(where: { ($0.localizedName ?? "").lowercased() == normalizedTarget }) {
    return exact
  }

  return apps.first(where: { ($0.localizedName ?? "").lowercased().contains(normalizedTarget) })
}

func firstWindowElement(for app: NSRunningApplication) -> AXUIElement? {
  let appElement = AXUIElementCreateApplication(app.processIdentifier)
  var value: CFTypeRef?
  let result = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &value)

  guard result == .success,
        let windows = value as? [AXUIElement],
        let first = windows.first else {
    return nil
  }

  return first
}

func setWindowBounds(_ window: AXUIElement, x: Double, y: Double, width: Double, height: Double) -> Bool {
  var point = CGPoint(x: x, y: y)
  var size = CGSize(width: width, height: height)

  guard let posValue = AXValueCreate(.cgPoint, &point),
        let sizeValue = AXValueCreate(.cgSize, &size) else {
    return false
  }

  let posResult = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, posValue)
  let sizeResult = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue)

  return posResult == .success && sizeResult == .success
}

func focusApp(_ app: NSRunningApplication) {
  if #available(macOS 14.0, *) {
    app.activate()
  } else {
    app.activate(options: [.activateIgnoringOtherApps])
  }
}

func requestAccessibilityPrompt() {
  let options: NSDictionary = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
  _ = AXIsProcessTrustedWithOptions(options)
}

func processRequest(_ request: HelperRequest) -> HelperResult {
  requestAccessibilityPrompt()

  guard AXIsProcessTrusted() else {
    return HelperResult(ok: false, moved: 0, focused: false, error: "Accessibility permission not granted")
  }

  var movedCount = 0
  var focused = false

  for op in request.operations {
    guard let app = bestMatchingApp(named: op.appName),
          let window = firstWindowElement(for: app) else {
      continue
    }

    if setWindowBounds(window, x: op.x, y: op.y, width: op.width, height: op.height) {
      movedCount += 1
      if op.focus == true {
        focusApp(app)
        focused = true
      }
    }
  }

  if let focusAppName = request.focusApp,
     let app = bestMatchingApp(named: focusAppName) {
    focusApp(app)
    focused = true
  }

  return HelperResult(ok: movedCount > 0, moved: movedCount, focused: focused, error: movedCount > 0 ? nil : "No matching windows moved")
}

let inputData = readStdin()
if inputData.isEmpty {
  writeStdout("{\"ok\":false,\"moved\":0,\"focused\":false,\"error\":\"Empty input\"}\n")
  exit(1)
}

do {
  let decoder = JSONDecoder()
  let request = try decoder.decode(HelperRequest.self, from: inputData)
  let result = processRequest(request)
  let encoder = JSONEncoder()
  let output = try encoder.encode(result)
  if let text = String(data: output, encoding: .utf8) {
    writeStdout(text + "\n")
  } else {
    writeStdout("{\"ok\":false,\"moved\":0,\"focused\":false,\"error\":\"Failed to encode output\"}\n")
    exit(1)
  }
} catch {
  let escaped = error.localizedDescription.replacingOccurrences(of: "\"", with: "\\\"")
  writeStdout("{\"ok\":false,\"moved\":0,\"focused\":false,\"error\":\"\(escaped)\"}\n")
  exit(1)
}
