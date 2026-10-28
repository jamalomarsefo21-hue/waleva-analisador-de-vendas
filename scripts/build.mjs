import { cpSync, mkdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { firebaseConfigModule, loadFirebaseConfig } from "./firebase-env.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const firebaseConfig = loadFirebaseConfig(root);
const files = [
  "index.html",
  "styles.css",
  "app.js",
  "firebase-config.js",
  "manifest.webmanifest",
  "icon.svg",
  "sw.js"
];
if (process.argv.includes("--require-firebase") && !firebaseConfig) {
  throw new Error("Publicação bloqueada: faltam variáveis Firebase WALEVA. Configura o projeto e tenta novamente.");
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const file of files) {
  cpSync(resolve(root, file), resolve(output, file));
}
if (firebaseConfig) {
  await writeFile(resolve(output, "firebase-config.js"), firebaseConfigModule(firebaseConfig));
}
console.log(`Aplicação preparada em ${output}`);
