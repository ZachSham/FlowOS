function postError(message: string, stack?: string): void {
  chrome.runtime.sendMessage({
    type: "FLOWOS_PAGE_ERROR",
    payload: {
      message,
      stack,
      source: "window",
      url: window.location.href,
      capturedAt: new Date().toISOString()
    }
  });
}

window.addEventListener("error", (event) => {
  const message = event.message || "Unknown browser error";
  postError(message, event.error?.stack);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message =
    typeof reason === "string"
      ? reason
      : typeof reason?.message === "string"
        ? reason.message
        : "Unhandled promise rejection";

  const stack = typeof reason?.stack === "string" ? reason.stack : undefined;
  postError(message, stack);
});
