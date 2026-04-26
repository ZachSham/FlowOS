import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

@main
struct FlowStateHelperMain {
    static func main() {
        let arguments = Set(CommandLine.arguments)

        guard arguments.contains("--stdio") else {
            fputs("FlowStateHelper expects --stdio mode.\n", stderr)
            exit(1)
        }

        let helper = NativeHelperProcess()
        helper.run()
    }
}

final class NativeHelperProcess {
    private let encoder = JSONEncoder()
    private let outputQueue = DispatchQueue(label: "flowos.helper.output")
    private var inputBuffer = Data()
    private var workspaceObservers: [NSObjectProtocol] = []

    init() {
        encoder.outputFormatting = [.withoutEscapingSlashes]
    }

    func run() {
        emitEvent(
            event: "helper.ready",
            payload: [
                "timestamp": isoTimestamp(),
                "name": "FlowStateHelper",
                "version": "0.1.0",
                "transport": "stdio"
            ]
        )

        subscribeToWorkspaceEvents()
        startInputLoop()
        RunLoop.main.run()
    }

    private func startInputLoop() {
        FileHandle.standardInput.readabilityHandler = { [weak self] handle in
            let data = handle.availableData

            guard let self else {
                return
            }

            if data.isEmpty {
                return
            }

            self.inputBuffer.append(data)

            while let newlineRange = self.inputBuffer.firstRange(of: Data([0x0A])) {
                let lineData = self.inputBuffer.subdata(in: 0..<newlineRange.lowerBound)
                self.inputBuffer.removeSubrange(0..<newlineRange.upperBound)

                guard !lineData.isEmpty else {
                    continue
                }

                self.handleInputLine(lineData)
            }
        }
    }

    private func handleInputLine(_ lineData: Data) {
        do {
            guard let json = try JSONSerialization.jsonObject(with: lineData) as? [String: Any] else {
                return
            }

            guard
                let id = json["id"] as? String,
                let kind = json["kind"] as? String,
                kind == "request",
                let method = json["method"] as? String
            else {
                return
            }

            let payload = json["payload"] as? [String: Any] ?? [:]
            handleRequest(id: id, method: method, payload: payload)
        } catch {
            helperLog("Failed to decode request: \(error)")
        }
    }

