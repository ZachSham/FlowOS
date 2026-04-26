import AppKit
import ApplicationServices
import Foundation

let helperSocketPath = "/tmp/flowos-helper.sock"

struct HelperStatus: Codable {
    let message: String
    let socketPath: String
    let accessibilityReady: Bool
}

struct NativeWindowPosition: Codable {
    let x: Double
    let y: Double
}

struct NativeWindowSize: Codable {
    let width: Double
    let height: Double
}

struct NativeWindowFrame: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct NativeAction: Decodable {
    let type: String
    let windowId: String?
    let bundleId: String?
    let frame: NativeWindowFrame?
    let position: NativeWindowPosition?
    let size: NativeWindowSize?
}

struct WindowSnapshot: Codable {
    let windowId: String
    let pid: Int32
    let index: Int
    let appName: String
    let bundleId: String?
    let title: String?
    let frame: NativeWindowFrame?
}

struct ScreenSnapshot: Codable {
    let id: Int
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct ActionResult: Codable {
    let ok: Bool
    let actionType: String?
    let message: String
    let window: WindowSnapshot?
}

struct ErrorResult: Codable {
    let ok: Bool
    let message: String
}

enum HelperError: Error, CustomStringConvertible {
    case invalidArguments(String)
    case invalidAction(String)
    case accessibilityNotTrusted
    case appNotFound(String)
    case windowNotFound(String)
    case axFailure(String, AXError)
    case encodingFailed

