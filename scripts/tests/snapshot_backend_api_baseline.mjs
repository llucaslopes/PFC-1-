#!/usr/bin/env node
// Snapshot baseline da API REST do backend.
//
// Sobe o backend in-process (`scripts/tests/lib/backend-api-harness.mjs`),
// dispara 10 requests deterministicos, normaliza as respostas e
// salva o resultado em `scripts/tests/baselines-backend-api/`.
//
// Uso:
//   node scripts/tests/snapshot_backend_api_baseline.mjs        # regenera fixtures
//   node scripts/tests/snapshot_backend_api_baseline.mjs --check # falha se houver drift

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { startBackendHarness, captureFixtures } from "./lib/backend-api-harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const baselineDir = path.join(here, "baselines-backend-api");
const fixturesDir = path.join(baselineDir, "fixtures");
const manifestPath = path.join(baselineDir, "manifest.json");

const checkMode = process.argv.includes("--check");

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function ensureBackendBuilt() {
  const distRoutes = path.resolve(
    here,
    "..",
    "..",
    "arquitetura-arduino-node-api",
    "backend",
    "dist",
    "http",
    "routes.js"
  );
  try {
    await fs.access(distRoutes);
  } catch {
    console.error(
      "[snapshot-backend-api] dist/ nao encontrado. Rode: npm --prefix arquitetura-arduino-node-api/backend run build"
    );
    process.exit(1);
  }
}

async function readIfExists(p) {
  try {
    return await fs.readFile(p, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function main() {
  await ensureBackendBuilt();
  await fs.mkdir(fixturesDir, { recursive: true });

  const harness = await startBackendHarness({ simulatorIntervalMs: 30 });
  let fixtures;
  try {
    fixtures = await captureFixtures(harness);
  } finally {
    await harness.close();
  }

  const manifest = {
    generatedAt: new Date().toISOString().slice(0, 10) + "T00:00:00.000Z",
    schemaVersion: 1,
    fixtureCount: fixtures.length,
    fixtures: []
  };

  let drift = false;
  for (const fx of fixtures) {
    const fileName = `${fx.name}.json`;
    const target = path.join(fixturesDir, fileName);
    const content = JSON.stringify(fx, null, 2) + "\n";
    const hash = sha256(Buffer.from(content));
    manifest.fixtures.push({
      name: fx.name,
      file: `fixtures/${fileName}`,
      method: fx.request.method,
      path: fx.request.path,
      sha256: hash,
      size: Buffer.byteLength(content)
    });

    if (checkMode) {
      const existing = await readIfExists(target);
      if (existing !== content) {
        drift = true;
        console.error(`DRIFT: ${fileName}`);
      }
    } else {
      await fs.writeFile(target, content, "utf8");
    }
  }
  // Hash manifest com fixtures ordenadas por nome (determinismo total)
  manifest.fixtures.sort((a, b) => a.name.localeCompare(b.name));
  const manifestContent = JSON.stringify(manifest, null, 2) + "\n";

  if (checkMode) {
    const existing = await readIfExists(manifestPath);
    // Para o --check, comparamos so as entradas (sha256/size) ignorando generatedAt.
    const oldParsed = existing ? JSON.parse(existing) : null;
    const newParsed = JSON.parse(manifestContent);
    const oldKey = oldParsed ? JSON.stringify(oldParsed.fixtures) : null;
    const newKey = JSON.stringify(newParsed.fixtures);
    if (oldKey !== newKey) {
      console.error("DRIFT: manifest.json (fixtures changed)");
      drift = true;
    }
    if (drift) {
      console.error(
        "Drift detectado. Para regenerar: node scripts/tests/snapshot_backend_api_baseline.mjs"
      );
      process.exit(2);
    }
    console.log(`OK: ${fixtures.length} fixtures identicas ao baseline.`);
  } else {
    await fs.writeFile(manifestPath, manifestContent, "utf8");
    console.log(
      `[baseline-backend-api] ${fixtures.length} fixtures escritas em ${path.relative(process.cwd(), fixturesDir)}.`
    );
    for (const entry of manifest.fixtures) {
      console.log(`  ${entry.name}  (${entry.size} bytes, ${entry.method} ${entry.path})`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
