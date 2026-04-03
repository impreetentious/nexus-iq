import { mkdir, open, readFile, rename, readdir, stat, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NexusIQError } from "./errors.js";
import { rehydrateProject } from "./objects.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Private-by-default modes for project graphs, corpora, vaults, and keys.
// Applied at creation; ensurePrivateDir/File migrate
// pre-existing bundles best-effort. No-ops where the platform ignores modes.
export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

export function projectsDir() {
  return process.env.NEXUS_IQ_PROJECTS_DIR || path.join(repoRoot, "projects");
}

// Re-identification maps are deliberately separate from portable project
// bundles. Copying projects/ therefore cannot accidentally share a token map.
export function vaultsDir() {
  return process.env.NEXUS_IQ_VAULTS_DIR || path.join(repoRoot, "vaults");
}

// Provider keys (keys.json) and app defaults (app.json). Resolved off the repo
// root like the other two data roots — NOT process.cwd(), which would move the
// config with whatever directory the server happened to be launched from and
// split the write side (Settings) from the read side (adapters, boot port).
// THE one definition: routes/_shared.js, providers/registry.js and index.js
// all resolve config paths through here so a NEXUS_IQ_CONFIG_DIR override
// moves every consumer together.
export function configDir() {
  return process.env.NEXUS_IQ_CONFIG_DIR || path.join(repoRoot, "config");
}

export function keysFile() {
  return path.join(configDir(), "keys.json");
}

export function appConfigFile() {
  return path.join(configDir(), "app.json");
}

// The store-boundary slug guard. Route params reach loadProject/updateProject
// directly (the router decodes %2F INSIDE segments, so "..%2Foutside" arrives
// as "../outside"), and creation-time validation in objects.js cannot protect
// the read path. Same character class as routes/_shared.js safeId, plus a
// resolved-path containment check so the joined path can never leave `dir`.
const SAFE_SLUG = /^[A-Za-z0-9_-]+$/;

/** Validate an opaque persisted identifier before it becomes a path segment. */
export function assertStorageId(id, what = "id") {
  if (typeof id !== "string" || !SAFE_SLUG.test(id)) {
    throw new NexusIQError("VALIDATION", `invalid ${what} (must be letters, digits, "-" or "_")`, {
      [what]: id,
    });
  }
  return id;
}

export function assertProjectSlug(slug, dir, { code = "VALIDATION" } = {}) {
  const bad = () =>
    new NexusIQError(
      code,
      code === "NOT_FOUND"
        ? `Project '${slug}' not found`
        : `invalid project slug '${slug}' (must be letters, digits, "-" or "_")`,
      { slug },
    );
  try {
    assertStorageId(slug, "project slug");
  } catch {
    throw bad();
  }
  const base = path.resolve(dir ?? projectsDir());
  if (path.dirname(path.resolve(base, slug)) !== base) throw bad();
  return slug;
}

export function projectDir(slug, dir = projectsDir()) {
  assertProjectSlug(slug, dir);
  return path.join(dir, slug);
}

// ------------------------------------------------------------ project.json

const projectLocks = new Map(); // resolved project dir -> promise queue

