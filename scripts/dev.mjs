import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";

// Local development server.
//   PORT      – port to listen on (default 3000)
//   DEV_ROOT  – directory to serve static files from (default "public", the
//               allowlisted build output). Use DEV_ROOT=. to serve source files
//               directly while developing.
// Every /api/<name> request is routed to the default export of api/<name>.js
// with small Vercel-style req/res helpers, so all serverless functions can be
// exercised locally.
const port = Number(process.env.PORT) || 3000;
const root = resolve(process.env.DEV_ROOT || "public");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};
const handlers = new Map();
async function apiHandler(name) {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  if (!handlers.has(name)) {
    const file = resolve("api", name + ".js");
    try {
      await stat(file);
    } catch {
      handlers.set(name, null);
      return null;
    }
    const mod = await import(pathToFileURL(file).href);
    handlers.set(name, mod.default || null);
  }
  return handlers.get(name);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const api = url.pathname.match(/^\/api\/([a-z0-9-]+)\/?$/);
    if (api) {
      const handler = await apiHandler(api[1]).catch((error) => {
        console.error("Could not load API handler", api[1], error);
        return null;
      });
      if (!handler) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }
      let body = "";
      try {
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1_000_000) {
            res.writeHead(413).end();
            return;
          }
        }
      } catch {
        // The client went away mid-request (ECONNRESET): nothing to answer,
        // and it must not crash the dev server for everyone else.
        return;
      }
      try {
        req.body =
          body && String(req.headers["content-type"] || "").includes("json")
            ? JSON.parse(body)
            : body;
      } catch {
        req.body = body;
      }
      req.query = Object.fromEntries(url.searchParams);
      res.status = (n) => {
        res.statusCode = n;
        return res;
      };
      res.json = (data) => {
        if (!res.headersSent) res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(data));
        return res;
      };
      res.send = (data) => {
        res.end(typeof data === "string" ? data : JSON.stringify(data));
        return res;
      };
      try {
        await handler(req, res);
      } catch (error) {
        console.error("API handler crashed", api[1], error);
        if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Server error" }));
      }
      return;
    }
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    if (!extname(path)) path += ".html";
    const file = resolve(root, "." + decodeURIComponent(path));
    if (!file.startsWith(root + "\\") && !file.startsWith(root + "/")) {
      res.writeHead(403).end();
      return;
    }
    try {
      const data = await readFile(file);
      res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      res.end(data);
    } catch {
      res.writeHead(404).end("Not found");
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`Crew hub ready at http://127.0.0.1:${port} (serving ${root})`),
  );
