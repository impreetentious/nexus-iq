import { after, test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pseudonymize } from "../../server/ingest/pii.js";
import { startServer } from "../../server/index.js";

const previous = {
  projects: process.env.NEXUS_IQ_PROJECTS_DIR,
  config: process.env.NEXUS_IQ_CONFIG_DIR,
  vaults: process.env.NEXUS_IQ_VAULTS_DIR,
};

let tmpProjects;
let tmpConfig;
let tmpVaults;

after(async () => {
  for (const [name, value] of Object.entries(previous)) {
    const key = `NEXUS_IQ_${name.toUpperCase()}_DIR`;
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(
    [tmpProjects, tmpConfig, tmpVaults]
      .filter(Boolean)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

test("PII vaults stay outside bundles and legacy vaults migrate on boot", async (t) => {
  tmpProjects = await mkdtemp(path.join(os.tmpdir(), "nexus-iq-vault-projects-"));
  tmpConfig = await mkdtemp(path.join(os.tmpdir(), "nexus-iq-vault-config-"));
  tmpVaults = await mkdtemp(path.join(os.tmpdir(), "nexus-iq-vaults-"));
  process.env.NEXUS_IQ_PROJECTS_DIR = tmpProjects;
  process.env.NEXUS_IQ_CONFIG_DIR = tmpConfig;
  process.env.NEXUS_IQ_VAULTS_DIR = tmpVaults;

  await assert.rejects(
    pseudonymize(
      [{ id: "u_1", text: "contact vault-guard@example.com" }],
      path.join(tmpProjects, "study", "vault", "c_1.json"),
    ),
    (err) => err?.code === "NO_VAULT_PATH",
  );

  const legacyVault = path.join(tmpProjects, "study", "vault", "c_1.json");
  const contents = JSON.stringify({ tokens: { "[EMAIL_1]": "legacy@example.com" } });
  await mkdir(path.dirname(legacyVault), { recursive: true });
  await writeFile(legacyVault, contents, "utf8");

  const srv = await startServer({ port: 0 });
  t.after(() => srv.close());
  const migratedVault = path.join(tmpVaults, "study", "c_1.json");
  assert.equal(await readFile(migratedVault, "utf8"), contents);
  await assert.rejects(access(legacyVault), "legacy vault moved outside the project bundle");
});
