/**
 * Servidor HTTP estático só com Node (sem npx/npm).
 * Uso: node serve-static.mjs
 * Abra: http://localhost:8765/
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8765;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  const filePath = path.join(__dirname, path.normalize(p).replace(/^(\.\.(\/|\\|$))+/, ""));

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403).end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500).end(err.code === "ENOENT" ? "404" : "500");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Aberto em http://localhost:${PORT}/  (Ctrl+C para parar)`);
});
