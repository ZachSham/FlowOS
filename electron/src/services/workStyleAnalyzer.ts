import type { AppSnapshot } from "@flowos/shared";
import type { TrackingEventRecord } from "./trackingSession.js";

// ─── App category registry ────────────────────────────────────────────────────

export type AppCategory =
  | "ide"
  | "terminal"
  | "browser"
  | "notes"
  | "code-support"
  | "communication"
  | "media"
  | "design"
  | "productivity"
  | "unknown";

export type WindowRole =
  | "primary-focus"
  | "secondary-focus"
  | "support"
  | "grounding"
  | "background"
  | "distractor";

export type WorkMode = "coding" | "research" | "mixed" | "unclear";

const CATEGORY_MAP: Record<string, AppCategory> = {
  // IDEs
  "com.todesktop.230313mzl4w4u92": "ide",   // Cursor
  "com.microsoft.VSCode": "ide",
  "com.microsoft.VSCodeInsiders": "ide",
  "com.apple.dt.Xcode": "ide",
  "com.jetbrains.intellij": "ide",
  "com.jetbrains.webstorm": "ide",
  "com.jetbrains.pycharm": "ide",
  "com.jetbrains.goland": "ide",
  "com.jetbrains.rubymine": "ide",
  "com.jetbrains.clion": "ide",
  "com.jetbrains.rider": "ide",
  "com.sublimetext.4": "ide",
  "com.sublimetext.3": "ide",
  "com.panic.Nova": "ide",
  "com.barebones.bbedit": "ide",
  "org.gnu.Emacs": "ide",
  "org.macvim-dev.macvim": "ide",
  "com.microsoft.Winget": "ide",
  "dev.zed.Zed": "ide",
  "com.windsurf.desktop": "ide",
  // Terminals
  "com.apple.Terminal": "terminal",
  "com.googlecode.iterm2": "terminal",
  "dev.warp.desktop": "terminal",
  "io.alacritty": "terminal",
  "co.zeit.hyper": "terminal",
  "net.kovidgoyal.kitty": "terminal",
  // Browsers
  "com.google.Chrome": "browser",
  "com.google.Chrome.canary": "browser",
  "org.mozilla.firefox": "browser",
  "com.apple.Safari": "browser",
  "company.thebrowser.Browser": "browser",   // Arc
  "com.brave.Browser": "browser",
  "com.microsoft.edgemac": "browser",
  "com.operasoftware.Opera": "browser",
  // Notes / Writing
  "com.apple.Notes": "notes",
  "net.shinyfrog.bear": "notes",
  "md.obsidian": "notes",
  "notion.id": "notes",
  "com.notion.id": "notes",
  "com.craft.desktopeditor": "notes",
  "com.ulyssesapp.mac": "notes",
  "pro.writer.mac": "notes",         // iA Writer
  "com.reederapp.5.macOS": "notes",
  "com.fivefilters.rss": "notes",
  // Code support
  "com.github.GitHubClient": "code-support",
  "com.openai.codex": "code-support",
  "com.todesktop.codex": "code-support",
  "com.atlassian.sourcetree": "code-support",
  "com.fournova.Tower3": "code-support",
  "com.fork-dev.Fork": "code-support",
  "com.kapeli.dashdoc": "code-support",  // Dash
  "com.blacktree.Quicksilver": "code-support",
  "com.docker.docker": "code-support",
  "com.postmanlabs.mac": "code-support",
  "com.proxyman.NSProxy": "code-support",
  // Communication
  "com.tinyspeck.slackmacgap": "communication",
  "com.hnc.Discord": "communication",
  "com.microsoft.teams2": "communication",
  "com.microsoft.teams": "communication",
  "us.zoom.xos": "communication",
  "org.whispersystems.signal-desktop": "communication",
  "ru.keepcoder.Telegram": "communication",
  "com.apple.Mail": "communication",
  "com.apple.iChat": "communication",
  "com.apple.MobileSMS": "communication",
  "com.mimestream.Mimestream": "communication",
  "com.superhuman.Superhuman": "communication",
  // Media
  "com.spotify.client": "media",
  "com.apple.Music": "media",
  "org.videolan.vlc": "media",
  "com.apple.QuickTimePlayerX": "media",
  "com.apple.TV": "media",
  // Design
  "com.figma.desktop": "design",
  "com.bohemiancoding.sketch3": "design",
  "com.adobe.Photoshop": "design",
  "com.adobe.illustrator": "design",
  "com.adobe.XD": "design",
  "com.framer.desktop": "design",
  "com.canva.CanvaDesktop": "design",
  "com.zeplin.app": "design",
  // Productivity
  "com.apple.Calendar": "productivity",
  "com.apple.reminders": "productivity",
  "com.culturedcode.ThingsMac": "productivity",
  "com.todoist.mac.Todoist": "productivity",
  "com.flexibits.fantastical2.mac": "productivity",
  "com.agiletortoise.Drafts-OSX": "productivity",
  "com.superhumanapp.superhuman": "productivity",
};

