import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import chat from "../api/ai-chat.js";
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const root = resolve("public");
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (["/api/ai-chat", "/api/mcassist"].includes(url.pathname)) {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 25000) {
          res.writeHead(413).end();
          return;
        }
      }
      req.body = body;
      res.status = (n) => {
        res.statusCode = n;
        return res;
      };
      res.json = (data) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(data));
      };
      await chat(req, res);
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
      res.setHeader(
        "Content-Type",
        types[extname(file)] || "application/octet-stream",
      );
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end("Not found");
    }
  })
  .listen(3000, "127.0.0.1", () =>
    console.log("Crew hub ready at http://127.0.0.1:3000"),
  );