    var description: String {
        switch self {
        case .invalidArguments(let message):
            return message
        case .invalidAction(let message):
            return message
        case .accessibilityNotTrusted:
            return "Accessibility permission is not granted for FlowStateHelper."
        case .appNotFound(let bundleId):
            return "No running app found for bundleId \(bundleId)."
        case .windowNotFound(let windowId):
            return "No window found for windowId \(windowId). Run list-windows to get current IDs."
        case .axFailure(let operation, let error):
            return "\(operation) failed with AXError \(error.rawValue)."
        case .encodingFailed:
            return "Failed to encode helper output."
        }
    }
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

func writeJSON<T: Encodable>(_ value: T) throws {
    guard let data = try? encoder.encode(value), let output = String(data: data, encoding: .utf8) else {
        throw HelperError.encodingFailed
    }

    print(output)
}

func accessibilityStatus(prompt: Bool = false) -> Bool {
    if prompt {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    return AXIsProcessTrusted()
}

func requireAccessibility() throws {
    guard accessibilityStatus() else {
        throw HelperError.accessibilityNotTrusted
    }
}

func copyAttribute(_ element: AXUIElement, _ attribute: String) throws -> AnyObject? {
    var value: AnyObject?
    let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

    if error == .attributeUnsupported || error == .noValue {
        return nil
    }

    guard error == .success else {
        throw HelperError.axFailure("Read \(attribute)", error)
    }

    return value
}

func copyStringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
    return try? copyAttribute(element, attribute) as? String
}

func copyIntAttribute(_ element: AXUIElement, _ attribute: String) -> Int? {
    guard let value = try? copyAttribute(element, attribute) else {
        return nil
    }

    if let number = value as? NSNumber {
        return number.intValue
    }

    return nil
}

func copyCGPointAttribute(_ element: AXUIElement, _ attribute: String) -> CGPoint? {
    guard let value = try? copyAttribute(element, attribute) else {
        return nil
    }

    guard CFGetTypeID(value) == AXValueGetTypeID() else {
        return nil
    }

    let axValue = value as! AXValue
    var point = CGPoint.zero
    if AXValueGetType(axValue) == .cgPoint,
       AXValueGetValue(axValue, .cgPoint, &point) {
        return point
    }

    return nil
}

func copyCGSizeAttribute(_ element: AXUIElement, _ attribute: String) -> CGSize? {
    guard let value = try? copyAttribute(element, attribute) else {
        return nil
    }

    guard CFGetTypeID(value) == AXValueGetTypeID() else {
        return nil
    }

    let axValue = value as! AXValue
    var size = CGSize.zero
    if AXValueGetType(axValue) == .cgSize,
       AXValueGetValue(axValue, .cgSize, &size) {
        return size
    }

    return nil
}

func copyWindows(for app: NSRunningApplication) throws -> [AXUIElement] {
    let appElement = AXUIElementCreateApplication(app.processIdentifier)
    guard let windows = try copyAttribute(appElement, kAXWindowsAttribute) as? [AXUIElement] else {
        return []
    }

    return windows
}

func frame(for window: AXUIElement) -> NativeWindowFrame? {
    guard let position = copyCGPointAttribute(window, kAXPositionAttribute),
          let size = copyCGSizeAttribute(window, kAXSizeAttribute) else {
        return nil
    }

    return NativeWindowFrame(
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height
    )
}

func windowId(pid: pid_t, index: Int, window: AXUIElement) -> String {
    if let windowNumber = copyIntAttribute(window, "AXWindowNumber") {
        return "pid:\(pid):window:\(windowNumber)"
    }

    return "pid:\(pid):index:\(index)"
}

func snapshot(app: NSRunningApplication, index: Int, window: AXUIElement) -> WindowSnapshot {
    return WindowSnapshot(
        windowId: windowId(pid: app.processIdentifier, index: index, window: window),
        pid: app.processIdentifier,
        index: index,
        appName: app.localizedName ?? "Unknown",
        bundleId: app.bundleIdentifier,
        title: copyStringAttribute(window, kAXTitleAttribute),
        frame: frame(for: window)
    )
}

func listWindows() throws -> [WindowSnapshot] {
    try requireAccessibility()

    return NSWorkspace.shared.runningApplications
        .filter { !$0.isTerminated && $0.activationPolicy == .regular }
        .flatMap { app -> [WindowSnapshot] in
            guard let windows = try? copyWindows(for: app) else {
                return []
            }

            return windows.enumerated().map { index, window in
                snapshot(app: app, index: index, window: window)
            }
        }
}

func parseWindowId(_ rawValue: String) -> (pid: pid_t, selector: String, value: Int)? {
    let parts = rawValue.split(separator: ":").map(String.init)
    guard parts.count == 4,
          parts[0] == "pid",
          let pid = Int32(parts[1]),
          let value = Int(parts[3]),
          parts[2] == "index" || parts[2] == "window" else {
        return nil
    }

    return (pid, parts[2], value)
}

func runningApplication(pid: pid_t) -> NSRunningApplication? {
    return NSRunningApplication(processIdentifier: pid)
}

func findWindow(windowId rawWindowId: String) throws -> (app: NSRunningApplication, index: Int, window: AXUIElement) {
    try requireAccessibility()

    guard let parsed = parseWindowId(rawWindowId),
          let app = runningApplication(pid: parsed.pid) else {
        throw HelperError.windowNotFound(rawWindowId)
    }

    let windows = try copyWindows(for: app)

    if parsed.selector == "index" {
        guard windows.indices.contains(parsed.value) else {
            throw HelperError.windowNotFound(rawWindowId)
        }

        return (app, parsed.value, windows[parsed.value])
    }

    for (index, window) in windows.enumerated() {
        if copyIntAttribute(window, "AXWindowNumber") == parsed.value {
            return (app, index, window)
        }
    }

    throw HelperError.windowNotFound(rawWindowId)
}

func visibleScreens() -> [CGRect] {
    return NSScreen.screens.map { screen in
        let displayId = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? CGMainDisplayID()
        let displayBounds = CGDisplayBounds(displayId)
        let visibleFrame = screen.visibleFrame
        let topLeftY = displayBounds.maxY - visibleFrame.maxY

        return CGRect(
            x: visibleFrame.minX,
            y: topLeftY,
            width: visibleFrame.width,
            height: visibleFrame.height
        )
    }
}

func listScreens() -> [ScreenSnapshot] {
    return visibleScreens().enumerated().map { index, frame in
        ScreenSnapshot(
            id: index,
            x: frame.minX,
            y: frame.minY,
            width: frame.width,
            height: frame.height
        )
    }
}

func containingScreen(for frame: NativeWindowFrame) -> CGRect {
    let screens = visibleScreens()
    let center = CGPoint(x: frame.x + frame.width / 2, y: frame.y + frame.height / 2)

    return screens.first { screen in
        screen.contains(center)
    } ?? screens.first ?? CGRect(x: 0, y: 25, width: 1440, height: 875)
}

func clamp(_ value: Double, min minValue: Double, max maxValue: Double) -> Double {
    return Swift.max(minValue, Swift.min(value, maxValue))
}

func clampedFrame(_ frame: NativeWindowFrame) -> NativeWindowFrame {
    let screen = containingScreen(for: frame)
    let width = clamp(frame.width, min: 1, max: screen.width)
    let height = clamp(frame.height, min: 1, max: screen.height)
    let x = clamp(frame.x, min: screen.minX, max: screen.maxX - width)
    let y = clamp(frame.y, min: screen.minY, max: screen.maxY - height)

    return NativeWindowFrame(x: x, y: y, width: width, height: height)
}

func setPosition(_ position: NativeWindowPosition, for window: AXUIElement) throws {
    var point = CGPoint(x: position.x, y: position.y)
    guard let value = AXValueCreate(.cgPoint, &point) else {
        throw HelperError.invalidAction("Could not create AX position value.")
    }

    let error = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, value)
    guard error == .success else {
        throw HelperError.axFailure("Set window position", error)
    }
}

func setSize(_ size: NativeWindowSize, for window: AXUIElement) throws {
    guard size.width > 0, size.height > 0 else {
        throw HelperError.invalidAction("Window width and height must be positive.")
    }

    var cgSize = CGSize(width: size.width, height: size.height)
    guard let value = AXValueCreate(.cgSize, &cgSize) else {
        throw HelperError.invalidAction("Could not create AX size value.")
    }

    let error = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, value)
    guard error == .success else {
        throw HelperError.axFailure("Set window size", error)
    }
}