// Score weights per event type
const EVENT_WEIGHTS: Record<string, number> = {
  "app.activated": 1.0,
  "app.launched": 0.5,
  "app.deactivated": 0.0,
  "app.terminated": 0.0,
};

// Exponential decay half-life: 5 minutes. Events older than ~25 min have <3% weight.
const HALF_LIFE_MS = 5 * 60 * 1000;
const LN2 = Math.LN2;

// How many consecutive activations within this window = "burst" (user is actively using this)
const BURST_WINDOW_MS = 90_000;   // 90 seconds
const BURST_THRESHOLD = 3;
const BURST_MULTIPLIER = 1.6;

// Minimum score to consider an app "active" in any role
const MIN_ACTIVE_SCORE = 0.05;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScoredApp {
  bundleId: string;
  name: string;
  category: AppCategory;
  score: number;
  role: WindowRole;
  isRunning: boolean;
  isHidden: boolean;
}

export interface WorkStyleAnalysis {
  mode: WorkMode;
  confidence: number;           // 0–1
  codingScore: number;
  researchScore: number;
  primaryApp: ScoredApp | null;
  secondaryApp: ScoredApp | null;
  appsToKeep: ScoredApp[];      // tile/split these
  appsToMinimize: ScoredApp[];  // get out of the way but recoverable
  appsToHide: ScoredApp[];      // full hide
  signals: string[];            // human-readable explanation of the decision
}

// ─── Core algorithm ───────────────────────────────────────────────────────────

function decay(ageMs: number): number {
  return Math.exp((-ageMs * LN2) / HALF_LIFE_MS);
}

function categorizeApp(bundleId: string): AppCategory {
  const exact = CATEGORY_MAP[bundleId];
  if (exact) return exact;

  // Heuristic fallbacks for unknown bundleIds
  const id = bundleId.toLowerCase();
  if (id.includes("jetbrains")) return "ide";
  if (id.includes("terminal") || id.includes("iterm") || id.includes("warp")) return "terminal";
  if (id.includes("chrome") || id.includes("firefox") || id.includes("safari") || id.includes("browser")) return "browser";
  if (id.includes("notion") || id.includes("obsidian") || id.includes("bear") || id.includes("notes")) return "notes";
  if (id.includes("slack") || id.includes("discord") || id.includes("zoom") || id.includes("teams") || id.includes("mail")) return "communication";
  if (id.includes("spotify") || id.includes("music") || id.includes("vlc")) return "media";
  if (id.includes("figma") || id.includes("sketch") || id.includes("adobe") || id.includes("design")) return "design";

  return "unknown";
}

function scoreApps(
  events: TrackingEventRecord[],
  nowMs: number
): Map<string, { bundleId: string; name: string; score: number; activationTimes: number[] }> {
  const scores = new Map<string, { bundleId: string; name: string; score: number; activationTimes: number[] }>();

  for (const event of events) {
    const weight = EVENT_WEIGHTS[event.event] ?? 0;
    if (weight === 0) continue;

    const payload = event.payload as { app?: { bundleId?: string; name?: string } };
    const bundleId = payload.app?.bundleId;
    const name = payload.app?.name ?? bundleId ?? "Unknown";
    if (!bundleId) continue;

    const eventMs = new Date(event.timestamp).getTime();
    const ageMs = Math.max(0, nowMs - eventMs);
    const contribution = weight * decay(ageMs);

    const existing = scores.get(bundleId) ?? { bundleId, name, score: 0, activationTimes: [] };
    existing.score += contribution;

    if (event.event === "app.activated") {
      existing.activationTimes.push(eventMs);
    }

    scores.set(bundleId, existing);
  }

  // Apply burst bonus: 3+ activations within 90s → multiply score
  for (const [bundleId, entry] of scores) {
    const times = entry.activationTimes.sort((a, b) => b - a); // newest first
    let burstCount = 0;
    for (let i = 0; i < times.length - 1; i++) {
      const gap = (times[i] ?? 0) - (times[i + 1] ?? 0);
      if (gap < BURST_WINDOW_MS) burstCount++;
      else break;
    }
    if (burstCount >= BURST_THRESHOLD) {
      entry.score *= BURST_MULTIPLIER;
      scores.set(bundleId, entry);
    }
  }

  return scores;
}

