import Foundation

struct HelperStatus: Codable {
    let message: String
    let socketPath: String
    let accessibilityReady: Bool
}

let status = HelperStatus(
    message: "FlowStateHelper scaffold is ready for AXUIElement and AXObserver work.",
    socketPath: "/tmp/flowos-helper.sock",
    accessibilityReady: false
)

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

if let data = try? encoder.encode(status), let output = String(data: data, encoding: .utf8) {
    print(output)
}

