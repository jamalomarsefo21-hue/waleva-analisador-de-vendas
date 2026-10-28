import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp
} from "firebase/firestore";

const projectId = "waleva-rules-test";
let environment;
const adminId = "admin-uid";
const managerId = "manager-uid";
const viewerId = "viewer-uid";
const otherManagerId = "other-manager-uid";
const activeStoreId = "store-active";
const inactiveStoreId = "store-inactive";

function sale(overrides = {}) {
  return {
    date: "2026-10-25",
    storeId: activeStoreId,
    code: "SKU-1",
    name: "Produto de teste",
    qty: 3,
    notes: "",
    createdBy: managerId,
    createdAt: Timestamp.fromDate(new Date("2026-10-25T10:00:00Z")),
    updatedBy: managerId,
    updatedAt: Timestamp.fromDate(new Date("2026-10-25T10:00:00Z")),
    history: [],
    ...overrides
  };
}

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules }
  });
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users", adminId), {
        email: "admin@example.test", role: "admin", storeIds: [], active: true
      }),
      setDoc(doc(db, "users", managerId), {
        email: "manager@example.test", role: "store_manager", storeIds: [activeStoreId], active: true
      }),
      setDoc(doc(db, "users", viewerId), {
        email: "viewer@example.test", role: "viewer", storeIds: [activeStoreId], active: true
      }),
      setDoc(doc(db, "users", otherManagerId), {
        email: "other@example.test", role: "store_manager", storeIds: ["store-other"], active: true
      }),
      setDoc(doc(db, "stores", activeStoreId), {
        name: "Loja ativa", active: true, createdAt: Timestamp.now()
      }),
      setDoc(doc(db, "stores", inactiveStoreId), {
        name: "Loja inativa", active: false, createdAt: Timestamp.now()
      }),
      setDoc(doc(db, "salesEntries", "existing-sale"), sale())
    ]);
  });
});

after(async () => {
  await environment?.cleanup();
});

test("recusa leituras anónimas e perfis inativos", async () => {
  await assertFails(getDocs(collection(environment.unauthenticatedContext().firestore(), "stores")));
  const inactiveContext = environment.authenticatedContext("inactive-uid");
  await environment.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), "users", "inactive-uid"), {
    email: "inactive@example.test", role: "admin", storeIds: [], active: false
  }));
  await assertFails(getDoc(doc(inactiveContext.firestore(), "users", "another-user")));
  await assertFails(getDocs(collection(inactiveContext.firestore(), "stores")));
});

test("permite ao responsável aceder apenas às lojas atribuídas", async () => {
  const db = environment.authenticatedContext(managerId).firestore();
  await assertSucceeds(getDocs(collection(db, "stores")));
  await assertSucceeds(getDoc(doc(db, "salesEntries", "existing-sale")));
  const otherManagerDb = environment.authenticatedContext(otherManagerId).firestore();
  await assertFails(getDoc(doc(otherManagerDb, "salesEntries", "existing-sale")));
  await assertFails(setDoc(doc(db, "salesEntries", "other-store-sale"), sale({ storeId: "store-other" })));
});

test("perfil de consulta lê vendas autorizadas, mas não cria nem edita", async () => {
  const db = environment.authenticatedContext(viewerId).firestore();
  await assertSucceeds(getDoc(doc(db, "salesEntries", "existing-sale")));
  await assertFails(setDoc(doc(db, "salesEntries", "viewer-sale"), sale({ createdBy: viewerId, updatedBy: viewerId })));
  await assertFails(setDoc(doc(db, "salesEntries", "existing-sale"), sale({ qty: 8 })));
  await assertFails(setDoc(doc(db, "users", viewerId), {
    email: "viewer@example.test", role: "admin", storeIds: [], active: true
  }));
  await assertFails(getDoc(doc(db, "system", "adminBootstrap")));
});

test("responsável cria vendas válidas e não consegue usar loja inativa", async () => {
  const db = environment.authenticatedContext(managerId).firestore();
  await assertSucceeds(setDoc(doc(db, "salesEntries", "manager-sale"), sale({ createdBy: managerId, updatedBy: managerId })));
  await assertFails(setDoc(doc(db, "salesEntries", "inactive-sale"), sale({
    storeId: inactiveStoreId, createdBy: managerId, updatedBy: managerId
  })));
  await assertFails(setDoc(doc(db, "salesEntries", "invalid-quantity"), sale({
    createdBy: managerId, updatedBy: managerId, qty: 0
  })));
  await assertFails(setDoc(doc(db, "salesEntries", "fractional-quantity"), sale({
    createdBy: managerId, updatedBy: managerId, qty: 1.5
  })));
});

