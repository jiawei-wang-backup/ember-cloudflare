import type {PulseDashboard} from "./pulse-dashboard";

export type BackgroundWork = (work: Promise<unknown>) => void;
interface DashboardValue {data: PulseDashboard; capturedAt: number; stale: boolean}
interface Entry {until: number; value?: DashboardValue; pending?: Promise<DashboardValue>; error?: unknown}

/** Shared upstream reads, never room permissions or the room-scoped response. */
export class DashboardCache {
  private entries = new Map<string, Entry>();

  async read(url: URL, token?: string, background?: BackgroundWork, refresh = false): Promise<DashboardValue> {
    const key = `${url}|${token || ""}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {until: 0};
      this.entries.set(key, entry);
      if (this.entries.size > 12) this.entries.delete(this.entries.keys().next().value!);
    }
    if (!refresh && entry.until > Date.now()) {
      if (entry.value) return entry.value;
      throw entry.error;
    }
    if (!entry.pending) {
      const current = entry;
      entry.pending = fetchDashboard(url, token).then(data => {
        current.value = {data, capturedAt: Date.now(), stale: false};
        current.until = Date.now() + 15_000;
        current.error = undefined;
        return current.value;
      }).catch(error => {
        current.error = error;
        current.until = Date.now() + 30_000;
        if (current.value) current.value = {...current.value, stale: true};
        throw error;
      }).finally(() => {current.pending = undefined;});
    }
    // A validated local snapshot can render while waitUntil keeps the live refresh alive.
    if (background && !refresh) {
      background(entry.pending.catch(() => {}));
      if (entry.value) return {...entry.value, stale: true};
      throw new Error("Project Pulse 正在更新");
    }
    try {return await entry.pending;}
    catch (error) {if (entry.value) return entry.value; throw error;}
  }
}

export async function fetchDashboard(url: URL, token?: string): Promise<PulseDashboard> {
  const response = await fetch(url, {headers: token ? {Authorization: `Bearer ${token}`} : {}, redirect: "manual", signal: AbortSignal.timeout(8000)});
  if (!response.ok) throw new Error(`Project Pulse 返回 ${response.status}`);
  return await response.json() as PulseDashboard;
}
