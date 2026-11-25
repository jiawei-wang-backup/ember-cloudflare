import {createReadStream, existsSync, readFileSync} from "node:fs";
import {request, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse} from "node:http";
import path from "node:path";
import {parseEnv} from "node:util";
import {timingSafeEqual} from "node:crypto";
import {createApi} from "./reporting/backend.mjs";

const dashboard = "/api/v1/dashboard";
const assets = new Map<string, readonly [string,string]>([
  ["/", ["assets/live-workspace.html", "text/html; charset=utf-8"]],
  ...["live-workspace", "live-projects", "icons"].map(file => ["/src/"+file+".js", ["src/"+file+".js", "text/javascript; charset=utf-8"]] as const),
  ...["styles", "workspace", "people", "live-workspace"].map(file => ["/assets/"+file+".css", ["assets/"+file+".css", "text/css; charset=utf-8"]] as const),
  ["/assets/favicon.svg", ["assets/favicon.svg", "image/svg+xml"]],
] as const);

const reads = new Set(["/api/v1/report-directory", "/api/v1/report-inventory", "/api/v1/report-cursor", "/api/v1/team-sessions", "/api/v1/team-edits"]);
const writes = new Set(["/api/v1/reports", "/api/v1/report-pulls", "/api/v1/report-statuses", "/api/v1/team-edits", "/api/v1/ember-device-binding"]);
const reply = (res: ServerResponse, status: number) => res.writeHead(status, {"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify({error:status === 401 ? "sign_in_required" : "reporting_unavailable"}));

function emberProjects(headers: IncomingHttpHeaders): Promise<{status: number; repositories: string[]}> {
  return new Promise((resolve, reject) => {
    const upstream = request({host:"127.0.0.1", port:8790, path:"/api/pulse/projects?source=ember", method:"GET",
      headers:{...headers, "accept-encoding":"identity"}, timeout:5000}, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () => {
        if (res.statusCode !== 200) {resolve({status:res.statusCode ?? 502,repositories:[]}); return;}
        try {
          const {projects} = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {projects:{repository:string}[]};
          resolve({status:200,repositories:[...new Set(projects.map(project => project.repository.toLowerCase()))]});
        } catch (error) {reject(error);}
      });
    });
    upstream.on("error", reject);
    upstream.on("timeout", () => upstream.destroy(new Error("Ember permission lookup timed out")));
    upstream.end();
  });
}

export function openReporting(state: string) {
  const config = path.join(state, "ember-reporting.env");
  if (!existsSync(config)) return null;
  const settings = parseEnv(readFileSync(config, "utf8"));
  const internalToken = settings.EMBER_REPORTING_INTERNAL_TOKEN ?? "";
  if (!/^[a-f0-9]{64}$/.test(internalToken)) throw new Error("Ember reporting internal token is not configured");
  const keyFile = path.join(state, "pulse-device-bind-token");
  const deviceBindingToken = existsSync(keyFile) ? readFileSync(keyFile,"utf8").trim() : undefined;
  const api = createApi({databaseUrl:settings.EMBER_REPORTING_DATABASE_URL ?? "",deviceBindingToken,lanEnrollment:true});
  if (!api) throw new Error("Ember reporting database is not configured");
  return {
    legacyPort: settings.EMBER_REPORTING_LEGACY_PORT === "4185" ? 4185 : null,
    internalToken,
    close: api.close,
    report(req: IncomingMessage, res: ServerResponse, url: URL, internal = false) {
      const supplied = Buffer.from(req.headers.authorization ?? "");
      const expected = Buffer.from("Bearer " + internalToken);
      const internalDashboard = internal && supplied.length === expected.length && timingSafeEqual(supplied,expected);
      const allowed = req.method === "GET" && reads.has(url.pathname) ||
        req.method === "POST" && writes.has(url.pathname) ||
        internalDashboard && req.method === "GET" && url.pathname === dashboard;
      if (!allowed) {reply(res,404); return;}
      res.setHeader("Cache-Control","no-store");
      void api.handle(req,res,url,"verified");
    },
    async view(req: IncomingMessage, res: ServerResponse, url: URL, headers: IncomingHttpHeaders) {
      if (!["GET","HEAD"].includes(req.method ?? "")) {reply(res,405); return;}
      const pathname = url.pathname.slice("/project-pulse".length);
      if (pathname === dashboard && req.method === "GET") {
        try {
          // Only a verified Ember browser session may retrieve reports for its own rooms.
          const {status,repositories} = await emberProjects(headers);
          if (status !== 200) {reply(res,status); return;}
          const source = new URL(url);
          source.pathname = pathname;
          res.setHeader("Cache-Control","private, no-store");
          await api.handle(req,res,source,repositories);
        } catch {reply(res,502);}
        return;
      }
      const asset = assets.get(pathname);
      if (!asset) {reply(res,404); return;}
      const [file,type] = asset;
      res.writeHead(200,{"Content-Type":type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
        "Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
      if (req.method === "HEAD") res.end();
      else createReadStream(path.join(import.meta.dirname,"reporting/public",file)).on("error",() => res.destroy()).pipe(res);
    },
  };
}
