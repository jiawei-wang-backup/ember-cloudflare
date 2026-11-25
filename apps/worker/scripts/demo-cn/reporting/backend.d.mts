import type {IncomingMessage, ServerResponse} from "node:http";

export function createApi(options: {databaseUrl: string; deviceBindingToken?: string; lanEnrollment: boolean}): {
  close(): Promise<void>;
  handle(request: IncomingMessage, response: ServerResponse, url: URL, repositories?: string[] | "verified"): Promise<void>;
} | null;
