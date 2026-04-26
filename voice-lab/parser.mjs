const APP_COMMANDS = [
  {
    bundleId: "com.microsoft.VSCode",
    label: "VS Code",
    aliases: ["vscode", "vs code", "visual studio code", "code"]
  },
  {
    bundleId: "com.google.Chrome",
    label: "Google Chrome",
    aliases: ["chrome", "google chrome"]
  },
  {
    bundleId: "com.apple.Terminal",
    label: "Terminal",
    aliases: ["terminal"]
  },
  {
    bundleId: "com.apple.Safari",
    label: "Safari",
    aliases: ["safari"]
  }
];

const ACTIVATION_VERBS = ["open", "launch", "focus", "switch", "switch to", "activate", "start", "go to"];
const DIRECTION_WORDS = ["left", "right", "up", "down"];

function includesAny(input, patterns) {
  return patterns.some((pattern) => input.includes(pattern));
}

function containsWord(input, word) {
  return new RegExp(`\\b${word}\\b`).test(input);
}

function normalizeTranscript(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s:._\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNativeRequestCommand(method, payload) {
  return `NATIVE_REQUEST method=${method} payload=${JSON.stringify(payload)}`;
}

function extractWindowId(rawTranscript, normalizedTranscript) {
  const directAxMatch = rawTranscript.match(/ax:\d+:\d+/i);
  if (directAxMatch?.[0]) {
    return directAxMatch[0].toLowerCase();
  }

  const normalizedAxMatch = normalizedTranscript.match(/ax:\d+:\d+/);
  if (normalizedAxMatch?.[0]) {
    return normalizedAxMatch[0];
  }

  return null;
}

function extractNumberWithRegex(normalizedTranscript, regexes) {
  for (const regex of regexes) {
    const match = normalizedTranscript.match(regex);
    if (!match?.[1]) {
      continue;
    }

    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function extractFrameValues(normalizedTranscript) {
  const x = extractNumberWithRegex(normalizedTranscript, [
    /\bx\s*(-?\d+(?:\.\d+)?)/,
    /\bleft\s*(-?\d+(?:\.\d+)?)/
  ]);
  const y = extractNumberWithRegex(normalizedTranscript, [
    /\by\s*(-?\d+(?:\.\d+)?)/,
    /\btop\s*(-?\d+(?:\.\d+)?)/
  ]);
  const width = extractNumberWithRegex(normalizedTranscript, [/\bwidth\s*(\d+(?:\.\d+)?)/]);
  const height = extractNumberWithRegex(normalizedTranscript, [/\bheight\s*(\d+(?:\.\d+)?)/]);

  return { x, y, width, height };
}

function extractBundleId(normalizedTranscript) {
  const explicitMatch = normalizedTranscript.match(/\bbundle\s*id\s*([a-z0-9_.\-]+)/);
  if (explicitMatch?.[1]) {
    return explicitMatch[1];
  }

  const appPhraseMatch = normalizedTranscript.match(/\bapp\s*([a-z0-9_.\-]+)/);
  if (appPhraseMatch?.[1] && appPhraseMatch[1].includes(".")) {
    return appPhraseMatch[1];
  }

  return null;
}

function extractDirection(normalizedTranscript) {
  for (const direction of DIRECTION_WORDS) {
    if (containsWord(normalizedTranscript, direction)) {
      return direction;
    }
  }

  return null;
}

function extractMoveAmount(normalizedTranscript) {
  if (
    normalizedTranscript.includes("a little") ||
    containsWord(normalizedTranscript, "slightly") ||
    containsWord(normalizedTranscript, "bit")
  ) {
    return "small";
  }

  if (
    containsWord(normalizedTranscript, "far") ||
    normalizedTranscript.includes("a lot") ||
    normalizedTranscript.includes("all the way")
  ) {
    return "large";
  }

  return "medium";
}

function extractTarget(normalizedTranscript) {
  if (includesAny(normalizedTranscript, ["this window", "current window"])) {
    return "frontmost";
  }

  for (const app of APP_COMMANDS) {
    if (includesAny(normalizedTranscript, app.aliases)) {
      return `app:${app.bundleId}`;
    }
  }

  if (containsWord(normalizedTranscript, "window")) {
    return "frontmost";
  }

  return "frontmost";
}

function resolveAppBundleFromTranscript(normalizedTranscript) {
  const explicitBundleId = extractBundleId(normalizedTranscript);
  if (explicitBundleId) {
    return explicitBundleId;
  }

  for (const app of APP_COMMANDS) {
    if (includesAny(normalizedTranscript, app.aliases)) {
      return app.bundleId;
    }
  }

  return null;
}

function successResult(rawTranscript, normalizedTranscript, intent, commandString, message) {
  return {
    ok: true,
    intent,
    transcript: rawTranscript,
    normalizedTranscript,
    commandString,
    message
  };
}

function failureResult(rawTranscript, normalizedTranscript, message, hint) {
  return {
    ok: false,
    intent: "unknown",
    transcript: rawTranscript,
    normalizedTranscript,
    commandString: null,
    message,
    hint
  };
}

function parseAppActivation(rawTranscript, normalizedTranscript) {
  const explicitBundleId = extractBundleId(normalizedTranscript);
  if (explicitBundleId && includesAny(normalizedTranscript, ACTIVATION_VERBS)) {
    return successResult(
      rawTranscript,
      normalizedTranscript,
      "activate_app",
      buildNativeRequestCommand("app.activate", {
        bundleId: explicitBundleId
      }),
      `Parsed app activation for ${explicitBundleId}.`
    );
  }

  const wantsActivation = includesAny(normalizedTranscript, ACTIVATION_VERBS);

  for (const app of APP_COMMANDS) {
    const appMentioned = includesAny(normalizedTranscript, app.aliases);
    if (!appMentioned) {
      continue;
    }

    if (wantsActivation || app.aliases.some((alias) => normalizedTranscript === alias)) {
      return successResult(
        rawTranscript,
        normalizedTranscript,
        "activate_app",
        buildNativeRequestCommand("app.activate", {
          bundleId: app.bundleId
        }),
        `Parsed app activation for ${app.label}.`
      );
    }
  }

  return null;
}

function parseRaiseWindow(rawTranscript, normalizedTranscript) {
  const mentionsRaise = includesAny(normalizedTranscript, ["raise", "bring to front", "focus window"]);

  if (!mentionsRaise) {
    return null;
  }

  const windowId = extractWindowId(rawTranscript, normalizedTranscript);
  if (windowId) {
    return successResult(
      rawTranscript,
      normalizedTranscript,
      "raise_window",
      buildNativeRequestCommand("window.raise", {
        windowId
      }),
      "Parsed raise-window command."
    );
  }

  const target = extractTarget(normalizedTranscript);
  return successResult(
    rawTranscript,
    normalizedTranscript,
    "raise_window",
    `FLOW_COMMAND type=window.raise target=${target}`,
    "Parsed raise-window command."
  );
}

function parseMinimizeWindow(rawTranscript, normalizedTranscript) {
  const mentionsMinimize = includesAny(normalizedTranscript, [
    "minimize",
    "minimise",
    "hide window",
    "hide this window",
    "send to dock"
  ]);

  if (!mentionsMinimize) {
    return null;
  }

  const windowId = extractWindowId(rawTranscript, normalizedTranscript);
  if (windowId) {
    return successResult(
      rawTranscript,
      normalizedTranscript,
      "minimize_window",
      buildNativeRequestCommand("window.minimize", {
        windowId
      }),
      "Parsed minimize-window command."
    );
  }

  const target = extractTarget(normalizedTranscript);
  return successResult(
    rawTranscript,
    normalizedTranscript,
    "minimize_window",
    `FLOW_COMMAND type=window.minimize target=${target}`,
    "Parsed minimize-window command."
  );
}

function parseRestoreWindow(rawTranscript, normalizedTranscript) {
  const mentionsRestore = includesAny(normalizedTranscript, [
    "restore this window",
    "restore window",
    "unminimize",
    "un minimise",
    "un-minimize",
    "bring back window",
    "show this window again"
  ]);

  if (!mentionsRestore) {
    return null;
  }

  const windowId = extractWindowId(rawTranscript, normalizedTranscript);
  if (windowId) {
    return successResult(
      rawTranscript,
      normalizedTranscript,
      "restore_window",
      buildNativeRequestCommand("window.restore", {
        windowId
      }),
      "Parsed restore-window command."
    );
  }

  const target = extractTarget(normalizedTranscript);
  return successResult(
    rawTranscript,
    normalizedTranscript,
    "restore_window",
    `FLOW_COMMAND type=window.restore target=${target}`,
    "Parsed restore-window command."
  );
}

function parseUnhideApp(rawTranscript, normalizedTranscript) {
  const mentionsUnhide = includesAny(normalizedTranscript, [
    "unhide",
    "show app",
    "show application",
    "bring back app",
    "reopen app"
  ]);

  const appBundleFromText = resolveAppBundleFromTranscript(normalizedTranscript);
  const mentionsShowAppByName =
    containsWord(normalizedTranscript, "show") &&
    Boolean(appBundleFromText) &&
    !includesAny(normalizedTranscript, ["show windows", "show displays", "show monitors"]);

  if (!mentionsUnhide && !mentionsShowAppByName) {
    return null;
  }

  const bundleId = appBundleFromText;
  if (!bundleId) {
    return failureResult(
      rawTranscript,
      normalizedTranscript,
      "Could not determine which app to unhide.",
      "Try: unhide vscode"
    );
  }

  return successResult(
    rawTranscript,
    normalizedTranscript,
    "unhide_app",
    buildNativeRequestCommand("app.unhide", {
      bundleId
    }),
    "Parsed unhide-app command."
  );
}

function parseHideApp(rawTranscript, normalizedTranscript) {
  const mentionsHide = includesAny(normalizedTranscript, ["hide app", "hide application", "hide"]);
  if (!mentionsHide || includesAny(normalizedTranscript, ["unhide", "show app", "show application"])) {
    return null;
  }

  if (includesAny(normalizedTranscript, ["hide this app", "hide current app"])) {
    return successResult(
      rawTranscript,
      normalizedTranscript,
      "hide_app",
      "FLOW_COMMAND type=app.hide target=frontmost",
      "Parsed hide-current-app command."
    );
  }

  const bundleId = resolveAppBundleFromTranscript(normalizedTranscript);
  if (!bundleId) {
    return failureResult(
      rawTranscript,
      normalizedTranscript,
      "Could not determine which app to hide.",
      "Try: hide vscode"
    );
  }

  return successResult(
    rawTranscript,
    normalizedTranscript,
    "hide_app",
    buildNativeRequestCommand("app.hide", {
      bundleId
    }),
    "Parsed hide-app command."
  );
}

function parseMoveWindow(rawTranscript, normalizedTranscript) {
  const mentionsMove = includesAny(normalizedTranscript, ["move", "send", "put", "shift", "throw", "toss"]);
  if (!mentionsMove) {
    return null;
  }

  const windowId = extractWindowId(rawTranscript, normalizedTranscript);
  const values = extractFrameValues(normalizedTranscript);

  if (windowId && values.x !== null && values.y !== null) {
    return successResult(
      rawTranscript,
      normalizedTranscript,
      "move_window",
      buildNativeRequestCommand("window.move", {
        windowId,
        x: values.x,
        y: values.y
      }),
      "Parsed move-window command."
    );
  }

  const target = extractTarget(normalizedTranscript);
  const direction = extractDirection(normalizedTranscript);
  const amount = extractMoveAmount(normalizedTranscript);

  const isOtherScreenVariant = includesAny(normalizedTranscript, [
    "other screen",
    "other monitor",
    "other display",
    "next screen",
    "next monitor",
    "next display",
    "another screen",
    "another monitor",
    "another display"
  ]);

  if (isOtherScreenVariant) {
    return successResult(
      rawTranscript,
      normalizedTranscript,
      "move_window_to_other_screen",
      `FLOW_COMMAND type=window.move_to_other_screen target=${target}`,
      "Parsed move-window-to-other-screen command."
    );
  }

  if (direction) {
    return successResult(
      rawTranscript,
      normalizedTranscript,
      "move_window_relative",
      `FLOW_COMMAND type=window.move_relative target=${target} direction=${direction} amount=${amount}`,
      `Parsed move-${direction} command.`
    );
  }

  return successResult(
    rawTranscript,
    normalizedTranscript,
    "move_window_relative",
    `FLOW_COMMAND type=window.move_relative target=${target} direction=right amount=medium`,
    "Parsed move command with default direction right."
  );
}

function parseResizeWindow(rawTranscript, normalizedTranscript) {
  const mentionsResize = includesAny(normalizedTranscript, ["resize", "size"]);
  const mentionsWindow = includesAny(normalizedTranscript, ["window"]);

  if (!mentionsResize || !mentionsWindow) {
    return null;
  }

  const windowId = extractWindowId(rawTranscript, normalizedTranscript);
  const values = extractFrameValues(normalizedTranscript);

  if (!windowId || values.width === null || values.height === null) {
    return failureResult(
      rawTranscript,
      normalizedTranscript,
      "Could not parse resize-window parameters.",
      "Use: resize window ax:12345:0 width 900 height 700"
    );
  }

  return successResult(
    rawTranscript,
    normalizedTranscript,
    "resize_window",
    buildNativeRequestCommand("window.resize", {
      windowId,
      width: values.width,
      height: values.height
    }),
    "Parsed resize-window command."
  );
}

function parseSetFrame(rawTranscript, normalizedTranscript) {
  const mentionsSetFrame = includesAny(normalizedTranscript, ["set frame", "set window frame"]);

  if (!mentionsSetFrame) {
    return null;
  }

  const windowId = extractWindowId(rawTranscript, normalizedTranscript);
  const values = extractFrameValues(normalizedTranscript);

  if (
    !windowId ||
    values.x === null ||
    values.y === null ||
    values.width === null ||
    values.height === null
  ) {
    return failureResult(
      rawTranscript,
      normalizedTranscript,
      "Could not parse set-frame parameters.",
      "Use: set frame window ax:12345:0 x 80 y 80 width 900 height 700"
    );
  }

  return successResult(
    rawTranscript,
    normalizedTranscript,
    "set_window_frame",
    buildNativeRequestCommand("window.setFrame", {
      windowId,
      x: values.x,
      y: values.y,
      width: values.width,
      height: values.height
    }),
    "Parsed set-frame command."
  );
}

function parseHelperMetaCommands(rawTranscript, normalizedTranscript) {
  if (includesAny(normalizedTranscript, ["request accessibility", "grant accessibility", "accessibility permission"])) {
    return successResult(
      rawTranscript,
      normalizedTranscript,
      "request_accessibility",
      "FLOW_COMMAND type=permissions.open_accessibility_settings",
      "Parsed accessibility command."
    );
  }

  if (
    includesAny(normalizedTranscript, [
      "list windows",
      "show windows",
      "window list",
      "what windows are open"
    ])
  ) {
    return successResult(
      rawTranscript,
      normalizedTranscript,
      "list_windows",
      "FLOW_COMMAND type=system.list_windows",
      "Parsed list-windows command."
    );
  }

  if (
    includesAny(normalizedTranscript, [
      "list screens",
      "list displays",
      "show monitors",
      "show displays",
      "what displays do i have"
    ])
  ) {
    return successResult(
      rawTranscript,
      normalizedTranscript,
      "list_screens",
      "FLOW_COMMAND type=system.list_screens",
      "Parsed list-screens command."
    );
  }

  if (
    normalizedTranscript === "status" ||
    includesAny(normalizedTranscript, ["helper status", "flow helper status", "native helper status"])
  ) {
    return successResult(
      rawTranscript,
      normalizedTranscript,
      "helper_status",
      "FLOW_COMMAND type=helper.status",
      "Parsed helper status command."
    );
  }

  return null;
}

export function parseVoiceTranscript(rawTranscript) {
  const normalizedTranscript = normalizeTranscript(rawTranscript);

  if (!normalizedTranscript) {
    return failureResult(rawTranscript, normalizedTranscript, "No transcript detected.");
  }

  const parsers = [
    parseSetFrame,
    parseResizeWindow,
    parseMoveWindow,
    parseRestoreWindow,
    parseMinimizeWindow,
    parseRaiseWindow,
    parseUnhideApp,
    parseHideApp,
    parseAppActivation,
    parseHelperMetaCommands
  ];

  for (const parser of parsers) {
    const result = parser(rawTranscript, normalizedTranscript);
    if (result) {
      return result;
    }
  }

  return failureResult(
    rawTranscript,
    normalizedTranscript,
    "Command not recognized.",
    "Try: 'list windows' or 'move vscode to the right'"
  );
}

export const parserExamples = [
  "status",
  "request accessibility permission",
  "list windows",
  "list screens",
  "open vscode",
  "activate app com.microsoft.VSCode",
  "hide vscode",
  "hide this app",
  "unhide vscode",
  "show vscode",
  "minimize this window",
  "hide this window",
  "minimize terminal",
  "restore this window",
  "raise this window",
  "move vscode to the right",
  "shift this window left a little",
  "move this window to the other screen",
  "move chrome left a little",
  "move window ax:12345:0 x 120 y 90",
  "resize window ax:12345:0 width 900 height 700",
  "set frame window ax:12345:0 x 80 y 80 width 900 height 700"
];