    private func handleRequest(id: String, method: String, payload: [String: Any]) {
        switch method {
        case "helper.ping":
            respondSuccess(
                id: id,
                method: method,
                payload: [
                    "name": "FlowStateHelper",
                    "version": "0.1.0",
                    "transport": "stdio"
                ]
            )
        case "system.snapshot":
            do {
                let snapshot = try systemSnapshot()
                respondSuccess(id: id, method: method, payload: snapshot)
            } catch let error as NativeHelperError {
                respondFailure(id: id, method: method, error: error)
            } catch {
                respondFailure(id: id, method: method, error: .unknown(error.localizedDescription))
            }
        case "app.activate":
            guard let bundleId = payload["bundleId"] as? String else {
                respondFailure(id: id, method: method, error: .invalidRequest("bundleId is required"))
                return
            }

            respondAction(id: id, method: method) {
                try self.activateApp(bundleId: bundleId)
                return actionResult(details: ["Activated \(bundleId)"])
            }
        case "app.hide":
            guard let bundleId = payload["bundleId"] as? String else {
                respondFailure(id: id, method: method, error: .invalidRequest("bundleId is required"))
                return
            }

            respondAction(id: id, method: method) {
                try self.hideApp(bundleId: bundleId)
                return actionResult(details: ["Hid \(bundleId)"])
            }
        case "app.unhide":
            guard let bundleId = payload["bundleId"] as? String else {
                respondFailure(id: id, method: method, error: .invalidRequest("bundleId is required"))
                return
            }

            respondAction(id: id, method: method) {
                try self.unhideApp(bundleId: bundleId)
                return actionResult(details: ["Unhid \(bundleId)"])
            }
        case "window.raise":
            guard let windowId = payload["windowId"] as? String else {
                respondFailure(id: id, method: method, error: .invalidRequest("windowId is required"))
                return
            }

            respondAction(id: id, method: method) {
                let window = try self.resolveWindow(windowId: windowId)
                let app = try self.resolveApp(windowId: windowId)
                let frame = self.windowFrame(window) ?? CGRect(x: 0, y: 0, width: 1, height: 1)
                let preparation = try self.prepareWindowForAction(window, app: app, destination: frame)
                return actionResult(
                    details: ["Raised \(windowId)"] + preparation.details,
                    warnings: preparation.warnings
                )
            }
        case "window.minimize":
            guard let windowId = payload["windowId"] as? String else {
                respondFailure(id: id, method: method, error: .invalidRequest("windowId is required"))
                return
            }

            respondAction(id: id, method: method) {
                let window = try self.resolveWindow(windowId: windowId)
                try self.setWindowMinimized(window, minimized: true)
                return actionResult(details: ["Minimized \(windowId)"])
            }
        case "window.restore":
            guard let windowId = payload["windowId"] as? String else {
                respondFailure(id: id, method: method, error: .invalidRequest("windowId is required"))
                return
            }

            respondAction(id: id, method: method) {
                let window = try self.resolveWindow(windowId: windowId)
                try self.setWindowMinimized(window, minimized: false)
                return actionResult(details: ["Restored \(windowId)"])
            }
        case "window.move":
            guard
                let windowId = payload["windowId"] as? String,
                let x = payload["x"] as? Double,
                let y = payload["y"] as? Double
            else {
                respondFailure(id: id, method: method, error: .invalidRequest("windowId, x, and y are required"))
                return
            }

            respondAction(id: id, method: method) {
                let window = try self.resolveWindow(windowId: windowId)
                let app = try self.resolveApp(windowId: windowId)
                let currentFrame = self.windowFrame(window) ?? CGRect(x: x, y: y, width: 1, height: 1)
                let destination = CGRect(x: x, y: y, width: currentFrame.width, height: currentFrame.height)
                let preparation = try self.prepareWindowForAction(window, app: app, destination: destination)
                try self.setWindowPosition(window, x: x, y: y)
                return actionResult(
                    details: ["Moved \(windowId)"] + preparation.details,
                    warnings: preparation.warnings
                )
            }
        case "window.resize":
            guard
                let windowId = payload["windowId"] as? String,
                let width = payload["width"] as? Double,
                let height = payload["height"] as? Double
            else {
                respondFailure(
                    id: id,
                    method: method,
                    error: .invalidRequest("windowId, width, and height are required")
                )
                return
            }

            respondAction(id: id, method: method) {
                let window = try self.resolveWindow(windowId: windowId)
                let app = try self.resolveApp(windowId: windowId)
                let currentFrame = self.windowFrame(window) ?? CGRect(x: 0, y: 0, width: width, height: height)
                let destination = CGRect(x: currentFrame.minX, y: currentFrame.minY, width: width, height: height)
                let preparation = try self.prepareWindowForAction(window, app: app, destination: destination)
                try self.setWindowSize(window, width: width, height: height)
                return actionResult(
                    details: ["Resized \(windowId)"] + preparation.details,
                    warnings: preparation.warnings
                )
            }
        case "window.setFrame":
            guard
                let windowId = payload["windowId"] as? String,
                let x = payload["x"] as? Double,
                let y = payload["y"] as? Double,
                let width = payload["width"] as? Double,
                let height = payload["height"] as? Double
            else {
                respondFailure(
                    id: id,
                    method: method,
                    error: .invalidRequest("windowId, x, y, width, and height are required")
                )
                return
            }

            respondAction(id: id, method: method) {
                let window = try self.resolveWindow(windowId: windowId)
                let app = try self.resolveApp(windowId: windowId)
                let destination = CGRect(x: x, y: y, width: width, height: height)
                let preparation = try self.prepareWindowForAction(window, app: app, destination: destination)
                try self.setWindowFrame(window, x: x, y: y, width: width, height: height)
                return actionResult(
                    details: ["Set frame for \(windowId)"] + preparation.details,
                    warnings: preparation.warnings
                )
            }
        case "window.clearFullscreenAtLocation":
            guard
                let x = payload["x"] as? Double,
                let y = payload["y"] as? Double,
                let width = payload["width"] as? Double,
                let height = payload["height"] as? Double
            else {
                respondFailure(
                    id: id,
                    method: method,
                    error: .invalidRequest("x, y, width, and height are required")
                )
                return
            }

            respondAction(id: id, method: method) {
                let result = try self.clearFullscreenAtLocation(
                    CGRect(x: x, y: y, width: width, height: height)
                )
                return actionResult(
                    details: result.details,
                    warnings: result.warnings
                )
            }
        default:
            respondFailure(id: id, method: method, error: .unsupportedMethod(method))
        }
    }

