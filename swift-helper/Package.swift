// swift-tools-version: 5.10
import PackageDescription

let package = Package(
  name: "FlowStateHelper",
  platforms: [
    .macOS(.v14)
  ],
  products: [
    .executable(name: "FlowStateHelper", targets: ["FlowStateHelper"])
  ],
  targets: [
    .executableTarget(
      name: "FlowStateHelper",
      path: "Sources/FlowStateHelper"
    )
  ]
)