test("responsável não altera registos de outra pessoa nem remove o histórico de auditoria", async () => {
  const db = environment.authenticatedContext(managerId).firestore();
  const existingRef = doc(db, "salesEntries", "existing-sale");
  await assertFails(setDoc(existingRef, sale({
    createdBy: "different-creator", updatedBy: managerId, history: [{ changedBy: managerId }]
  })));
  await assertFails(setDoc(existingRef, sale({
    createdBy: managerId, updatedBy: managerId, history: []
  })));
  await assertFails(setDoc(existingRef, sale({
    createdBy: managerId, updatedBy: managerId, voided: true, voidedBy: managerId,
    voidedAt: serverTimestamp(),
    history: [{
      date: "2026-10-25", storeId: activeStoreId, code: "SKU-1", name: "Produto de teste",
      qty: 3, notes: "", action: "voided", changedBy: managerId, changedAt: new Date().toISOString()
    }]
  })));
});

test("responsável pode corrigir uma venda preservando os valores anteriores", async () => {
  const db = environment.authenticatedContext(managerId).firestore();
  const saleRef = doc(db, "salesEntries", "existing-sale");
  const current = (await getDoc(saleRef)).data();
  const history = [...current.history, {
    date: current.date,
    storeId: current.storeId,
    code: current.code,
    name: current.name,
    qty: current.qty,
    notes: current.notes,
    changedBy: managerId,
    changedAt: new Date().toISOString()
  }];
  await assertSucceeds(setDoc(saleRef, {
    ...current,
    qty: 4,
    updatedBy: managerId,
    updatedAt: serverTimestamp(),
    history
  }));
});

test("administrador cria um fecho uma vez e não pode alterá-lo nem apagá-lo", async () => {
  const db = environment.authenticatedContext(adminId).firestore();
  const closure = {
    start: "2026-10-25",
    end: "2026-10-31",
    total: 3,
    byStore: [],
    byProduct: [],
    correctedRecords: 0,
    voidedRecords: 0,
    closedBy: adminId,
    closedAt: serverTimestamp()
  };
  await assertSucceeds(setDoc(doc(db, "weeklyClosures", "2026-10-25"), closure));
  await assertFails(setDoc(doc(db, "weeklyClosures", "2026-10-25"), closure));
  await assertFails(setDoc(doc(db, "weeklyClosures", "2026-10-25"), { ...closure, total: 10 }));
  await assertFails(deleteDoc(doc(db, "weeklyClosures", "2026-10-25")));
});

test("administrador pode anular uma venda sem remover os dados originais", async () => {
  const db = environment.authenticatedContext(adminId).firestore();
  const saleRef = doc(db, "salesEntries", "existing-sale");
  const current = (await getDoc(saleRef)).data();
  const history = [...current.history, {
    action: "voided",
    date: current.date,
    storeId: current.storeId,
    code: current.code,
    name: current.name,
    qty: current.qty,
    notes: current.notes,
    changedBy: adminId,
    changedAt: new Date().toISOString()
  }];
  await assertSucceeds(setDoc(saleRef, {
    ...current,
    voided: true,
    voidedBy: adminId,
    voidedAt: serverTimestamp(),
    updatedBy: adminId,
    updatedAt: serverTimestamp(),
    history
  }));
  const result = await getDoc(saleRef);
  assert.equal(result.data().voided, true);
  assert.equal(result.data().qty, 3);
});

test("administrador regista correções imutáveis sem sobrescrever o fecho", async () => {
  const db = environment.authenticatedContext(adminId).firestore();
  await assertSucceeds(setDoc(doc(db, "weeklyClosureAmendments", "amendment-1"), {
    closureId: "2026-10-25",
    previousTotal: 3,
    total: 4,
    reason: "Correção autorizada",
    byStore: [],
    byProduct: [],
    correctedRecords: 0,
    voidedRecords: 0,
    correctedBy: adminId,
    correctedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(db, "weeklyClosureAmendments", "amendment-1"), {
    closureId: "2026-10-25",
    previousTotal: 4,
    total: 5,
    reason: "Tentativa de alteração",
    byStore: [],
    byProduct: [],
    correctedRecords: 0,
    voidedRecords: 0,
    correctedBy: adminId,
    correctedAt: serverTimestamp()
  }));
});

test("não-admin não consegue gerir lojas, utilizadores ou fechos", async () => {
  const db = environment.authenticatedContext(managerId).firestore();
  await assertFails(setDoc(doc(db, "stores", "new-store"), {
    name: "Não autorizada", active: true, createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(db, "users", "new-user"), {
    email: "new@example.test", role: "viewer", storeIds: [], active: true
  }));
  await assertFails(getDocs(collection(db, "weeklyClosures")));
});
