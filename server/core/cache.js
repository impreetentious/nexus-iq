// Content-addressed output cache: a worker call is keyed by
// sha256(unitText | instrument versionHash | model snapshot), so reruns and
// resumed runs hit the cache instead of the provider. Stored as JSON files
// under <projectDir>/cache/<first2>/<rest> (git-style fan-out).
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "./store.js";
import path from "node:path";
import { sha256 } from "./ids.js";

export function key(unitText, versionHash, snapshot) {
  return sha256(`${unitText}|${versionHash}|${snapshot}`);
}

function entryPath(projectDir, k) {
  return path.join(projectDir, "cache", k.slice(0, 2), k.slice(2));
}

export async function get(projectDir, k) {
  try {
    return JSON.parse(await readFile(entryPath(projectDir, k), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    if (err instanceof SyntaxError) return null; // torn write — treat as miss
    throw err;
  }
}

export async function put(projectDir, k, value) {
  const file = entryPath(projectDir, k);
  try {
    await writeFileAtomic(file, value, { json: true });
  } catch (err) {
    // either we lost a same-key race (identical content already landed) or
    // the rename genuinely failed — in both cases the tmp must not linger
    let existing = null;
    try {
      existing = await get(projectDir, k);
    } catch {
      /* unreadable -> treat as missing */
    }
    if (existing === null) throw err;
  }
  return value;
}