    private func respondAction(id: String, method: String, body: () throws -> [String: Any]) {
        do {
            let payload = try body()
            respondSuccess(id: id, method: method, payload: payload)
        } catch let error as NativeHelperError {
            respondFailure(id: id, method: method, error: error)
        } catch {
            respondFailure(id: id, method: method, error: .unknown(error.localizedDescription))
        }
    }

    private func subscribeToWorkspaceEvents() {
        let workspaceCenter = NSWorkspace.shared.notificationCenter
        let mappings: [(Notification.Name, String)] = [
            (NSWorkspace.didActivateApplicationNotification, "app.activated"),
            (NSWorkspace.didDeactivateApplicationNotification, "app.deactivated"),
            (NSWorkspace.didLaunchApplicationNotification, "app.launched"),
            (NSWorkspace.didTerminateApplicationNotification, "app.terminated")
        ]

        for (name, eventName) in mappings {
            let observer = workspaceCenter.addObserver(forName: name, object: nil, queue: .main) {
                [weak self] notification in
                guard let self else {
                    return
                }

                guard
                    let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                    let snapshot = self.appSnapshot(from: app)
                else {
                    return
                }

                self.emitEvent(
                    event: eventName,
                    payload: [
                        "timestamp": self.isoTimestamp(),
                        "app": snapshot
                    ]
                )
            }

            workspaceObservers.append(observer)
        }

        let spaceObserver = workspaceCenter.addObserver(
            forName: NSWorkspace.activeSpaceDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.emitEvent(
                event: "space.changed",
                payload: [
                    "timestamp": self?.isoTimestamp() as Any
                ]
            )
        }

        workspaceObservers.append(spaceObserver)
    }

    private func permissionSnapshot() -> [String: Any] {
        [
            "accessibilityTrusted": AXIsProcessTrustedWithOptions([
                kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false
            ] as CFDictionary),
            "screenRecordingGranted": CGPreflightScreenCaptureAccess()
        ]
    }

    private func runningApps() -> [NSRunningApplication] {
        NSWorkspace.shared.runningApplications
            .filter { $0.bundleIdentifier != nil && $0.activationPolicy == .regular }
            .sorted { lhs, rhs in
                let left = lhs.localizedName ?? lhs.bundleIdentifier ?? ""
                let right = rhs.localizedName ?? rhs.bundleIdentifier ?? ""
                return left.localizedCaseInsensitiveCompare(right) == .orderedAscending
            }
    }

    private func runningAppSnapshots() -> [[String: Any]] {
        runningApps().compactMap(appSnapshot(from:))
    }

    private func frontmostAppSnapshot() -> [String: Any]? {
        guard let app = NSWorkspace.shared.frontmostApplication else {
            return nil
        }

        return appSnapshot(from: app)
    }

