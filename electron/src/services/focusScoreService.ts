// Computes a real-time focus score (0–100) from app activation events.
//
// Score = 100 − clamp(switchesPerMinute × 10, 0, 100)
// A developer doing deep work switches ~0–2 apps/min → score 80–100.
// Fragmented work (Slack, email, browser constantly) → 6+ switches/min → score <40.

const WINDOW_MS = 60_000;       // 1-minute rolling window
const ALERT_THRESHOLD = 40;     // below this → emit fragmentation alert
const HYSTERESIS = 15;          // score must recover by this much before alerting again
const MIN_EVENTS_FOR_ALERT = 3; // need at least this many switches before alerting

export interface FocusScoreUpdate {
  score: number;        // 0–100
  switchesPerMin: number;
}

interface FocusScoreOptions {
  onScoreUpdate: (update: FocusScoreUpdate) => void;
  onFragmentationAlert: () => void;
}

export interface FocusScoreService {
  recordSwitch(bundleId: string): void;
  getScore(): number;
  dispose(): void;
}

export function createFocusScoreService(options: FocusScoreOptions): FocusScoreService {
  const switchTimestamps: number[] = [];
  let lastAlertScore = 101; // tracks score at last alert so we apply hysteresis

  function pruneWindow(now: number) {
    const cutoff = now - WINDOW_MS;
    while (switchTimestamps.length > 0 && switchTimestamps[0]! < cutoff) {
      switchTimestamps.shift();
    }
  }

  function computeScore(now: number): FocusScoreUpdate {
    pruneWindow(now);
    const switchesPerMin = switchTimestamps.length; // count in last 60s
    const score = Math.max(0, Math.min(100, 100 - switchesPerMin * 10));
    return { score, switchesPerMin };
  }

  function recordSwitch(bundleId: string): void {
    // Ignore rapid duplicate switches to the same app
    const now = Date.now();
    switchTimestamps.push(now);

    const update = computeScore(now);
    options.onScoreUpdate(update);

    const enoughData = switchTimestamps.length >= MIN_EVENTS_FOR_ALERT;
    const scoreLow = update.score < ALERT_THRESHOLD;
    // Only alert if score was last seen above the threshold (i.e., we recovered since last alert)
    const notRecentlyAlerted = lastAlertScore > ALERT_THRESHOLD;

    if (enoughData && scoreLow && notRecentlyAlerted) {
      lastAlertScore = update.score;
      options.onFragmentationAlert();
    } else if (update.score > ALERT_THRESHOLD + HYSTERESIS) {
      // Score recovered above threshold + hysteresis — allow next dip to alert
      lastAlertScore = 101;
    }
  }

  function getScore(): number {
    return computeScore(Date.now()).score;
  }

  function dispose(): void {
    switchTimestamps.length = 0;
  }

  return { recordSwitch, getScore, dispose };
}
