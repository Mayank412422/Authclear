import api from "./api";

const KEEP_ALIVE_INTERVAL_MS = 5 * 60 * 1000;
const ACTIVITY_EVENTS = ["scroll", "pointerdown", "keydown", "touchstart"];

export function startKeepAlive() {
  let lastRequestAt = 0;

  function requestKeepAlive() {
    const now = Date.now();

    if (now - lastRequestAt < KEEP_ALIVE_INTERVAL_MS) {
      return;
    }

    lastRequestAt = now;
    void api.get("/api/health", { timeout: 10000 }).catch(() => undefined);
  }

  ACTIVITY_EVENTS.forEach((eventName) => {
    window.addEventListener(eventName, requestKeepAlive, {
      passive: true,
    });
  });

  return () => {
    ACTIVITY_EVENTS.forEach((eventName) => {
      window.removeEventListener(eventName, requestKeepAlive);
    });
  };
}