    private func displaySnapshots() -> [[String: Any]] {
        let screens = NSScreen.screens

        return screens.enumerated().map { index, screen in
            let frame = screen.frame
            let visibleFrame = screen.visibleFrame
            let screenNumber = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber

            return [
                "id": String(screenNumber?.intValue ?? index),
                "label": screen.localizedName,
                "x": frame.origin.x,
                "y": frame.origin.y,
                "width": frame.size.width,
                "height": frame.size.height,
                "visibleX": visibleFrame.origin.x,
                "visibleY": visibleFrame.origin.y,
                "visibleWidth": visibleFrame.size.width,
                "visibleHeight": visibleFrame.size.height,
                "scaleFactor": screen.backingScaleFactor,
                "rotation": 0,
                "internal": screen == NSScreen.screens.first,
                "isPrimary": index == 0
            ]
        }
    }

    private func systemSnapshot() throws -> [String: Any] {
        [
            "timestamp": isoTimestamp(),
            "permissions": permissionSnapshot(),
            "frontmostApp": frontmostAppSnapshot() as Any,
            "runningApps": runningAppSnapshots(),
            "focusedWindow": try focusedWindowSnapshot() as Any,
            "windows": try listWindows(bundleIds: nil),
            "displays": displaySnapshots()
        ]
    }

    private func appSnapshot(from app: NSRunningApplication) -> [String: Any]? {
        guard let bundleId = app.bundleIdentifier else {
            return nil
        }

        return [
            "bundleId": bundleId,
            "name": app.localizedName ?? bundleId,
            "pid": Int(app.processIdentifier),
            "isActive": app.isActive,
            "isHidden": app.isHidden
        ]
    }

    private func listWindows(bundleIds: [String]?) throws -> [[String: Any]] {
        try requireAccessibility()

        let apps = runningApps().filter { app in
            guard let bundleIds else {
                return true
            }

            return bundleIds.contains(app.bundleIdentifier ?? "")
        }

        return apps.flatMap { app in
            (try? windowSnapshots(for: app)) ?? []
        }
    }

    private func focusedWindowSnapshot() throws -> [String: Any]? {
        try requireAccessibility()

        guard let app = NSWorkspace.shared.frontmostApplication else {
            return nil
        }

        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        let focusedWindow = try? copyElementAttribute(appElement, attribute: kAXFocusedWindowAttribute)

        guard let focusedWindowElement = focusedWindow else {
            return nil
        }

        let windows = (try? windowSnapshots(for: app)) ?? []
        guard !windows.isEmpty else {
            return nil
        }

        let focusedTitle = copyStringAttribute(focusedWindowElement, attribute: kAXTitleAttribute) ?? ""

        if let exact = windows.first(where: { ($0["title"] as? String) == focusedTitle }) {
            return exact
        }

        return windows.first
    }

    private func windowSnapshots(for app: NSRunningApplication) throws -> [[String: Any]] {
        guard let appSnapshot = appSnapshot(from: app) else {
            return []
        }

        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        let focusedWindow = try? copyElementAttribute(appElement, attribute: kAXFocusedWindowAttribute)
        let mainWindow = try? copyElementAttribute(appElement, attribute: kAXMainWindowAttribute)
        let windows = try copyElementArrayAttribute(appElement, attribute: kAXWindowsAttribute)

        return windows.enumerated().map { index, window in
            let title = copyStringAttribute(window, attribute: kAXTitleAttribute) ?? ""
            let position = copyCGPointAttribute(window, attribute: kAXPositionAttribute) ?? .zero
            let size = copyCGSizeAttribute(window, attribute: kAXSizeAttribute) ?? .zero
            let minimized = copyBoolAttribute(window, attribute: kAXMinimizedAttribute) ?? false

            return [
                "windowId": makeWindowId(pid: Int(app.processIdentifier), index: index),
                "bundleId": appSnapshot["bundleId"] as Any,
                "appName": appSnapshot["name"] as Any,
                "pid": appSnapshot["pid"] as Any,
                "title": title,
                "x": position.x,
                "y": position.y,
                "width": size.width,
                "height": size.height,
                "isFocused": focusedWindow.map { CFEqual($0, window) } ?? false,
                "isMain": mainWindow.map { CFEqual($0, window) } ?? false,
                "isMinimized": minimized
            ]
        }
    }