function withProjectLock(key, fn) {
  const prev = projectLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  projectLocks.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

let tmpSeq = 0;

const TRANSIENT_FS_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

export async function retryTransient(fn, { attempts = 6, baseMs = 40 } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const transient = TRANSIENT_FS_CODES.has(err?.code);
      if (!transient || i >= attempts - 1) {
        if (transient) {
          err.message +=
            " — another program (often Dropbox sync) held the file; the action is safe to retry";
        }
        throw err;
      }
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
}

export function renameWithRetry(from, to, opts = {}) {
  return retryTransient(() => rename(from, to), opts);
}

// The one atomic whole-file writer for private state: write a unique tmp,
// fsync, then rename. It creates all parent directories and applies the
// private modes regardless of which subsystem owns the artifact.
export async function writeFileAtomic(file, data, { json = false } = {}) {
  await mkdir(path.dirname(file), { recursive: true, mode: DIR_MODE });
  const tmp = `${file}.${process.pid}.${tmpSeq++}.tmp`;
  const fh = await open(tmp, "w", FILE_MODE);
  try {
    await fh.writeFile(json ? JSON.stringify(data, null, 2) : data, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await renameWithRetry(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export async function loadProject(slug, dir = projectsDir()) {
  // NOT_FOUND (not VALIDATION) so hostile/garbled slugs read exactly like
  // absent projects, and listProjects keeps skipping non-bundle directories.
  assertProjectSlug(slug, dir, { code: "NOT_FOUND" });
  const file = path.join(dir, slug, "project.json");
  try {
    return rehydrateProject(JSON.parse(await readFile(file, "utf8")));
  } catch (err) {
    if (err.code === "ENOENT")
      throw new NexusIQError("NOT_FOUND", `Project '${slug}' not found`, { slug });
    if (err instanceof SyntaxError)
      throw new NexusIQError("CORRUPT", `project.json for '${slug}' is not valid JSON`, { slug });
    throw err;
  }
}

async function writeProject(project, dir) {
  assertProjectSlug(project.slug, dir);
  const pdir = path.join(dir, project.slug);
  await writeFileAtomic(path.join(pdir, "project.json"), project, { json: true });
  return project;
}

export async function saveProject(project, dir = projectsDir()) {
  if (!project || typeof project.slug !== "string" || !project.slug) {
    throw new NexusIQError("VALIDATION", "saveProject requires a project with a slug", {});
  }
  return withProjectLock(path.resolve(dir, project.slug), () => writeProject(project, dir));
}

export async function createProjectIfAbsent(project, dir = projectsDir()) {
  if (!project || typeof project.slug !== "string" || !project.slug) {
    throw new NexusIQError(
      "VALIDATION",
      "createProjectIfAbsent requires a project with a slug",
      {},
    );
  }
  const slug = project.slug;
  return withProjectLock(path.resolve(dir, slug), async () => {
    try {
      await loadProject(slug, dir);
    } catch (err) {
      if (err?.code === "NOT_FOUND") return writeProject(project, dir); // truly absent → create
      if (err?.code === "CORRUPT") {
        throw new NexusIQError("VALIDATION", `a project with slug '${slug}' already exists`, {
          slug,
        });
      }
      throw err; // a real I/O fault must surface, not masquerade as a conflict
    }
    throw new NexusIQError("VALIDATION", `a project with slug '${slug}' already exists`, { slug });
  });
}

export async function updateProject(slug, mutatorFn, dir = projectsDir()) {
  return withProjectLock(path.resolve(dir, slug), async () => {
    const project = await loadProject(slug, dir);
    const result = await mutatorFn(project);
    const updated = result === undefined ? project : result;
    if (!updated || updated.slug !== slug) {
      throw new NexusIQError("VALIDATION", "updateProject mutator must keep the project slug", {
        slug,
      });
    }
    return writeProject(updated, dir);
  });
}

// ------------------------------------------------------------------ NDJSON

function badNdjson(file, lineNo) {
  return new NexusIQError(
    "BAD_NDJSON",
    `Malformed NDJSON at line ${lineNo} of ${path.basename(file)}`,
    { file, line: lineNo },
  );
}

async function endsWithNewline(file) {
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    if (size === 0) return true;
    const buf = Buffer.alloc(1);
    await fh.read(buf, 0, 1, size - 1);
    return buf[0] === 0x0a;
  } finally {
    await fh.close();
  }
}

// Scan backward for the last "\n" and truncate just after it (drop the torn
// final line). Returns the new size.
async function truncateTornTail(fh, size) {
  const CHUNK = 64 * 1024;
  const buf = Buffer.alloc(Math.min(CHUNK, size));
  let end = size;
  while (end > 0) {
    const len = Math.min(CHUNK, end);
    const start = end - len;
    await fh.read(buf, 0, len, start);
    const idx = buf.subarray(0, len).lastIndexOf(0x0a);
    if (idx !== -1) {
      const keep = start + idx + 1;
      await fh.truncate(keep);
      return keep;
    }
    end = start;
  }
  await fh.truncate(0);
  return 0;
}

// Minimal fault-injection seam (tests only): when set, it is invoked (and
// AWAITED) before each open/appendFile attempt. It may throw a synthetic
// transient error to exercise the retry path, or return a promise to widen the
// heal/append window (the serialization regression test uses this to make the
// otherwise-timing-dependent truncation race observable). A synchronous void
// injector still works — awaiting undefined/a non-promise is a no-op. Null in
// production — zero overhead beyond a guard.
let appendFaultInjector = null;
export function __setAppendFaultInjector(fn) {
  appendFaultInjector = typeof fn === "function" ? fn : null;
}

// Per-resolved-path append serialization (mirrors withProjectLock / ledger's
// withLock). The heal (stat → last-byte → backward-scan truncate) and the
// append are separate IO steps: two concurrent appends to a torn-tail file
// could have writer B's heal truncate away writer A's just-appended line
// (O_APPEND keeps whole lines from interleaving, but does NOT serialize a
// truncate against another writer's append). On resume-after-crash, N workers
// append to one outputs.ndjson with torn tails present — exactly the race.
// Serializing heal+append for a given file makes the pair atomic w.r.t. other
// appends to THAT file; different files stay fully concurrent.
const appendLocks = new Map(); // resolved file path -> promise queue

function withAppendLock(key, fn) {
  const prev = appendLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  // Keep the chain from growing forever and never reject the stored tail.
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  appendLocks.set(key, settled);
  // Best-effort cleanup: once this is the tail and it has settled, drop the
  // entry so the Map does not retain a key per file for the process lifetime.
  settled.then(() => {
    if (appendLocks.get(key) === settled) appendLocks.delete(key);
  });
  return next;
}

async function openCleanAppendHandle(file) {
  let fh = null;
  await appendFaultInjector?.();
  try {
    fh = await open(file, "a+", FILE_MODE);
    let { size } = await fh.stat();
    if (size > 0) {
      const last = Buffer.alloc(1);
      await fh.read(last, 0, 1, size - 1);
      if (last[0] !== 0x0a) {
        await fh.close();
        fh = null;
        const heal = await open(file, "r+");
        try {
          size = await truncateTornTail(heal, size);
        } finally {
          await heal.close();
        }
        fh = await open(file, "a+", FILE_MODE);
      }
    }
    return { fh, size };
  } catch (err) {
    await fh?.close().catch(() => {});
    throw err;
  }
}

// Append one JSON line. If a previous append was torn (file does not end with
// "\n"), the partial final line never durably completed — truncate it first so
// the file is back to "complete lines only", then append. Returns {size}: the
// file size after the write (the ledger uses it to checkpoint its tail).
//
// Serialized per resolved file path (withAppendLock): heal+append for a given
// file is atomic against other appends to the same file, so a concurrent
// co-writer's line can never be truncated away by another writer's heal.
//
// The whole heal+append IO is wrapped in retryTransient — the SAME backoff
// every rename site uses — so a transient Dropbox/Windows sync lock
// (EPERM/EBUSY/EACCES) on the open or the append is retried, not allowed to
// escape and crash a run to "failed". Healing is re-derived from the file on
// each attempt, so a retry stays correct.
export async function appendNdjson(file, obj) {
  await mkdir(path.dirname(file), { recursive: true, mode: DIR_MODE });
  const line = JSON.stringify(obj) + "\n";
  const bytes = Buffer.byteLength(line);
  return withAppendLock(path.resolve(file), () =>
    retryTransient(async () => {
      // The common clean-tail path uses one append/read handle for the stat,
      // last-byte check, and write. A torn tail is uncommon and reopens in r+
      // only for the truncate because Windows forbids ftruncate on an append-
      // mode handle. Keeping O_APPEND preserves whole-line writes.
      const { fh, size } = await openCleanAppendHandle(file);
      try {
        await appendFaultInjector?.();
        await fh.writeFile(line, "utf8");
        return { size: size + bytes };
      } finally {
        await fh.close();
      }
    }),
  );
}

// Long-running writers can keep one O_APPEND handle open while preserving the
// same per-file serialization and torn-tail healing as appendNdjson. Appends
// queued in the same turn share one write; each caller resolves only after the
// batch containing its complete line is on disk.
export async function openNdjsonAppender(file) {
  await mkdir(path.dirname(file), { recursive: true, mode: DIR_MODE });
  const key = path.resolve(file);
  const { fh } = await withAppendLock(key, () => retryTransient(() => openCleanAppendHandle(file)));
  let closed = false;
  const queue = [];
  let flushTask = null;

  const ensureFlush = () => {
    if (flushTask) return;
    flushTask = (async () => {
      // Let all currently-running workers enqueue before taking the batch.
      await new Promise((resolve) => queueMicrotask(resolve));
      while (queue.length > 0) {
        const batch = queue.splice(0);
        try {
          const body = batch.map((item) => item.line).join("");
          await withAppendLock(key, () =>
            retryTransient(async () => {
              await appendFaultInjector?.();
              await fh.writeFile(body, "utf8");
            }),
          );
          for (const item of batch) item.resolve();
        } catch (err) {
          for (const item of batch) item.reject(err);
        }
      }
    })().finally(() => {
      flushTask = null;
      if (queue.length > 0) ensureFlush();
    });
  };

  return {
    append(obj) {
      if (closed) return Promise.reject(new Error("NDJSON appender is closed"));
      const line = JSON.stringify(obj) + "\n";
      return new Promise((resolve, reject) => {
        queue.push({ line, resolve, reject });
        ensureFlush();
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      while (flushTask) await flushTask;
      await withAppendLock(key, () => fh.close());
    },
  };
}

// Streamed NDJSON reader. filter applies first, then offset/limit count
// filtered rows; stops reading as soon as `limit` rows are collected.
// A malformed line throws BAD_NDJSON — except a malformed FINAL line in a
// file with no trailing newline, which is a torn append (crash mid-write),
// not corruption: it is skipped, and onTornTail (if given) is told.
export async function readNdjson(file, { offset = 0, limit = Infinity, filter, onTornTail } = {}) {
  if (limit <= 0) return [];
  try {
    await stat(file);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const stream = createReadStream(file, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const out = [];
  let seen = 0;
  let lineNo = -1;
  let pendingBad = null; // a parse failure that may yet prove to be a torn tail
  try {
    for await (const line of rl) {
      lineNo++;
      if (pendingBad) throw badNdjson(file, pendingBad.lineNo); // lines follow it — mid-file corruption
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        pendingBad = { lineNo, line };
        continue;
      }
      if (filter && !filter(obj)) continue;
      if (seen++ < offset) continue;
      out.push(obj);
      if (out.length >= limit) break;
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  if (pendingBad) {
    if (await endsWithNewline(file)) throw badNdjson(file, pendingBad.lineNo); // complete line, still garbage
    onTornTail?.(pendingBad.line);
  }
  return out;
}

export async function listProjects(dir = projectsDir()) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      out.push(await loadProject(e.name, dir));
    } catch (err) {
      // no project.json at all -> not a bundle, skip silently; anything else
      // (unparseable JSON, failed rehydration, fs errors) is a damaged bundle
      // the UI must be able to show instead of silently hiding
      if (err?.code !== "NOT_FOUND") out.push({ slug: e.name, corrupt: true });
    }
  }
  return out;
}
