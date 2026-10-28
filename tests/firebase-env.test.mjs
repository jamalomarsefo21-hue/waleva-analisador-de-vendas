import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { firebaseConfigModule, loadFirebaseConfig } from "../scripts/firebase-env.mjs";

const originalEnvironment = Object.fromEntries([
  "WALEVA_FIREBASE_API_KEY",
  "WALEVA_FIREBASE_AUTH_DOMAIN",
  "WALEVA_FIREBASE_PROJECT_ID",
  "WALEVA_FIREBASE_APP_ID"
].map(key => [key, process.env[key]]));
let temporaryDirectory;

afterEach(async () => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

test("loads local Firebase configuration from .env without logging values", async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "waleva-env-"));
  await writeFile(join(temporaryDirectory, ".env"), [
    "WALEVA_FIREBASE_API_KEY=test-api-key",
    "WALEVA_FIREBASE_AUTH_DOMAIN=example.firebaseapp.com",
    "WALEVA_FIREBASE_PROJECT_ID=example-project",
    'WALEVA_FIREBASE_APP_ID="1:123:web:abc"'
  ].join("\n"));
  for (const key of Object.keys(originalEnvironment)) delete process.env[key];

  const config = loadFirebaseConfig(temporaryDirectory);
  assert.deepEqual(config, {
    apiKey: "test-api-key",
    authDomain: "example.firebaseapp.com",
    projectId: "example-project",
    appId: "1:123:web:abc"
  });
  assert.match(firebaseConfigModule(config), /export const firebaseConfig/);
});

test("does not enable Firebase when no configuration exists", async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "waleva-empty-"));
  for (const key of Object.keys(originalEnvironment)) delete process.env[key];
  assert.equal(loadFirebaseConfig(temporaryDirectory), null);
});

test("rejects partial Firebase configuration rather than using a successful fallback", async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "waleva-partial-"));
  await writeFile(join(temporaryDirectory, ".env"), "WALEVA_FIREBASE_PROJECT_ID=example-project\n");
  for (const key of Object.keys(originalEnvironment)) delete process.env[key];
  assert.throws(() => loadFirebaseConfig(temporaryDirectory), /Define as quatro variáveis Firebase/);
});

test("environment variables take precedence over values in the local .env", async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "waleva-env-override-"));
  await writeFile(join(temporaryDirectory, ".env"), [
    "WALEVA_FIREBASE_API_KEY=file-key",
    "WALEVA_FIREBASE_AUTH_DOMAIN=example.firebaseapp.com",
    "WALEVA_FIREBASE_PROJECT_ID=example-project",
    "WALEVA_FIREBASE_APP_ID=1:123:web:file"
  ].join("\n"));
  for (const key of Object.keys(originalEnvironment)) delete process.env[key];
  process.env.WALEVA_FIREBASE_API_KEY = "environment-key";
  assert.equal(loadFirebaseConfig(temporaryDirectory).apiKey, "environment-key");
});