    private func activateApp(bundleId: String) throws {
        guard let app = runningApps().first(where: { $0.bundleIdentifier == bundleId }) else {
            throw NativeHelperError.notFound("No running app with bundleId \(bundleId)")
        }

        app.activate(options: [.activateAllWindows])
    }

    private func hideApp(bundleId: String) throws {
        guard let app = runningApps().first(where: { $0.bundleIdentifier == bundleId }) else {
            throw NativeHelperError.notFound("No running app with bundleId \(bundleId)")
        }

        app.hide()
    }

    private func unhideApp(bundleId: String) throws {
        guard let app = runningApps().first(where: { $0.bundleIdentifier == bundleId }) else {
            throw NativeHelperError.notFound("No running app with bundleId \(bundleId)")
        }

        app.unhide()
    }

    private func prepareWindowForAction(
        _ window: AXUIElement,
        app: NSRunningApplication,
        destination: CGRect
    ) throws -> (details: [String], warnings: [String]) {
        try requireAccessibility()
        var details: [String] = []
        var warnings: [String] = []

        if isWindowFullscreen(window) {
            if setWindowFullscreenBestEffort(window, fullscreen: false) {
                details.append("Exited fullscreen for target window")
            } else if setWindowMinimizedBestEffort(window, minimized: true) {
                warnings.append("Target window was fullscreen and could only be minimized")
            } else {
                warnings.append("Target window is fullscreen and could not be cleared")
            }
        }

        if copyBoolAttribute(window, attribute: kAXMinimizedAttribute) ?? false {
            try setWindowMinimized(window, minimized: false)
            waitForMinimizedState(window, minimized: false)
        }

        let cleared = try clearFullscreenAtLocation(destination, excluding: window)
        details.append(contentsOf: cleared.details.filter { $0 != "No fullscreen windows found at location" })
        warnings.append(contentsOf: cleared.warnings)

        if let raiseWarning = try raiseWindow(window, app: app) {
            warnings.append(raiseWarning)
        }
        return (details, warnings)
    }

    private func raiseWindow(_ window: AXUIElement, app: NSRunningApplication) throws -> String? {
        try requireAccessibility()
        let appElement = AXUIElementCreateApplication(app.processIdentifier)

        app.activate(options: [.activateAllWindows])
        Thread.sleep(forTimeInterval: 0.08)

        _ = AXUIElementSetAttributeValue(appElement, kAXMainWindowAttribute as CFString, window)
        _ = AXUIElementSetAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, window)
        _ = AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
        _ = AXUIElementSetAttributeValue(window, kAXFocusedAttribute as CFString, kCFBooleanTrue)

