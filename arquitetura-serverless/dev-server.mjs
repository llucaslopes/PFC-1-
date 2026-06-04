// Dev-server local da arquitetura A3 que monta os handlers em api/**.ts
// como rotas HTTP normais. Existe pra contornar o `vercel dev`, que
// pede `vercel link` interativo e quebra fluxo de smoke test em CI ou
// em maquina nova clonada pelo orientador. Para medir cold start
// real e custo, deploy na Vercel continua sendo necessario; este
// wrapper substitui apenas o ambiente de desenvolvimento, nao o de
// producao.

import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readdirSync, statSync } from "node:fs";

import { register } from "tsx/esm/api";

const here = dirname(fileURLToPath(import.meta.url));

// Registramos o loader tsx uma unica vez no boot. Em loadHandlers as
// rotas sao importadas via tsxLoader.import(), o que evita o overhead
// (alto) de spawn de tsImport por arquivo a cada hot reload.
const tsxLoader = register({ namespace: "pfc1-serverless-dev" });

function parseCliArgs(argv) {
  const args = { port: 3001 };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--port" && argv[i + 1]) {
      args.port = Number(argv[i + 1]);
      i++;
    } else if (tok === "--help") {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Uso: node dev-server.mjs [--port 3001]

Sobe um servidor HTTP local que monta os handlers em api/**.ts como
rotas REST, replicando o comportamento da Vercel para uso em campanhas
preliminares com --source simulator-http e em smoke-tests.

NAO substitui 'vercel dev' nem deploy de producao para coleta oficial
de cold-start ou estimativa de custo da A3 -- apenas elimina a
necessidade de 'vercel link' para sanity-check e ambiente de
desenvolvimento.`);
}

function* walkApiFiles(dir, prefix = "/api") {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkApiFiles(full, `${prefix}/${entry}`);
    } else if (entry.endsWith(".ts")) {
      const name = entry.replace(/\.ts$/, "");
      const route =
        name === "index" ? prefix : `${prefix}/${name}`;
      yield { filePath: full, route };
    }
  }
}

async function loadHandlers() {
  const apiDir = join(here, "api");
  if (!existsSync(apiDir)) {
    throw new Error(`Diretorio api/ nao encontrado em ${apiDir}`);
  }
  const handlers = [];
  for (const { filePath, route } of walkApiFiles(apiDir)) {
    const url = pathToFileURL(filePath).href;
    const mod = await tsxLoader.import(url, import.meta.url);
    if (typeof mod.default !== "function") {
      console.warn(`[dev-server] ${route} sem default export; pulando.`);
      continue;
    }
    handlers.push({ route, handler: mod.default });
  }
  // Rotas mais longas primeiro para que /api/foo/bar case antes de
  // /api/foo, replicando a precedencia que a Vercel aplica.
  handlers.sort((a, b) => b.route.length - a.route.length);
  return handlers;
}

function parseQuery(urlObj) {
  const out = {};
  for (const [k, v] of urlObj.searchParams.entries()) {
    out[k] = v;
  }
  return out;
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const limit = 25 * 1024 * 1024;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      const ct = (req.headers["content-type"] || "").toLowerCase();
      if (!ct.includes("application/json")) {
        return resolve(raw);
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function buildVercelReq(nodeReq, body) {
  const urlObj = new URL(nodeReq.url, "http://localhost");
  return {
    method: nodeReq.method,
    url: nodeReq.url,
    headers: { ...nodeReq.headers },
    query: parseQuery(urlObj),
    body,
  };
}

function buildVercelRes(nodeRes) {
  let statusCode = 200;
  const res = {
    setHeader(k, v) {
      nodeRes.setHeader(k, v);
      return res;
    },
    status(code) {
      statusCode = code;
      nodeRes.statusCode = code;
      return res;
    },
    json(payload) {
      if (!nodeRes.hasHeader("content-type")) {
        nodeRes.setHeader("content-type", "application/json");
      }
      nodeRes.statusCode = statusCode;
      nodeRes.end(JSON.stringify(payload));
      return res;
    },
    send(payload) {
      nodeRes.statusCode = statusCode;
      if (typeof payload === "object" && payload !== null) {
        if (!nodeRes.hasHeader("content-type")) {
          nodeRes.setHeader("content-type", "application/json");
        }
        nodeRes.end(JSON.stringify(payload));
      } else {
        nodeRes.end(payload == null ? "" : String(payload));
      }
      return res;
    },
    end(payload) {
      nodeRes.statusCode = statusCode;
      nodeRes.end(payload);
      return res;
    },
    get statusCode() {
      return statusCode;
    },
  };
  return res;
}

function matchHandler(handlers, pathname) {
  for (const h of handlers) {
    if (pathname === h.route) return h;
  }
  return null;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const port = Number.isInteger(args.port) && args.port > 0 ? args.port : 3001;
  const handlers = await loadHandlers();
  console.log(`[dev-server] handlers carregados:`);
  for (const h of handlers) console.log(`  ${h.route}`);

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, "http://localhost");
    const pathname = urlObj.pathname;

    // CORS espelha o do backend Node para que o mesmo dashboard
    // estatico consiga falar com A1/A2 e A3 sem ajustes adicionais.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Api-Key");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const match = matchHandler(handlers, pathname);
    if (!match) {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "not_found", path: pathname }));
      return;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "invalid_body", message: err.message }));
      return;
    }

    const vercelReq = buildVercelReq(req, body);
    const vercelRes = buildVercelRes(res);

    try {
      await match.handler(vercelReq, vercelRes);
    } catch (err) {
      console.error(`[dev-server] handler ${match.route} falhou:`, err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "handler_error", message: err.message }));
      }
    }
  });

  server.listen(port, () => {
    console.log(`[dev-server] serverless dev (sem vercel CLI) em http://localhost:${port}/api/`);
    console.log("[dev-server] storage: shim em memoria (KV) se KV_REST_API_URL nao estiver setada.");
  });

  const shutdown = () => {
    console.log("[dev-server] encerrando...");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(`[dev-server] ERRO: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