func applyFrame(_ nextFrame: NativeWindowFrame, to window: AXUIElement) throws {
    let boundedFrame = clampedFrame(nextFrame)

    try setSize(NativeWindowSize(width: boundedFrame.width, height: boundedFrame.height), for: window)
    try setPosition(NativeWindowPosition(x: boundedFrame.x, y: boundedFrame.y), for: window)
}

func raiseWindow(_ window: AXUIElement, app: NSRunningApplication) throws {
    app.activate(options: [.activateAllWindows])
    let error = AXUIElementPerformAction(window, kAXRaiseAction as CFString)

    guard error == .success || error == .actionUnsupported else {
        throw HelperError.axFailure("Raise window", error)
    }
}

func minimizeWindow(_ window: AXUIElement) throws {
    let error = AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanTrue)
    guard error == .success else {
        throw HelperError.axFailure("Minimize window", error)
    }
}

func activateApp(bundleId: String) throws {
    guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == bundleId && !$0.isTerminated }) else {
        throw HelperError.appNotFound(bundleId)
    }

    app.activate(options: [.activateAllWindows])
}

func runAction(_ action: NativeAction) throws -> ActionResult {
    switch action.type {
    case "native.window.setFrame":
        guard let windowId = action.windowId, let frame = action.frame else {
            throw HelperError.invalidAction("setFrame requires windowId and frame.")
        }

        let target = try findWindow(windowId: windowId)
        try applyFrame(frame, to: target.window)

        return ActionResult(
            ok: true,
            actionType: action.type,
            message: "Window frame updated.",
            window: snapshot(app: target.app, index: target.index, window: target.window)
        )

    case "native.window.move":
        guard let windowId = action.windowId, let position = action.position else {
            throw HelperError.invalidAction("move requires windowId and position.")
        }
        let target = try findWindow(windowId: windowId)
        let currentFrame = frame(for: target.window) ?? NativeWindowFrame(x: position.x, y: position.y, width: 1, height: 1)
        let nextFrame = NativeWindowFrame(x: position.x, y: position.y, width: currentFrame.width, height: currentFrame.height)
        try applyFrame(nextFrame, to: target.window)

        return ActionResult(
            ok: true,
            actionType: action.type,
            message: "Window moved.",
            window: snapshot(app: target.app, index: target.index, window: target.window)
        )

    case "native.window.resize":
        guard let windowId = action.windowId, let size = action.size else {
            throw HelperError.invalidAction("resize requires windowId and size.")
        }
        let target = try findWindow(windowId: windowId)
        let currentFrame = frame(for: target.window) ?? NativeWindowFrame(x: 0, y: 25, width: size.width, height: size.height)
        let nextFrame = NativeWindowFrame(x: currentFrame.x, y: currentFrame.y, width: size.width, height: size.height)
        try applyFrame(nextFrame, to: target.window)

        return ActionResult(
            ok: true,
            actionType: action.type,
            message: "Window resized.",
            window: snapshot(app: target.app, index: target.index, window: target.window)
        )

    case "native.window.raise":
        guard let windowId = action.windowId else {
            throw HelperError.invalidAction("raise requires windowId.")
        }
        let target = try findWindow(windowId: windowId)
        try raiseWindow(target.window, app: target.app)

        return ActionResult(
            ok: true,
            actionType: action.type,
            message: "Window raised.",
            window: snapshot(app: target.app, index: target.index, window: target.window)
        )

    case "native.window.minimize":
        guard let windowId = action.windowId else {
            throw HelperError.invalidAction("minimize requires windowId.")
        }
        let target = try findWindow(windowId: windowId)
        try minimizeWindow(target.window)

        return ActionResult(
            ok: true,
            actionType: action.type,
            message: "Window minimized.",
            window: snapshot(app: target.app, index: target.index, window: target.window)
        )

    case "native.app.activate":
        guard let bundleId = action.bundleId else {
            throw HelperError.invalidAction("activate requires bundleId.")
        }
        try activateApp(bundleId: bundleId)

        return ActionResult(
            ok: true,
            actionType: action.type,
            message: "App activated.",
            window: nil
        )

    default:
        throw HelperError.invalidAction("Unsupported native action type \(action.type).")
    }
}

