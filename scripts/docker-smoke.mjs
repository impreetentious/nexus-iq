#!/usr/bin/env node
// Minimal Docker smoke: build image, run briefly, hit /api/health via the
// published shell port, tear down. Requires docker on PATH.
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const IMAGE = "nexus-iq-smoke:local";
const NAME = "nexus-iq-smoke-run";
const PORT = 3017;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(r.stdout);
    console.error(r.stderr);
    throw new Error(`${cmd} ${args.join(" ")} → ${r.status}`);
  }
  return r;
}

function cleanup() {
  run("docker", ["rm", "-f", NAME], { allowFail: true });
}

cleanup();
console.log("building…");
run("docker", ["build", "-t", IMAGE, "."], { stdio: "inherit" });
console.log("starting…");
run("docker", [
  "run", "-d", "--name", NAME,
  "-p", `127.0.0.1:${PORT}:3000`,
  IMAGE,
], { stdio: "inherit" });

let ok = false;
try {
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      const j = await res.json();
      if (res.ok && j?.ok) {
        console.log("health OK", j.version ?? "");
        ok = true;
        break;
      }
    } catch {
      // still booting
    }
  }
  if (!ok) throw new Error("health check never succeeded");
} finally {
  cleanup();
}
console.log("docker-smoke OK");
