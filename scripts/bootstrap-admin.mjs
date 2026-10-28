import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const PROJECT_ID = "waleva-analisador-de-vendas";
const LOCK_PATH = "system/adminBootstrap";

function parseTarget(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!["--uid", "--email"].includes(option) || options.has(option)) {
      throw new Error("Usa exatamente uma opção: --uid UID ou --email ENDEREÇO.");
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Falta o valor para ${option}.`);
    }
    options.set(option, value.trim());
    index += 1;
  }
  if (options.size !== 1) {
    throw new Error("Indica o utilizador com --uid UID ou --email ENDEREÇO.");
  }
  const [[option, value]] = options;
  if (option === "--uid" && (value.length < 1 || value.length > 128)) {
    throw new Error("O UID tem de ter entre 1 e 128 caracteres.");
  }
  if (option === "--email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error("Indica um endereço de e-mail válido.");
  }
  return { option, value };
}

async function main() {
  const target = parseTarget(process.argv.slice(2));
  const app = initializeApp({
    credential: applicationDefault(),
    projectId: PROJECT_ID
  }, "waleva-first-admin");
  const auth = getAuth(app);
  const db = getFirestore(app);
  const user = target.option === "--email"
    ? await auth.getUserByEmail(target.value)
    : await auth.getUser(target.value);

  if (user.disabled || !user.email) {
    throw new Error("A conta tem de estar ativa e ter um endereço de e-mail.");
  }

  console.log(`Projeto Firebase: ${PROJECT_ID}`);
  console.log(`Conta encontrada: ${user.email}`);
  console.log(`UID: ${user.uid}`);

  const admins = await db.collection("users").where("role", "==", "admin").limit(1).get();
  if (!admins.empty) {
    throw new Error("Já existe um perfil admin. O bootstrap inicial não pode ser repetido.");
  }

  const terminal = createInterface({ input: stdin, output: stdout });
  let confirmation;
  try {
    confirmation = await terminal.question("Escreve SIM para autorizar este UID como primeiro admin: ");
  } finally {
    terminal.close();
  }
  if (confirmation.trim() !== "SIM") {
    throw new Error("Operação cancelada; nenhum perfil foi alterado.");
  }

  const profileRef = db.doc(`users/${user.uid}`);
  const lockRef = db.doc(LOCK_PATH);
  await db.runTransaction(async transaction => {
    const [lock, profile] = await Promise.all([
      transaction.get(lockRef),
      transaction.get(profileRef)
    ]);
    if (lock.exists) {
      throw new Error("O bootstrap inicial já foi utilizado neste projeto.");
    }
    if (profile.exists) {
      throw new Error("O utilizador já tem um perfil. Nenhum dado foi alterado.");
    }
    transaction.create(profileRef, {
      email: user.email,
      role: "admin",
      storeIds: [],
      active: true
    });
    transaction.create(lockRef, {
      uid: user.uid,
      email: user.email,
      initializedAt: FieldValue.serverTimestamp()
    });
  });

  const savedProfile = await profileRef.get();
  if (!savedProfile.exists || savedProfile.data().role !== "admin"
      || savedProfile.data().active !== true) {
    throw new Error("O perfil foi escrito, mas a verificação posterior não confirmou o papel admin.");
  }
  console.log(`Bootstrap concluído e verificado para ${user.email} (${user.uid}).`);
}

main().catch(error => {
  console.error(`Não foi possível configurar o primeiro administrador: ${error.message}`);
  process.exitCode = 1;
});
