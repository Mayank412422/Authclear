import { vi } from "vitest";

import api from "../api";
import { startKeepAlive } from "../keepAlive";

vi.mock("../api", () => ({
  default: {
    get: vi.fn().mockResolvedValue({}),
  },
}));

afterEach(() => {
  vi.useRealTimers();
  api.get.mockClear();
});

test("limits activity health checks to one request every five minutes", () => {
  vi.useFakeTimers();
  const stopKeepAlive = startKeepAlive();

  window.dispatchEvent(new Event("scroll"));
  window.dispatchEvent(new Event("scroll"));
  window.dispatchEvent(new Event("pointerdown"));

  expect(api.get).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledWith("/api/health", { timeout: 10000 });

  vi.advanceTimersByTime(5 * 60 * 1000);
  window.dispatchEvent(new Event("scroll"));
  expect(api.get).toHaveBeenCalledTimes(2);

  stopKeepAlive();
  window.dispatchEvent(new Event("scroll"));
  expect(api.get).toHaveBeenCalledTimes(2);
});
