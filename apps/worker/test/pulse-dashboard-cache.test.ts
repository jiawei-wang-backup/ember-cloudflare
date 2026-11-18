import {afterEach, expect, it, vi} from "vitest";
import {DashboardCache} from "../src/pulse-dashboard-cache";
import type {PulseDashboard} from "../src/pulse-dashboard";

afterEach(() => vi.restoreAllMocks());
const url = new URL("https://pulse-cache.example/api/v1/dashboard?days=7");
const dashboard = {projects: [], project_reports: [], workspace_states: [], project_usage: [], memberships: [], sessions: [], pulls: []} satisfies PulseDashboard;

it("returns immediately to a snapshot caller and shares the refresh across all six rooms", async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(resolve => {finish = resolve;}));
  const cache = new DashboardCache(), work: Promise<unknown>[] = [];
  for (let n = 0; n < 6; n++) await expect(cache.read(url, undefined, promise => work.push(promise))).rejects.toThrow("正在更新");
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(Response.json(dashboard));
  await Promise.all(work);
  expect(await cache.read(url)).toMatchObject({data: dashboard, stale: false});
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("backs off after a failure, permits explicit refresh and recovers without changing the source", async () => {
  let now = 100_000; vi.spyOn(Date, "now").mockImplementation(() => now);
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  const cache = new DashboardCache();
  await expect(cache.read(url)).rejects.toThrow("offline");
  await expect(cache.read(url)).rejects.toThrow("offline");
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValue(Response.json(dashboard));
  now += 1_000;
  expect(await cache.read(url, undefined, undefined, true)).toMatchObject({stale: false, capturedAt: now});
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.every(([source]) => String(source) === String(url))).toBe(true);
});

it("keeps the actual capture time when a refresh fails and retries after the cooldown", async () => {
  let now = 100_000; vi.spyOn(Date, "now").mockImplementation(() => now);
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(dashboard));
  const cache = new DashboardCache();
  const first = await cache.read(url, "token-a");
  now += 16_000; fetch.mockRejectedValue(new Error("offline"));
  const work: Promise<unknown>[] = [];
  expect(await cache.read(url, "token-a", promise => work.push(promise))).toEqual({...first, stale: true});
  await Promise.all(work);
  expect(await cache.read(url, "token-a")).toEqual({...first, stale: true});
  expect(fetch).toHaveBeenCalledTimes(2);
  now += 31_000; fetch.mockResolvedValue(Response.json(dashboard));
  expect(await cache.read(url, "token-a")).toMatchObject({stale: false, capturedAt: now});
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("separates credentials and date windows, including in-flight requests", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(dashboard));
  const cache = new DashboardCache();
  await cache.read(url, "a"); await cache.read(url, "b");
  await cache.read(new URL("?days=1", url), "a"); await cache.read(url, "a");
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls[1]![1]?.headers).toEqual({Authorization: "Bearer b"});
});
