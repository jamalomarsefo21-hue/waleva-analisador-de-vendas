import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { firebaseConfigModule, loadFirebaseConfig } from "./firebase-env.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const firebaseConfig = loadFirebaseConfig(root);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};
const server = createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400).end("Pedido inválido");
    return;
  }
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  if (requestedPath === "/firebase-config.js" && firebaseConfig) {
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }).end(firebaseConfigModule(firebaseConfig));
    return;
  }
  const file = resolve(root, `.${requestedPath}`);
  if (!file.startsWith(`${root}${sep}`) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404).end("Não encontrado");
    return;
  }
  response.writeHead(200, {
    "Content-Type": contentTypes[extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  createReadStream(file).pipe(response);
});
server.listen(4173, "127.0.0.1", () => {
  console.log("WALEVA disponível em http://127.0.0.1:4173");
});