        let result = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
        switch result {
        case .success, .actionUnsupported:
            clickWindowBestEffort(window)
            return nil
        case .cannotComplete:
            // Common on Sidecar / iPad displays and windows on other Spaces:
            // WindowServer can't synchronously raise the window, but the
            // position/size writes that follow still succeed. Surface as a
            // warning instead of aborting the whole action.
            return "Could not raise window (\(result.rawValue)); other window changes will still be applied."
        default:
            throw NativeHelperError.axFailure("Unable to raise window", result)
        }
    }

    private func clickWindowBestEffort(_ window: AXUIElement) {
        guard let position = copyCGPointAttribute(window, attribute: kAXPositionAttribute),
              let size = copyCGSizeAttribute(window, attribute: kAXSizeAttribute),
              size.width > 0,
              size.height > 0 else {
            return
        }

        let clickPoint = CGPoint(
            x: position.x + min(max(size.width / 2, 20), size.width - 20),
            y: position.y + min(max(size.height / 2, 20), size.height - 20)
        )

        guard let source = CGEventSource(stateID: .hidSystemState),
              let mouseDown = CGEvent(
                mouseEventSource: source,
                mouseType: .leftMouseDown,
                mouseCursorPosition: clickPoint,
                mouseButton: .left
              ),
              let mouseUp = CGEvent(
                mouseEventSource: source,
                mouseType: .leftMouseUp,
                mouseCursorPosition: clickPoint,
                mouseButton: .left
              ) else {
            return
        }

        mouseDown.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.03)
        mouseUp.post(tap: .cghidEventTap)
    }

    private func setWindowMinimized(_ window: AXUIElement, minimized: Bool) throws {
        try requireAccessibility()
        let result = AXUIElementSetAttributeValue(
            window,
            kAXMinimizedAttribute as CFString,
            minimized ? kCFBooleanTrue : kCFBooleanFalse
        )

        guard result == .success else {
            throw NativeHelperError.axFailure("Unable to change minimized state", result)
        }
    }

    private func setWindowPosition(_ window: AXUIElement, x: Double, y: Double) throws {
        try requireAccessibility()
        var point = CGPoint(x: x, y: y)
        guard let value = AXValueCreate(.cgPoint, &point) else {
            throw NativeHelperError.invalidRequest("Failed to create AX point value")
        }

        let result = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, value)
        guard result == .success else {
            throw NativeHelperError.axFailure("Unable to move window", result)
        }
    }

    private func setWindowSize(_ window: AXUIElement, width: Double, height: Double) throws {
        try requireAccessibility()
        var size = CGSize(width: width, height: height)
        guard let value = AXValueCreate(.cgSize, &size) else {
            throw NativeHelperError.invalidRequest("Failed to create AX size value")
        }

        let result = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, value)
        guard result == .success else {
            throw NativeHelperError.axFailure("Unable to resize window", result)
        }
    }

    private func setWindowFrame(_ window: AXUIElement, x: Double, y: Double, width: Double, height: Double) throws {
        try setWindowPosition(window, x: x, y: y)
        Thread.sleep(forTimeInterval: 0.08)
        try setWindowSize(window, width: width, height: height)
        try setWindowPosition(window, x: x, y: y)
    }

    private func windowFrame(_ window: AXUIElement) -> CGRect? {
        guard let position = copyCGPointAttribute(window, attribute: kAXPositionAttribute),
              let size = copyCGSizeAttribute(window, attribute: kAXSizeAttribute) else {
            return nil
        }

        return CGRect(origin: position, size: size)
    }

    private func clearFullscreenAtLocation(
        _ location: CGRect,
        excluding excludedWindow: AXUIElement? = nil
    ) throws -> (details: [String], warnings: [String]) {
        try requireAccessibility()

        var details: [String] = []
        var warnings: [String] = []

        for app in runningApps() {
            let appElement = AXUIElementCreateApplication(app.processIdentifier)
            let windows = (try? copyElementArrayAttribute(appElement, attribute: kAXWindowsAttribute)) ?? []

            for (index, window) in windows.enumerated() {
                if let excludedWindow, CFEqual(excludedWindow, window) {
                    continue
                }

                guard isWindowFullscreen(window) else {
                    continue
                }

                let position = copyCGPointAttribute(window, attribute: kAXPositionAttribute) ?? .zero
                let size = copyCGSizeAttribute(window, attribute: kAXSizeAttribute) ?? .zero
                let windowRect = CGRect(origin: position, size: size)

                guard windowRect.intersects(location) else {
                    continue
                }

                let windowId = makeWindowId(pid: Int(app.processIdentifier), index: index)
                app.activate(options: [.activateAllWindows])
                _ = AXUIElementPerformAction(window, kAXRaiseAction as CFString)

                if !setWindowFullscreenBestEffort(window, fullscreen: false) {
                    warnings.append("Could not exit fullscreen for \(windowId)")
                }

                if !setWindowMinimizedBestEffort(window, minimized: true) {
                    warnings.append("Could not minimize \(windowId)")
                    continue
                }

                details.append("Cleared fullscreen window \(windowId)")
            }
        }

        if details.isEmpty && warnings.isEmpty {
            details.append("No fullscreen windows found at location")
        }

        return (details, warnings)
    }

    private func isWindowFullscreen(_ window: AXUIElement) -> Bool {
        copyBoolAttribute(window, attribute: "AXFullScreen") ?? false
    }

    private func setWindowFullscreenBestEffort(_ window: AXUIElement, fullscreen: Bool) -> Bool {
        let result = AXUIElementSetAttributeValue(
            window,
            "AXFullScreen" as CFString,
            fullscreen ? kCFBooleanTrue : kCFBooleanFalse
        )

        guard result == .success else {
            return false
        }

        waitForFullscreenState(window, fullscreen: fullscreen)
        return isWindowFullscreen(window) == fullscreen
    }

    private func setWindowMinimizedBestEffort(_ window: AXUIElement, minimized: Bool) -> Bool {
        let result = AXUIElementSetAttributeValue(
            window,
            kAXMinimizedAttribute as CFString,
            minimized ? kCFBooleanTrue : kCFBooleanFalse
        )

        guard result == .success else {
            return false
        }

        waitForMinimizedState(window, minimized: minimized)
        return (copyBoolAttribute(window, attribute: kAXMinimizedAttribute) ?? false) == minimized
    }

    private func waitForFullscreenState(_ window: AXUIElement, fullscreen: Bool) {
        let deadline = Date().addingTimeInterval(2.0)

        while Date() < deadline {
            if isWindowFullscreen(window) == fullscreen {
                return
            }

            Thread.sleep(forTimeInterval: 0.1)
        }
    }

    private func waitForMinimizedState(_ window: AXUIElement, minimized: Bool) {
        let deadline = Date().addingTimeInterval(1.5)

        while Date() < deadline {
            if (copyBoolAttribute(window, attribute: kAXMinimizedAttribute) ?? false) == minimized {
                return
            }

            Thread.sleep(forTimeInterval: 0.1)
        }
    }

    private func resolveWindow(windowId: String) throws -> AXUIElement {
        try requireAccessibility()
        let parsed = try parseWindowId(windowId)

        let appElement = AXUIElementCreateApplication(parsed.pid)
        let windows = try copyElementArrayAttribute(appElement, attribute: kAXWindowsAttribute)

        guard windows.indices.contains(parsed.index) else {
            throw NativeHelperError.notFound("Window \(windowId) no longer exists")
        }

        return windows[parsed.index]
    }

    private func resolveApp(windowId: String) throws -> NSRunningApplication {
        let parsed = try parseWindowId(windowId)

        guard let app = NSRunningApplication(processIdentifier: parsed.pid) else {
            throw NativeHelperError.notFound("App for window \(windowId) is no longer running")
        }

        return app
    }

    private func parseWindowId(_ windowId: String) throws -> (pid: pid_t, index: Int) {
        let components = windowId.split(separator: ":")

        guard
            components.count == 3,
            components[0] == "ax",
            let pid = Int32(components[1]),
            let index = Int(components[2])
        else {
            throw NativeHelperError.invalidRequest("Invalid windowId format: \(windowId)")
        }

        return (pid, index)
    }

    private func requireAccessibility() throws {
        let trusted = AXIsProcessTrustedWithOptions([
            kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: false
        ] as CFDictionary)

        if !trusted {
            throw NativeHelperError.permissionDenied("Accessibility permission is required")
        }
    }

    private func copyElementArrayAttribute(_ element: AXUIElement, attribute: String) throws -> [AXUIElement] {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

        guard result == .success else {
            throw NativeHelperError.axFailure("Unable to read \(attribute)", result)
        }

        return value as? [AXUIElement] ?? []
    }

    private func copyElementAttribute(_ element: AXUIElement, attribute: String) throws -> AXUIElement? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

        if result == .noValue {
            return nil
        }

        guard result == .success else {
            throw NativeHelperError.axFailure("Unable to read \(attribute)", result)
        }

        return value.map { unsafeBitCast($0, to: AXUIElement.self) }
    }

    private func copyStringAttribute(_ element: AXUIElement, attribute: String) -> String? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        guard result == .success else {
            return nil
        }

        return value as? String
    }

    private func copyBoolAttribute(_ element: AXUIElement, attribute: String) -> Bool? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        guard result == .success else {
            return nil
        }

        if let boolValue = value as? Bool {
            return boolValue
        }

        if let numberValue = value as? NSNumber {
            return numberValue.boolValue
        }

        return nil
    }

    private func copyCGPointAttribute(_ element: AXUIElement, attribute: String) -> CGPoint? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        guard result == .success, let axValue = value else {
            return nil
        }

        let valueRef = unsafeBitCast(axValue, to: AXValue.self)
        guard AXValueGetType(valueRef) == .cgPoint else {
            return nil
        }

        var point = CGPoint.zero
        AXValueGetValue(valueRef, .cgPoint, &point)
        return point
    }

    private func copyCGSizeAttribute(_ element: AXUIElement, attribute: String) -> CGSize? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        guard result == .success, let axValue = value else {
            return nil
        }

        let valueRef = unsafeBitCast(axValue, to: AXValue.self)
        guard AXValueGetType(valueRef) == .cgSize else {
            return nil
        }

        var size = CGSize.zero
        AXValueGetValue(valueRef, .cgSize, &size)
        return size
    }

    private func respondSuccess(id: String, method: String, payload: [String: Any]) {
        writeJSON([
            "id": id,
            "kind": "response",
            "method": method,
            "ok": true,
            "payload": payload
        ])
    }

    private func respondFailure(id: String, method: String, error: NativeHelperError) {
        writeJSON([
            "id": id,
            "kind": "response",
            "method": method,
            "ok": false,
            "error": [
                "code": error.code,
                "message": error.message
            ]
        ])
    }

    private func emitEvent(event: String, payload: [String: Any]) {
        writeJSON([
            "kind": "event",
            "event": event,
            "payload": payload
        ])
    }

    private func writeJSON(_ object: [String: Any]) {
        outputQueue.async {
            do {
                let data = try JSONSerialization.data(withJSONObject: object, options: [])
                FileHandle.standardOutput.write(data)
                FileHandle.standardOutput.write(Data([0x0A]))
            } catch {
                self.helperLog("Failed to serialize JSON: \(error)")
            }
        }
    }

    private func actionResult(details: [String], warnings: [String] = []) -> [String: Any] {
        [
            "applied": true,
            "details": details,
            "warnings": warnings
        ]
    }

    private func makeWindowId(pid: Int, index: Int) -> String {
        "ax:\(pid):\(index)"
    }

    private func isoTimestamp() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    private func helperLog(_ message: String) {
        fputs("[FlowStateHelper] \(message)\n", stderr)
    }
}

enum NativeHelperError: Error {
    case permissionDenied(String)
    case invalidRequest(String)
    case unsupportedMethod(String)
    case notFound(String)
    case axFailure(String, AXError)
    case unknown(String)

    var code: String {
        switch self {
        case .permissionDenied:
            return "permission_denied"
        case .invalidRequest:
            return "invalid_request"
        case .unsupportedMethod:
            return "unsupported_method"
        case .notFound:
            return "not_found"
        case .axFailure:
            return "ax_failure"
        case .unknown:
            return "unknown"
        }
    }

    var message: String {
        switch self {
        case .permissionDenied(let message),
             .invalidRequest(let message),
             .unsupportedMethod(let message),
             .notFound(let message),
             .unknown(let message):
            return message
        case .axFailure(let message, let error):
            return "\(message) (\(error.rawValue))"
        }
    }
}
