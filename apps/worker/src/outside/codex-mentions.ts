import type { RoomId, UserId } from "@ember/protocol";

export interface CodexMention {
  roomId: RoomId;
  messageId: string;
  cursor: number;
}

interface Job extends CodexMention {
  done?: true;
  lease?: { id: string; connectionId: string; until: number };
}

const RETENTION_MS = 24 * 60 * 60_000;
const LEASE_MS = 4 * 60_000;
const HEARTBEAT_MS = 12_000;
const STREAM_MS = 75_000;
const prefixOf = (userId: UserId) => `codex-job:${userId}:`;
const keyOf = (userId: UserId, messageId: string) => prefixOf(userId) + messageId;
const cutoff = () => (Date.now() - RETENTION_MS).toString(36).padStart(10, "0");

export class CodexMentions {
  private readonly streams = new Map<UserId, Set<(job: CodexMention) => void>>();

  constructor(private readonly storage: DurableObjectStorage) {}

  async add(userId: UserId, roomId: RoomId, messageId: string): Promise<void> {
    if (messageId < cutoff()) return;
    const key = keyOf(userId, messageId);
    const event = await this.storage.transaction(async tx => {
      if (await tx.get(key)) return null;
      const cursor = (await tx.get<number>("codex-job-cursor") ?? 0) + 1;
      const job = {roomId, messageId, cursor};
      await tx.put({[key]: job, "codex-job-cursor": cursor});
      return job;
    });
    if (!event) return;
    for (const send of this.streams.get(userId) ?? []) send(event);
    const expired = await this.storage.list({
      start: prefixOf(userId), end: prefixOf(userId) + cutoff(), limit: 64,
    });
    if (expired.size) await this.storage.delete([...expired.keys()]);
  }

  async claim(userId: UserId, connectionId: string, roomId: RoomId, messageId: string) {
    const key = keyOf(userId, messageId);
    return this.storage.transaction(async tx => {
      const job = await tx.get<Job>(key);
      if (!job || job.roomId !== roomId || job.done || messageId < cutoff()) return {status: "gone" as const};
      const now = Date.now();
      if (job.lease && job.lease.until > now) {
        return {status: "busy" as const, retryAfter: Math.ceil((job.lease.until - now) / 1000)};
      }
      const lease = {id: crypto.randomUUID(), connectionId, until: now + LEASE_MS};
      await tx.put(key, {...job, lease});
      return {status: "claimed" as const, leaseId: lease.id};
    });
  }

  async stillQueued(userId: UserId, roomId: RoomId, messageId: string): Promise<boolean> {
    const job = await this.storage.get<Job>(keyOf(userId, messageId));
    return job?.roomId === roomId && !job.done && (!job.lease || job.lease.until <= Date.now());
  }

  async changeLease(userId: UserId, connectionId: string, roomId: RoomId, messageId: string, leaseId: string, action: "renew" | "complete" | "release"): Promise<boolean> {
    const key = keyOf(userId, messageId);
    return this.storage.transaction(async tx => {
      const job = await tx.get<Job>(key);
      if (!job || job.roomId !== roomId || job.lease?.id !== leaseId ||
          job.lease.connectionId !== connectionId || job.lease.until <= Date.now()) return false;
      const {lease, ...event} = job;
      await tx.put(key, action === "renew" ? {...event, lease: {...lease, until: Date.now() + LEASE_MS}}
        : action === "complete" ? {...event, done: true} : event);
      return true;
    });
  }

  stream(userId: UserId, roomIds: Set<RoomId>, after: number): Response {
    const subscribers = this.streams.get(userId) ?? new Set<(job: CodexMention) => void>();
    if (subscribers.size >= 8) return new Response(null, {status: 429});
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const body = new ReadableStream<Uint8Array>({
      start: controller => {
        const sent = new Set<string>();
        const write = (text: string) => controller.enqueue(encoder.encode(text));
        function send(job: CodexMention) {
          if (!subscribers.has(send) || !roomIds.has(job.roomId) || sent.has(job.messageId)) return;
          if ((controller.desiredSize ?? 0) <= 0) return stop();
          sent.add(job.messageId);
          const {cursor, roomId, messageId} = job;
          write(`id: ${cursor}\nevent: mention\ndata: ${JSON.stringify({roomId, messageId})}\n\n`);
        }
        const stop = () => {
          if (!subscribers.has(send)) return;
          cleanup();
          controller.close();
        };
        const heartbeat = setInterval(() => write(": heartbeat\n\n"), HEARTBEAT_MS);
        const expiry = setTimeout(stop, STREAM_MS);
        cleanup = () => {
          clearInterval(heartbeat);
          clearTimeout(expiry);
          subscribers.delete(send);
          if (!subscribers.size) this.streams.delete(userId);
        };
        subscribers.add(send);
        this.streams.set(userId, subscribers);
        write(": ready\n\n");
        // Pending jobs remain replayable even if their cursor was received before a client crashed.
        const prefix = prefixOf(userId);
        void this.storage.list<Job>({prefix, start: prefix + cutoff()}).then(jobs => {
          if (!subscribers.has(send)) return;
          const pending = [...jobs.values()].filter(job => !job.done).sort((a,b) =>
            Number(a.cursor > after) - Number(b.cursor > after) || a.cursor - b.cursor);
          for (const job of pending) send(job);
        }, stop);
      },
      cancel: () => cleanup(),
    }, {highWaterMark: 256});
    return new Response(body, {headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    }});
  }
}
