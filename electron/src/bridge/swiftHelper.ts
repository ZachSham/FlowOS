export const swiftHelperSocketPath = "/tmp/flowos-helper.sock";

export interface SwiftHelperStatus {
  connected: boolean;
  socketPath: string;
}

export function getSwiftHelperStatus(): SwiftHelperStatus {
  return {
    connected: false,
    socketPath: swiftHelperSocketPath
  };
}

