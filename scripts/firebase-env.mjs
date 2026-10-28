import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadFirebaseConfig(root) {
  const envFile = resolve(root, ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const entry = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!entry || Object.hasOwn(process.env, entry[1])) continue;
      const value = entry[2].replace(/^(['"])(.*)\1$/, "$2").replace(/\s+#.*$/, "");
      process.env[entry[1]] = value;
    }
  }
  const config = {
    apiKey: process.env.WALEVA_FIREBASE_API_KEY,
    authDomain: process.env.WALEVA_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.WALEVA_FIREBASE_PROJECT_ID,
    appId: process.env.WALEVA_FIREBASE_APP_ID
  };
  const configuredValues = Object.values(config).filter(value =>
    typeof value === "string" && value.trim() && !value.includes("SUBSTITUIR")
  ).length;
  if (configuredValues > 0 && configuredValues !== Object.keys(config).length) {
    throw new Error("Define as quatro variáveis Firebase WALEVA antes de continuar.");
  }
  return configuredValues === Object.keys(config).length ? config : null;
}

export function firebaseConfigModule(config) {
  return `export const firebaseConfig = ${JSON.stringify(config, null, 2)};\n`;
}