func decodeAction(from rawValue: String) throws -> NativeAction {
    guard let data = rawValue.data(using: .utf8) else {
        throw HelperError.invalidArguments("Action JSON must be valid UTF-8.")
    }

    return try JSONDecoder().decode(NativeAction.self, from: data)
}

func readStdin() -> String {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    return String(data: data, encoding: .utf8) ?? ""
}

func printUsage() throws {
    try writeJSON([
        "usage": [
            "FlowStateHelper status",
            "FlowStateHelper request-accessibility",
            "FlowStateHelper list-windows",
            "FlowStateHelper list-screens",
            "FlowStateHelper run-action '{\"type\":\"native.window.setFrame\",...}'",
            "echo '{\"type\":\"native.window.setFrame\",...}' | FlowStateHelper run-action"
        ]
    ])
}

do {
    let command = CommandLine.arguments.dropFirst().first ?? "status"

    switch command {
    case "status":
        try writeJSON(HelperStatus(
            message: "FlowStateHelper is ready for AX window actions.",
            socketPath: helperSocketPath,
            accessibilityReady: accessibilityStatus()
        ))

    case "request-accessibility":
        try writeJSON(HelperStatus(
            message: "Requested Accessibility permission prompt.",
            socketPath: helperSocketPath,
            accessibilityReady: accessibilityStatus(prompt: true)
        ))

    case "list-windows":
        try writeJSON(listWindows())

    case "list-screens":
        try writeJSON(listScreens())

    case "run-action":
        let rawAction = CommandLine.arguments.dropFirst(2).first ?? readStdin()
        let action = try decodeAction(from: rawAction)
        try writeJSON(runAction(action))

    case "help", "--help", "-h":
        try printUsage()

    default:
        throw HelperError.invalidArguments("Unknown command \(command). Run help for usage.")
    }
} catch {
    let message = (error as? HelperError)?.description ?? error.localizedDescription
    try? writeJSON(ErrorResult(ok: false, message: message))
    exit(1)
}
