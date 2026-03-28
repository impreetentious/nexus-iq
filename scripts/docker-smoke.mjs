#!/usr/bin/env node
// Build the image, exercise all three persisted state roots through the public
// shell, restart against the same volumes, and verify the project survives.
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const IMAGE = "nexus-iq-smoke:local";
const NAME = "nexus-iq-smoke-run";
const PORT = 3017;
const BASE = `http://127.0.0.1:${PORT}`;
const VOLUMES = {
  projects: "nexus-iq-smoke-projects",
  vaults: "nexus-iq-smoke-vaults",
  config: "nexus-iq-smoke-config",
};

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    if (r.stdout) console.error(r.stdout.trimEnd());
    if (r.stderr) console.error(r.stderr.trimEnd());
    throw new Error(`${cmd} ${args.join(" ")} → ${r.status}`);
  }
  return r;
}

function removeContainer() {
  run("docker", ["rm", "-f", NAME], { allowFail: true });
}

function cleanup() {
  removeContainer();
  for (const volume of Object.values(VOLUMES)) {
    run("docker", ["volume", "rm", "-f", volume], { allowFail: true });
  }
}

function startContainer() {
  run(
    "docker",
    [
      "run",
      "-d",
      "--name",
      NAME,
      "-p",
      `127.0.0.1:${PORT}:3000`,
      "-v",
      `${VOLUMES.projects}:/app/projects`,
      "-v",
      `${VOLUMES.vaults}:/app/vaults`,
      "-v",
      `${VOLUMES.config}:/app/config`,
      IMAGE,
    ],
    { stdio: "inherit" },
  );
}

async function waitForHealth() {
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    try {
      const res = await fetch(`${BASE}/api/health`);
      const json = await res.json();
      if (res.ok && json?.ok) return json;
    } catch {
      // still booting
    }
  }
  throw new Error("health check never succeeded");
}

async function api(method, pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = await res.json();
  if (!res.ok || !json?.ok) throw new Error(`${method} ${pathname} failed with ${res.status}`);
  return json.data;
}

cleanup();
try {
  console.log("building…");
  run("docker", ["build", "-t", IMAGE, "."], { stdio: "inherit" });
  console.log("starting…");
  startContainer();
  const health = await waitForHealth();
  console.log("health OK", health.version ?? "");

  const project = await api("POST", "/api/projects", {
    name: "Docker Smoke",
    privacyMode: "open",
  });
  await api("PUT", "/api/settings", { port: 7341 });

  const form = new FormData();
  form.append("file", new Blob(["response\nContact alice@example.invalid\n"]), "smoke.csv");
  const uploadRes = await fetch(`${BASE}/api/projects/${project.slug}/import`, {
    method: "POST",
    body: form,
  });
  const upload = await uploadRes.json();
  if (!uploadRes.ok || !upload?.ok) throw new Error(`upload failed with ${uploadRes.status}`);
  const confirmed = await api("POST", `/api/projects/${project.slug}/import/confirm`, {
    importId: upload.data.importId,
    mapping: { textColumn: "response" },
    unitization: { scheme: "response" },
    pii: "pseudonymize",
  });

  removeContainer();
  run("docker", [
    "run",
    "--rm",
    "-v",
    `${VOLUMES.projects}:/data`,
    "--entrypoint",
    "test",
    IMAGE,
    "-f",
    `/data/${project.slug}/project.json`,
  ]);
  run("docker", [
    "run",
    "--rm",
    "-v",
    `${VOLUMES.vaults}:/data`,
    "--entrypoint",
    "test",
    IMAGE,
    "-f",
    `/data/${project.slug}/${confirmed.corpusId}.json`,
  ]);
  run("docker", [
    "run",
    "--rm",
    "-v",
    `${VOLUMES.config}:/data`,
    "--entrypoint",
    "test",
    IMAGE,
    "-f",
    "/data/app.json",
  ]);

  startContainer();
  await waitForHealth();
  const projects = await api("GET", "/api/projects");
  if (!Array.isArray(projects) || !projects.some((item) => item.slug === project.slug)) {
    throw new Error("project did not survive the container restart");
  }
} finally {
  cleanup();
}
console.log("docker-smoke OK — projects, vaults, and config persist across restart");