function categoryWeight(category: AppCategory, signal: "coding" | "research"): number {
  if (signal === "coding") {
    switch (category) {
      case "ide": return 2.0;
      case "terminal": return 1.5;
      case "code-support": return 1.2;
      case "browser": return 0.3;        // browsers used in coding get partial credit
      case "notes": return 0.2;
      case "design": return 0.3;
      default: return 0;
    }
  } else {
    switch (category) {
      case "browser": return 2.0;
      case "notes": return 1.8;
      case "productivity": return 0.6;
      case "ide": return 0.1;            // IDE open during research = mild coding signal
      case "terminal": return 0.1;
      default: return 0;
    }
  }
}

function assignRole(
  category: AppCategory,
  mode: WorkMode,
  isPrimary: boolean,
  isSecondary: boolean
): WindowRole {
  if (isPrimary) return "primary-focus";
  if (isSecondary) return "secondary-focus";

  switch (mode) {
    case "coding":
      switch (category) {
        case "ide": return "support";
        case "terminal": return "support";
        case "code-support": return "support";
        case "browser": return "background";
        case "notes": return "background";
        case "media": return "distractor";
        case "communication": return "distractor";
        case "design": return "background";
        default: return "distractor";
      }
    case "research":
      switch (category) {
        case "browser": return "support";
        case "notes": return "support";
        case "media": return "grounding";
        case "productivity": return "background";
        case "ide": return "distractor";
        case "terminal": return "distractor";
        case "communication": return "distractor";
        case "design": return "background";
        default: return "distractor";
      }
    case "mixed":
      if (category === "ide" || category === "browser" || category === "terminal" || category === "notes") {
        return "support";
      }
      return category === "communication" || category === "media" ? "distractor" : "background";
    default:
      return "background";
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function analyzeWorkStyle(
  events: TrackingEventRecord[],
  runningApps: AppSnapshot[],
  nowMs = Date.now()
): WorkStyleAnalysis {
  const appScores = scoreApps(events, nowMs);

  // Build a unified list: scored apps + running apps not in events
  const seenBundleIds = new Set<string>();
  const candidates: Array<{
    bundleId: string;
    name: string;
    category: AppCategory;
    score: number;
    isRunning: boolean;
    isHidden: boolean;
  }> = [];

  for (const [bundleId, entry] of appScores) {
    seenBundleIds.add(bundleId);
    const runningApp = runningApps.find((a) => a.bundleId === bundleId);
    candidates.push({
      bundleId,
      name: entry.name,
      category: categorizeApp(bundleId),
      score: entry.score,
      isRunning: Boolean(runningApp),
      isHidden: runningApp?.isHidden ?? false,
    });
  }

  // Add running apps with zero score (they're present but not used recently)
  for (const app of runningApps) {
    if (!seenBundleIds.has(app.bundleId)) {
      candidates.push({
        bundleId: app.bundleId,
        name: app.name,
        category: categorizeApp(app.bundleId),
        score: 0,
        isRunning: true,
        isHidden: app.isHidden,
      });
    }
  }

  // Compute signal scores
  let codingScore = 0;
  let researchScore = 0;

  for (const c of candidates) {
    codingScore += c.score * categoryWeight(c.category, "coding");
    researchScore += c.score * categoryWeight(c.category, "research");
  }

  // Determine mode and confidence
  const total = codingScore + researchScore;
  let mode: WorkMode;
  let confidence: number;

  if (total < 0.1) {
    mode = "unclear";
    confidence = 0;
  } else if (codingScore > researchScore * 1.5) {
    mode = "coding";
    confidence = Math.min(1, codingScore / total);
  } else if (researchScore > codingScore * 1.5) {
    mode = "research";
    confidence = Math.min(1, researchScore / total);
  } else {
    mode = "mixed";
    confidence = 0.5;
  }

  // Sort candidates by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Pick primary and secondary apps based on mode
  let primaryApp: typeof candidates[0] | undefined;
  let secondaryApp: typeof candidates[0] | undefined;

  if (mode === "coding" || mode === "mixed") {
    primaryApp = candidates.find((c) => c.category === "ide" && c.isRunning && c.score > MIN_ACTIVE_SCORE)
      ?? candidates.find((c) => c.category === "ide" && c.isRunning);
    secondaryApp = candidates.find(
      (c) => c !== primaryApp && (c.category === "terminal" || c.category === "code-support") && c.isRunning
    ) ?? candidates.find((c) => c !== primaryApp && c.category === "terminal" && c.isRunning);
  }

  if (mode === "research" || (mode === "mixed" && !primaryApp)) {
    primaryApp = candidates.find((c) => c.category === "browser" && c.isRunning && c.score > MIN_ACTIVE_SCORE)
      ?? candidates.find((c) => c.category === "browser" && c.isRunning);
    secondaryApp = candidates.find(
      (c) => c !== primaryApp && c.category === "notes" && c.isRunning
    );
  }

  if (mode === "unclear") {
    // Fall back to highest-scoring running app
    primaryApp = candidates.find((c) => c.isRunning && c.score > MIN_ACTIVE_SCORE);
    secondaryApp = candidates.find((c) => c !== primaryApp && c.isRunning && c.score > MIN_ACTIVE_SCORE);
  }

  const primaryBundleId = primaryApp?.bundleId;
  const secondaryBundleId = secondaryApp?.bundleId;

  // Assign roles and partition apps
  const scoredApps: ScoredApp[] = candidates
    .filter((c) => c.isRunning)
    .map((c) => ({
      ...c,
      role: assignRole(
        c.category,
        mode,
        c.bundleId === primaryBundleId,
        c.bundleId === secondaryBundleId
      ),
    }));

  const appsToKeep = scoredApps.filter(
    (a) => a.role === "primary-focus" || a.role === "secondary-focus" || a.role === "support"
  );
  const appsToMinimize = scoredApps.filter((a) => a.role === "background");
  const appsToHide = scoredApps.filter((a) => a.role === "distractor" || a.role === "grounding");

  // Build human-readable signals
  const signals: string[] = [];
  const topCoding = candidates
    .filter((c) => c.category === "ide" || c.category === "terminal" || c.category === "code-support")
    .filter((c) => c.score > MIN_ACTIVE_SCORE)
    .slice(0, 2)
    .map((c) => `${c.name} (score ${c.score.toFixed(2)})`);
  const topResearch = candidates
    .filter((c) => c.category === "browser" || c.category === "notes")
    .filter((c) => c.score > MIN_ACTIVE_SCORE)
    .slice(0, 2)
    .map((c) => `${c.name} (score ${c.score.toFixed(2)})`);

  if (topCoding.length > 0) signals.push(`Coding signals: ${topCoding.join(", ")}`);
  if (topResearch.length > 0) signals.push(`Research signals: ${topResearch.join(", ")}`);
  signals.push(`Mode: ${mode} (confidence ${(confidence * 100).toFixed(0)}%)`);
  if (primaryApp) signals.push(`Primary: ${primaryApp.name}`);
  if (secondaryApp) signals.push(`Secondary: ${secondaryApp.name}`);

  return {
    mode,
    confidence,
    codingScore,
    researchScore,
    primaryApp: primaryApp ? scoredApps.find((a) => a.bundleId === primaryApp!.bundleId) ?? null : null,
    secondaryApp: secondaryApp ? scoredApps.find((a) => a.bundleId === secondaryApp!.bundleId) ?? null : null,
    appsToKeep,
    appsToMinimize,
    appsToHide,
    signals,
  };
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

export function buildAnalysisContext(analysis: WorkStyleAnalysis): string {
  if (analysis.mode === "unclear") {
    return "Work style analysis: insufficient tracking data to determine mode. Proceed with best-effort layout.";
  }

  const lines: string[] = [
    `Work style analysis (pre-computed, use this as primary signal):`,
    `  Inferred mode: ${analysis.mode} (confidence: ${(analysis.confidence * 100).toFixed(0)}%)`,
    `  Coding signal score: ${analysis.codingScore.toFixed(2)}, Research signal score: ${analysis.researchScore.toFixed(2)}`,
  ];

  if (analysis.primaryApp) {
    lines.push(`  PRIMARY app (tile on primary display): ${analysis.primaryApp.name} [${analysis.primaryApp.bundleId}]`);
  }
  if (analysis.secondaryApp) {
    lines.push(`  SECONDARY app (tile alongside primary): ${analysis.secondaryApp.name} [${analysis.secondaryApp.bundleId}]`);
  }

  if (analysis.appsToKeep.length > 0) {
    const support = analysis.appsToKeep.filter((a) => a.role === "support");
    if (support.length > 0) {
      lines.push(`  SUPPORT apps (keep visible, secondary display or minimized if no room): ${support.map((a) => `${a.name} [${a.bundleId}]`).join(", ")}`);
    }
  }

  if (analysis.appsToHide.length > 0) {
    const grounding = analysis.appsToHide.filter((a) => a.role === "grounding");
    const distractors = analysis.appsToHide.filter((a) => a.role === "distractor");
    if (grounding.length > 0) {
      lines.push(`  GROUNDING apps (move to second display if present, or minimize): ${grounding.map((a) => `${a.name} [${a.bundleId}]`).join(", ")}`);
    }
    if (distractors.length > 0) {
      lines.push(`  DISTRACTOR apps (hide with hide_app): ${distractors.map((a) => `${a.name} [${a.bundleId}]`).join(", ")}`);
    }
  }

  if (analysis.appsToMinimize.length > 0) {
    lines.push(`  BACKGROUND apps (minimize): ${analysis.appsToMinimize.map((a) => `${a.name} [${a.bundleId}]`).join(", ")}`);
  }

  lines.push(`  Signals: ${analysis.signals.join(" | ")}`);

  return lines.join("\n");
}
