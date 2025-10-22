// Security regression: sensitive bundle/config files are created with private
// POSIX modes (0700 dirs / 0600 files), and abandoned pending-import staging is
// swept at startup. Mode assertions are POSIX-only (Windows ignores chmod bits),
// so they are skipped on win32; the cleanup assertion runs everywhere.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../../server/index.js";
import { cleanupStalePendingImports } from "../../server/routes/import.js";

const POSIX = process.platform !== "win32";
let tmpProjects, tmpConfig, srv, base, slug;

before(async () => {
  tmpProjects = await mkdtemp(path.join(os.tmpdir(), "nexus-iq-modes-"));
  tmpConfig = await mkdtemp(path.join(os.tmpdir(), "nexus-iq-modes-cfg-"));
  process.env.NEXUS_IQ_PROJECTS_DIR = tmpProjects;
  process.env.NEXUS_IQ_CONFIG_DIR = tmpConfig;
  srv = await startServer({ port: 0 });
  base = `http://127.0.0.1:${srv.port}`;
  const created = await (await fetch(`${base}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Modes Probe", privacyMode: "open" }),
  })).json();
  slug = created.data.slug;
});

after(async () => {
  await srv?.close?.();
  delete process.env.NEXUS_IQ_PROJECTS_DIR;
  delete process.env.NEXUS_IQ_CONFIG_DIR;
  await rm(tmpProjects, { recursive: true, force: true }).catch(() => {});
  await rm(tmpConfig, { recursive: true, force: true }).catch(() => {});
});

const mode = async (p) => (await stat(p)).mode & 0o777;

test("a new project bundle is created 0700 dir / 0600 project.json", { skip: !POSIX }, async () => {
  assert.equal(await mode(path.join(tmpProjects, slug)), 0o700, "project dir must be owner-only");
  assert.equal(await mode(path.join(tmpProjects, slug, "project.json")), 0o600, "project.json must be owner-only");
});

test("provider keys.json is written 0600", { skip: !POSIX }, async () => {
  await fetch(`${base}/api/settings`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ keys: { openrouter: "sk-or-secret" } }),
  });
  assert.equal(await mode(path.join(tmpConfig, "keys.json")), 0o600, "keys.json must be owner-only");
});

test("cleanupStalePendingImports drops staging older than the TTL, keeps fresh", async () => {
  const dir = path.join(tmpProjects, slug, ".imports");
  await mkdir(dir, { recursive: true });
  const stale = path.join(dir, "imp_stale.json");
  const fresh = path.join(dir, "imp_fresh.json");
  await writeFile(stale, "{}");
  await writeFile(fresh, "{}");
  const old = Date.now() / 1000 - 48 * 3600; // 48h ago, past the 24h TTL
  await utimes(stale, old, old);

  const { removed } = await cleanupStalePendingImports();
  assert.ok(removed >= 1, "at least the stale record was removed");
  await assert.rejects(stat(stale), "stale staging is gone");
  await stat(fresh); // fresh staging survives (throws if missing)
});
