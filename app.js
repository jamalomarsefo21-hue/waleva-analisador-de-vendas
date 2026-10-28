import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  collection, doc, getDocsFromServer, initializeFirestore, onSnapshot, persistentLocalCache,
  query, serverTimestamp, setDoc, where, writeBatch, runTransaction
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const INITIAL_STORES = ["Amadou", "Mamadou", "Abubacar", "Hadja", "Ousmane", "Aissatou", "Aliou", "Karamoko", "Nenê", "Kadija"];
const PAGE_SIZE = 30;
const ROLE_NAMES = { admin: "Administrador", store_manager: "Responsável de loja", viewer: "Consulta" };
const state = {
  user: null, profile: null, stores: [], sales: [], closures: [], amendments: [], users: [],
  page: "dashboard", pageNumber: 0, analysisRows: [], importRows: [], closeSnapshot: null,
  unsubscribers: [], profileUnsubscribe: null, online: navigator.onLine, dataFromCache: true
};
const byId = id => document.getElementById(id);
const db = isConfigured(firebaseConfig)
  ? initializeFirestore(initializeApp(firebaseConfig), { localCache: persistentLocalCache() })
  : null;
const auth = db ? getAuth() : null;

function isConfigured(config) {
  return ["apiKey", "authDomain", "projectId", "appId"].every(key =>
    typeof config[key] === "string" && config[key].trim() && !config[key].includes("SUBSTITUIR")
  );
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function dateAtNoon(value) { return new Date(`${value}T12:00:00`); }
function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
function formatNumber(value) { return Number(value || 0).toLocaleString("pt-PT"); }
function weekRange(value) {
  const start = dateAtNoon(value);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return [localDate(start), localDate(end)];
}
function latestSaturday(value = new Date()) {
  const date = value instanceof Date ? new Date(value) : dateAtNoon(value);
  date.setDate(date.getDate() - ((date.getDay() + 1) % 7));
  return localDate(date);
}
function productKey(sale) { return `${String(sale.code).trim().toUpperCase()}|${String(sale.name).trim().toLocaleLowerCase("pt-PT")}`; }
function sum(rows) { return rows.reduce((total, row) => total + Number(row.qty || 0), 0); }
function storeName(id) { return state.stores.find(store => store.id === id)?.name || id; }
function isAdmin() { return state.profile?.role === "admin"; }
function canEdit(sale) {
  return !sale.voided && (isAdmin() || (state.profile?.role === "store_manager" && state.profile.storeIds?.includes(sale.storeId)));
}
function activeSales(rows = state.sales) { return rows.filter(row => !row.voided); }
function hasConfirmedConnection() { return navigator.onLine && state.online && !state.dataFromCache; }
function saleSignature(rows) {
  return rows.map(row => [
    row.id, row.date, row.storeId, row.code, row.name, row.qty, row.notes || "",
    Boolean(row.voided), timestampSort(row.updatedAt)
  ].join("\u001f")).sort().join("\u001e");
}
function showMessage(text, kind = "info") {
  const box = byId("appMessage");
  box.textContent = text;
  box.className = `app-message ${kind}`;
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => box.classList.add("hidden"), 7000);
}
function updateConnectionStatus() {
  const chip = byId("connectionStatus");
  if (!chip) return;
  const connected = navigator.onLine && state.online;
  chip.textContent = !connected ? "Offline · sincronização pendente"
    : state.dataFromCache ? "Ligação disponível · dados por confirmar" : "Ligação e dados sincronizados";
  chip.className = `status-chip${!connected ? " offline" : state.dataFromCache ? " pending" : ""}`;
}
function stopListeners() {
  state.unsubscribers.forEach(unsubscribe => unsubscribe());
  state.unsubscribers = [];
}
function clearViews() {
  stopListeners();
  state.profileUnsubscribe?.();
  state.profileUnsubscribe = null;
  state.profile = null;
  state.stores = [];
  state.sales = [];
  state.closures = [];
  state.amendments = [];
  state.users = [];
}

byId("todayLabel").textContent = new Intl.DateTimeFormat("pt-PT", { dateStyle: "long" }).format(new Date());
byId("saleDate").value = localDate();
byId("closeDate").value = latestSaturday();

if (!db) {
  byId("authMessage").textContent = "Configura firebase-config.js com os dados da aplicação Web do Firebase para ativar o acesso.";
  byId("loginForm").querySelector("button").disabled = true;
  byId("resetPassword").disabled = true;
} else {
  onAuthStateChanged(auth, user => {
    clearViews();
    state.user = user;
    byId("auth").classList.remove("hidden");
    byId("app").classList.add("hidden");
    if (!user) return;
    byId("authMessage").textContent = "A verificar a autorização da conta…";
    attachProfile(user.uid);
  }, error => {
    byId("authMessage").textContent = `Não foi possível verificar a sessão: ${error.message}`;
  });
  byId("resetPassword").addEventListener("click", async () => {
    const email = byId("email").value.trim();
    if (!email) {
      byId("authMessage").textContent = "Introduz o teu e-mail para receber a ligação de redefinição.";
      byId("email").focus();
      return;
    }
    if (!auth) return;
    const button = byId("resetPassword");
    button.disabled = true;
    try {
      await sendPasswordResetEmail(auth, email);
      byId("authMessage").textContent = "Se existir uma conta autorizada para este endereço, receberás uma ligação para redefinir a palavra-passe.";
    } catch (error) {
      if (error.code === "auth/invalid-email") {
        byId("authMessage").textContent = "O endereço de e-mail não é válido.";
      } else {
        byId("authMessage").textContent = `Não foi possível enviar a ligação de redefinição: ${error.message}`;
      }
    } finally {
      button.disabled = false;
    }
  });
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./sw.js").catch(error => showMessage(`A aplicação está disponível, mas não foi possível ativar o modo PWA: ${error.message}`, "error"));
  }
}

byId("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!auth) return;
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  byId("authMessage").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, byId("email").value.trim(), byId("password").value);
    event.currentTarget.reset();
  } catch (error) {
    byId("authMessage").textContent = `Não foi possível iniciar sessão: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});
byId("logoutButton").addEventListener("click", async () => {
  try { await signOut(auth); }
  catch (error) { showMessage(`Não foi possível terminar a sessão: ${error.message}`, "error"); }
});
window.addEventListener("online", () => { state.online = true; updateConnectionStatus(); });
window.addEventListener("offline", () => { state.online = false; updateConnectionStatus(); });

function attachProfile(uid) {
  state.profileUnsubscribe = onSnapshot(doc(db, "users", uid), snapshot => {
    if (!snapshot.exists() || snapshot.data().active !== true) {
      state.profile = null;
      stopListeners();
      byId("app").classList.add("hidden");
      byId("auth").classList.remove("hidden");
      byId("authMessage").textContent = "Esta conta ainda não tem um perfil ativo. Contacta o administrador WALEVA.";
      signOut(auth).catch(error => { byId("authMessage").textContent = `Perfil sem acesso e erro ao terminar sessão: ${error.message}`; });
      return;
    }
    const profile = snapshot.data();
    if (!["admin", "store_manager", "viewer"].includes(profile.role)
        || !Array.isArray(profile.storeIds)
        || profile.storeIds.length > 30
        || profile.storeIds.some(storeId => typeof storeId !== "string")) {
      state.profile = null;
      stopListeners();
      byId("app").classList.add("hidden");
      byId("auth").classList.remove("hidden");
      byId("authMessage").textContent = "O perfil desta conta está incompleto ou inválido. Contacta o administrador WALEVA.";
      signOut(auth).catch(error => { byId("authMessage").textContent = `Perfil inválido e erro ao terminar sessão: ${error.message}`; });
      return;
    }
    state.profile = { id: snapshot.id, ...profile };
    byId("userIdentity").textContent = state.profile.email || state.user.email;
    byId("roleLabel").textContent = ROLE_NAMES[state.profile.role] || "Sem perfil";
    byId("auth").classList.add("hidden");
    byId("app").classList.remove("hidden");
    document.querySelectorAll(".admin-only").forEach(element => element.classList.toggle("hidden", !isAdmin()));
    startDataListeners();
  }, error => {
    byId("app").classList.add("hidden");
    byId("auth").classList.remove("hidden");
    byId("authMessage").textContent = `Não foi possível verificar as permissões desta conta: ${error.message}`;
  });
}

function startDataListeners() {
  stopListeners();
  const storesQuery = query(collection(db, "stores"));
  state.unsubscribers.push(onSnapshot(storesQuery, { includeMetadataChanges: true }, snapshot => {
    state.stores = snapshot.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => a.name.localeCompare(b.name, "pt-PT"));
    renderAll();
    if (isAdmin() && !snapshot.metadata.fromCache) {
      seedInitialStores().catch(error => showMessage(`Não foi possível preparar as lojas iniciais: ${error.message}`, "error"));
    }
  }, error => showMessage(`Não foi possível carregar as lojas: ${error.message}`, "error")));

  const storeIds = isAdmin() ? [] : (state.profile.storeIds || []);
  if (isAdmin() || storeIds.length) {
    const salesQuery = isAdmin()
      ? query(collection(db, "salesEntries"))
      : query(collection(db, "salesEntries"), where("storeId", "in", storeIds.slice(0, 30)));
    state.unsubscribers.push(onSnapshot(salesQuery, { includeMetadataChanges: true }, snapshot => {
      state.sales = snapshot.docs.map(item => ({ id: item.id, ...item.data(), pending: item.metadata.hasPendingWrites }));
      state.dataFromCache = snapshot.metadata.fromCache;
      state.online = navigator.onLine && !snapshot.metadata.fromCache;
      updateConnectionStatus();
      renderAll();
    }, error => {
      state.online = false;
      updateConnectionStatus();
      showMessage(`Não foi possível carregar as vendas autorizadas: ${error.message}`, "error");
    }));
  } else {
    state.sales = [];
    renderAll();
  }

  if (isAdmin()) {
    state.unsubscribers.push(onSnapshot(collection(db, "weeklyClosures"), snapshot => {
      state.closures = snapshot.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => b.start.localeCompare(a.start));
      renderClosures();
      renderCloseReview();
    }, error => showMessage(`Não foi possível carregar os fechos: ${error.message}`, "error")));
    state.unsubscribers.push(onSnapshot(collection(db, "weeklyClosureAmendments"), snapshot => {
      state.amendments = snapshot.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => timestampSort(b.correctedAt).localeCompare(timestampSort(a.correctedAt)));
      renderClosures();
    }, error => showMessage(`Não foi possível carregar as correções dos fechos: ${error.message}`, "error")));
    state.unsubscribers.push(onSnapshot(collection(db, "users"), snapshot => {
      state.users = snapshot.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => a.email.localeCompare(b.email));
      renderUsers();
    }, error => showMessage(`Não foi possível carregar os utilizadores: ${error.message}`, "error")));
  } else {
    state.closures = [];
    state.users = [];
  }
  updateConnectionStatus();
}

async function seedInitialStores() {
  const serverSnapshot = await getDocsFromServer(collection(db, "stores"));
  if (!serverSnapshot.empty) return;
  const missing = INITIAL_STORES.map((name, index) => ({ id: `store-${index + 1}`, name }));
  if (!missing.length || !navigator.onLine) return;
  const batch = writeBatch(db);
  missing.forEach(store => batch.set(doc(db, "stores", store.id), { name: store.name, active: true, createdAt: serverTimestamp() }));
  await batch.commit();
}

document.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", event => {
  event.preventDefault();
  showPage(button.dataset.page);
}));
document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => showPage(button.dataset.go)));
function showPage(name) {
  if (name === "users" && !isAdmin()) return;
  state.page = name;
  state.pageNumber = 0;
  document.querySelectorAll(".page").forEach(page => page.classList.add("hidden"));
  byId(`page-${name}`).classList.remove("hidden");
  document.querySelectorAll(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.page === name));
  const titles = { dashboard: "Painel geral", sales: "Registar vendas", stores: "Lojas", analysis: "Análise", close: "Fecho semanal", history: "Histórico de fechos", users: "Utilizadores" };
  byId("pageTitle").textContent = titles[name];
  if (name === "dashboard") renderDashboard();
  if (name === "sales") renderSales();
  if (name === "stores") renderStores();
  if (name === "analysis") renderAnalysis();
  if (name === "close") {
    if (!byId("closeDate").value) byId("closeDate").value = latestSaturday();
    renderCloseReview();
  }
  if (name === "history") renderClosures();
}
function permittedStores(activeOnly = false) {
  return state.stores.filter(store =>
    (isAdmin() || state.profile?.storeIds?.includes(store.id))
    && (!activeOnly || store.active)
  );
}
function fillStoreOptions(selectId, includeAll, activeOnly = false) {
  const select = byId(selectId);
  const previous = select.value;
  const stores = permittedStores(activeOnly);
  select.innerHTML = `${includeAll ? '<option value="all">Todas as lojas</option>' : ""}${stores.map(store => `<option value="${escapeHtml(store.id)}">${escapeHtml(store.name)}${store.active ? "" : " (inativa)"}</option>`).join("")}`;
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
  else if (includeAll) select.value = "all";
}
function renderAll() {
  if (!state.profile) return;
  const canWrite = isAdmin() || state.profile.role === "store_manager";
  byId("saleEntryPanel").classList.toggle("hidden", !canWrite);
  byId("importPanel").classList.toggle("hidden", !canWrite);
  byId("saleFormTitle").closest(".section-heading").classList.toggle("hidden", !canWrite);
  fillStoreOptions("saleStore", false, true);
  fillStoreOptions("salesStoreFilter", true);
  fillStoreOptions("analysisStore", true);
  renderDashboard();
  renderSales();
  renderStores();
  renderAnalysis();
  renderCloseReview();
  renderClosures();
}

function aggregate(rows) {
  const map = new Map();
  rows.forEach(sale => {
    const key = productKey(sale);
    const item = map.get(key) || { code: sale.code, name: sale.name, qty: 0, stores: new Set() };
    item.qty += Number(sale.qty || 0);
    item.stores.add(sale.storeId);
    map.set(key, item);
  });
  return [...map.values()].sort((a, b) => b.qty - a.qty || a.code.localeCompare(b.code));
}
function renderBars(elementId, entries, labelKey = "label", limit = 8) {
  const element = byId(elementId);
  if (!element) return;
  const rows = entries.slice(0, limit);
  if (!rows.length) {
    element.innerHTML = '<p class="muted tiny">Sem registos no período.</p>';
    return;
  }
  const max = Math.max(...rows.map(row => row.qty), 1);
  element.innerHTML = rows.map(row => `<div class="bar-row"><span class="bar-label" title="${escapeHtml(row[labelKey])}">${escapeHtml(row[labelKey])}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(1, row.qty / max * 100)}%"></div></div><b class="bar-value">${formatNumber(row.qty)}</b></div>`).join("");
}
function within(rows, start, end) { return rows.filter(row => row.date >= start && row.date <= end); }
function renderDashboard() {
  const today = localDate();
  const [weekStart, weekEnd] = weekRange(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const todayRows = within(activeSales(), today, today);
  const weekRows = within(activeSales(), weekStart, weekEnd);
  const monthRows = within(activeSales(), monthStart, today);
  byId("kpiToday").textContent = formatNumber(sum(todayRows));
  byId("kpiWeek").textContent = formatNumber(sum(weekRows));
  byId("kpiMonth").textContent = formatNumber(sum(monthRows));
  const monthProducts = aggregate(monthRows);
  byId("kpiProducts").textContent = formatNumber(monthProducts.length);
  const storeLeaders = permittedStores().map(store => ({ store, qty: sum(monthRows.filter(row => row.storeId === store.id)) })).sort((a, b) => b.qty - a.qty);
  byId("kpiTopStore").textContent = storeLeaders[0]?.qty ? storeLeaders[0].store.name : "—";
  byId("kpiTopProduct").textContent = monthProducts[0] ? `${monthProducts[0].code} · ${formatNumber(monthProducts[0].qty)}` : "—";
  const least = [...monthProducts].filter(product => product.qty > 0).sort((a, b) => a.qty - b.qty)[0];
  byId("kpiLowProduct").textContent = least ? `${least.code} · ${formatNumber(least.qty)}` : "—";
  renderBars("storeChart", permittedStores().map(store => ({ label: store.name, qty: sum(weekRows.filter(row => row.storeId === store.id)) })).sort((a, b) => b.qty - a.qty));
  renderBars("productChart", aggregate(weekRows).map(row => ({ label: `${row.code} · ${row.name}`, qty: row.qty })));
  const recent = [...state.sales].sort((a, b) => `${b.date}${timestampSort(b.createdAt)}`.localeCompare(`${a.date}${timestampSort(a.createdAt)}`)).slice(0, 8);
  byId("recentSales").innerHTML = salesTable(recent, false);
}
function timestampSort(value) {
  return value?.toDate ? value.toDate().toISOString() : (typeof value === "string" ? value : "");
}
function salesTable(rows, actions) {
  if (!rows.length) return '<p class="empty muted">Ainda não existem vendas para apresentar.</p>';
  return `<table><thead><tr><th>Data</th><th>Loja</th><th>Código</th><th>Produto</th><th class="num">Quantidade</th><th>Sincronização</th>${actions ? "<th>Ações</th>" : ""}</tr></thead><tbody>${rows.map(row => `<tr>
    <td>${formatDate(row.date)}</td><td>${escapeHtml(storeName(row.storeId))}</td><td><b>${escapeHtml(row.code)}</b></td><td>${escapeHtml(row.name)}</td><td class="num">${formatNumber(row.qty)}</td>
    <td>${row.voided ? '<span class="badge inactive">Anulado</span>' : `<span class="badge ${row.pending || state.dataFromCache ? "pending" : ""}">${row.pending ? "Pendente" : (state.dataFromCache ? "Cache local · por confirmar" : "Sincronizado")}</span>`}</td>
    ${actions ? `<td>${canEdit(row) ? `<button class="button secondary edit-sale" data-id="${escapeHtml(row.id)}">Editar</button> ` : ""}${row.history?.length ? `<button class="button secondary view-history" data-id="${escapeHtml(row.id)}">Histórico</button> ` : ""}${isAdmin() && !row.voided ? `<button class="button danger delete-sale" data-id="${escapeHtml(row.id)}">Anular</button>` : ""}</td>` : ""}</tr>`).join("")}</tbody></table>`;
}

function filteredSales() {
  const term = byId("salesSearch").value.trim().toLocaleLowerCase("pt-PT");
  const selectedStore = byId("salesStoreFilter").value;
  const from = byId("salesFrom").value;
  const to = byId("salesTo").value;
  const sort = byId("salesSort").value;
  return state.sales.filter(row =>
    (selectedStore === "all" || row.storeId === selectedStore)
    && (!from || row.date >= from)
    && (!to || row.date <= to)
    && (!term || `${storeName(row.storeId)} ${row.code} ${row.name}`.toLocaleLowerCase("pt-PT").includes(term))
  ).sort((a, b) => {
    if (sort === "oldest") return `${a.date}${timestampSort(a.createdAt)}`.localeCompare(`${b.date}${timestampSort(b.createdAt)}`);
    if (sort === "quantity-desc") return Number(b.qty) - Number(a.qty);
    if (sort === "quantity-asc") return Number(a.qty) - Number(b.qty);
    return `${b.date}${timestampSort(b.createdAt)}`.localeCompare(`${a.date}${timestampSort(a.createdAt)}`);
  });
}
function renderSales() {
  if (!byId("salesTable")) return;
  const rows = filteredSales();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.pageNumber = Math.min(state.pageNumber, pages - 1);
  byId("salesTable").innerHTML = salesTable(rows.slice(state.pageNumber * PAGE_SIZE, (state.pageNumber + 1) * PAGE_SIZE), true);
  byId("pageInfo").textContent = `Página ${state.pageNumber + 1} de ${pages} · ${rows.length} registos`;
  byId("prevPage").disabled = state.pageNumber === 0;
  byId("nextPage").disabled = state.pageNumber >= pages - 1;
  document.querySelectorAll(".edit-sale").forEach(button => button.addEventListener("click", () => editSale(button.dataset.id)));
  document.querySelectorAll(".view-history").forEach(button => button.addEventListener("click", () => viewSaleHistory(button.dataset.id)));
  document.querySelectorAll(".delete-sale").forEach(button => button.addEventListener("click", () => deleteSale(button.dataset.id)));
  document.querySelectorAll(".edit-sale,.delete-sale").forEach(button => {
    const sale = state.sales.find(row => row.id === button.dataset.id);
    button.disabled = !hasConfirmedConnection() || !sale || sale.pending;
    if (button.disabled) button.title = "Alterações exigem uma ligação confirmada ao Firestore";
  });
}
function viewSaleHistory(id) {
  const sale = state.sales.find(row => row.id === id);
  if (!sale || !sale.history?.length) return;
  const lines = sale.history.map(change =>
    `${change.action === "voided" ? "Anulado" : "Corrigido"} por ${change.changedBy || "utilizador"} em ${change.changedAt || "data não registada"}`
  );
  window.alert(`Histórico do registo ${sale.code}:\n\n${lines.join("\n")}`);
}
byId("salesSearch").addEventListener("input", () => { state.pageNumber = 0; renderSales(); });
byId("salesStoreFilter").addEventListener("change", () => { state.pageNumber = 0; renderSales(); });
byId("salesFrom").addEventListener("change", () => { state.pageNumber = 0; renderSales(); });
byId("salesTo").addEventListener("change", () => { state.pageNumber = 0; renderSales(); });
byId("salesSort").addEventListener("change", () => { state.pageNumber = 0; renderSales(); });
byId("prevPage").addEventListener("click", () => { state.pageNumber = Math.max(0, state.pageNumber - 1); renderSales(); });
byId("nextPage").addEventListener("click", () => { state.pageNumber += 1; renderSales(); });
byId("cancelEdit").addEventListener("click", resetSaleForm);

function duplicateOf(candidate, exceptId = "") {
  const code = String(candidate.code).trim().toLocaleUpperCase("pt-PT");
  const name = String(candidate.name).trim().toLocaleLowerCase("pt-PT");
  return activeSales().some(row => row.id !== exceptId
    && row.date === candidate.date && row.storeId === candidate.storeId
    && row.code.trim().toLocaleUpperCase("pt-PT") === code
    && row.name.trim().toLocaleLowerCase("pt-PT") === name);
}
function validateSale(sale) {
  if (!sale.date || !sale.storeId || !sale.code.trim() || !sale.name.trim()) return "Preenche a data, a loja, o código e o nome do produto.";
  if (!Number.isSafeInteger(sale.qty) || sale.qty < 1) return "A quantidade deve ser um número inteiro positivo.";
  if (sale.code.length > 80 || sale.name.length > 160 || sale.notes.length > 500) return "Um dos campos excede o limite permitido.";
  if (!permittedStores(true).some(store => store.id === sale.storeId)
      && !state.sales.some(row => row.id === byId("saleId").value && row.storeId === sale.storeId)) return "Não tens autorização para registar vendas nesta loja ativa.";
  return "";
}
byId("saleForm").addEventListener("submit", async event => {
  event.preventDefault();
  const id = byId("saleId").value;
  const existing = state.sales.find(row => row.id === id);
  const sale = {
    date: byId("saleDate").value, storeId: byId("saleStore").value,
    code: byId("saleCode").value.trim(), name: byId("saleName").value.trim(),
    qty: Number(byId("saleQty").value), notes: byId("saleNotes").value.trim()
  };
  const problem = validateSale(sale);
  if (problem) { showMessage(problem, "error"); return; }
  if (duplicateOf(sale, id) && !window.confirm("Já existe uma venda com a mesma data, loja, código e nome. Confirmas que é um registo diferente?")) return;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const now = serverTimestamp();
    if (existing) {
      const history = [...(existing.history || []), {
        date: existing.date, storeId: existing.storeId, code: existing.code, name: existing.name,
        qty: existing.qty, notes: existing.notes || "", changedBy: state.user.uid, changedAt: new Date().toISOString()
      }];
      await runTransaction(db, async transaction => {
        const reference = doc(db, "salesEntries", id);
        const current = await transaction.get(reference);
        if (!current.exists() || saleSignature([{ id, ...current.data() }]) !== saleSignature([existing])) {
          throw new Error("O registo foi alterado por outro utilizador. Atualiza a lista e revê os dados antes de editar.");
        }
        transaction.set(reference, {
          ...sale, createdBy: existing.createdBy, createdAt: existing.createdAt,
          updatedBy: state.user.uid, updatedAt: now, history
        });
      });
      showMessage("Registo atualizado. O histórico da alteração foi preservado.", "success");
    } else {
      const newId = crypto.randomUUID();
      await setDoc(doc(db, "salesEntries", newId), {
        ...sale, createdBy: state.user.uid, createdAt: now, updatedBy: state.user.uid, updatedAt: now, history: []
      });
      showMessage(navigator.onLine ? "Registo enviado ao Firestore; a confirmação de sincronização será apresentada no estado." : "Registo guardado localmente e pendente de sincronização. Não desligues os dados deste navegador.", "success");
    }
    resetSaleForm();
    showPage("sales");
  } catch (error) {
    showMessage(`Não foi possível guardar a venda. Os dados continuam no formulário: ${error.message}`, "error");
  } finally {
    button.disabled = false;
  }
});
function resetSaleForm() {
  byId("saleForm").reset();
  byId("saleId").value = "";
  byId("saleDate").value = localDate();
  byId("saleFormTitle").textContent = "Novo registo";
}
function editSale(id) {
  if (!hasConfirmedConnection()) {
    showMessage("Reconecta-te antes de editar. Assim evitamos conflitos e preservamos os dados mais recentes.", "error");
    return;
  }
  const sale = state.sales.find(row => row.id === id);
  if (!sale || sale.pending || !canEdit(sale)) return;
  byId("saleId").value = sale.id;
  byId("saleDate").value = sale.date;
  fillStoreOptions("saleStore", false);
  byId("saleStore").value = sale.storeId;
  byId("saleCode").value = sale.code;
  byId("saleName").value = sale.name;
  byId("saleQty").value = sale.qty;
  byId("saleNotes").value = sale.notes || "";
  byId("saleFormTitle").textContent = "Corrigir registo";
  byId("saleForm").scrollIntoView({ behavior: "smooth" });
}
async function deleteSale(id) {
  if (!isAdmin()) return;
  const sale = state.sales.find(row => row.id === id);
  if (!sale || !(await confirmAction("Anular registo", `Anular a venda ${sale.code} (${formatDate(sale.date)})? O registo será preservado para auditoria e deixará de contar nos totais.`))) return;
  if (!hasConfirmedConnection() || sale.pending) {
    showMessage("A anulação exige uma ligação confirmada ao Firestore. O registo não foi alterado.", "error");
    return;
  }
  try {
    const now = serverTimestamp();
    await runTransaction(db, async transaction => {
      const reference = doc(db, "salesEntries", id);
      const current = await transaction.get(reference);
      if (!current.exists() || saleSignature([{ id, ...current.data() }]) !== saleSignature([sale])) {
        throw new Error("O registo foi alterado por outro utilizador. Atualiza a lista antes de anular.");
      }
      const saleData = current.data();
      transaction.set(reference, {
        ...saleData, voided: true, voidedBy: state.user.uid, voidedAt: now,
        updatedBy: state.user.uid, updatedAt: now,
        history: [...(saleData.history || []), {
          action: "voided", date: saleData.date, storeId: saleData.storeId,
          code: saleData.code, name: saleData.name, qty: saleData.qty,
          notes: saleData.notes || "", changedBy: state.user.uid, changedAt: new Date().toISOString()
        }]
      });
    });
    showMessage("Registo anulado e preservado no histórico.", "success");
  } catch (error) { showMessage(`Não foi possível anular o registo: ${error.message}`, "error"); }
}

function confirmAction(title, text) {
  return new Promise(resolve => {
    const dialog = byId("confirmDialog");
    byId("dialogTitle").textContent = title;
    byId("dialogText").textContent = text;
    dialog.returnValue = "";
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
    dialog.showModal();
  });
}

function renderStores() {
  if (!byId("storesGrid")) return;
  const stores = permittedStores();
  byId("storesGrid").innerHTML = stores.length ? stores.map(store => {
    const salesCount = state.sales.filter(sale => sale.storeId === store.id).length;
    return `<div class="store-card"><div><b>${escapeHtml(store.name)}</b><small>${salesCount} registos visíveis · ${store.active ? "Ativa" : "Inativa"}</small></div><div><span class="badge ${store.active ? "" : "inactive"}">${store.active ? "Ativa" : "Inativa"}</span> <button class="button secondary store-analysis" data-id="${escapeHtml(store.id)}">Ver análise</button>${isAdmin() ? ` <button class="button secondary toggle-store" data-id="${escapeHtml(store.id)}" data-active="${!store.active}">${store.active ? "Desativar" : "Ativar"}</button> <button class="button secondary rename-store" data-id="${escapeHtml(store.id)}">Editar</button>` : ""}</div></div>`;
  }).join("") : '<p class="muted">Não há lojas autorizadas neste perfil.</p>';
  document.querySelectorAll(".store-analysis").forEach(button => button.addEventListener("click", () => {
    fillStoreOptions("analysisStore", true);
    byId("analysisStore").value = button.dataset.id;
    byId("analysisFrom").value = "";
    byId("analysisTo").value = localDate();
    showPage("analysis");
  }));
  document.querySelectorAll(".toggle-store").forEach(button => button.addEventListener("click", () => updateStore(button.dataset.id, { active: button.dataset.active === "true" })));
  document.querySelectorAll(".rename-store").forEach(button => button.addEventListener("click", () => renameStore(button.dataset.id)));
}
byId("addStore").addEventListener("click", async () => {
  const name = window.prompt("Nome da nova loja:");
  if (!name?.trim()) return;
  if (state.stores.some(store => store.name.trim().toLocaleLowerCase("pt-PT") === name.trim().toLocaleLowerCase("pt-PT"))) {
    showMessage("Já existe uma loja com esse nome.", "error");
    return;
  }
  try {
    await setDoc(doc(db, "stores", crypto.randomUUID()), { name: name.trim(), active: true, createdAt: serverTimestamp() });
    showMessage("Loja adicionada.", "success");
  } catch (error) { showMessage(`Não foi possível adicionar a loja: ${error.message}`, "error"); }
});
async function updateStore(id, updates) {
  const store = state.stores.find(item => item.id === id);
  if (!store || !isAdmin()) return;
  try {
    await setDoc(doc(db, "stores", id), { name: store.name, active: updates.active ?? store.active, createdAt: store.createdAt || serverTimestamp(), updatedAt: serverTimestamp() });
    showMessage(updates.active ? "Loja ativada." : "Loja desativada; o histórico permanece associado.", "success");
  } catch (error) { showMessage(`Não foi possível atualizar a loja: ${error.message}`, "error"); }
}
async function renameStore(id) {
  const store = state.stores.find(item => item.id === id);
  if (!store) return;
  const name = window.prompt("Novo nome da loja:", store.name)?.trim();
  if (!name || name === store.name) return;
  try {
    await setDoc(doc(db, "stores", id), { name, active: store.active, createdAt: store.createdAt || serverTimestamp(), updatedAt: serverTimestamp() });
    showMessage("Nome da loja atualizado.", "success");
  } catch (error) { showMessage(`Não foi possível alterar a loja: ${error.message}`, "error"); }
}

function getAnalysisRows() {
  const storeId = byId("analysisStore").value;
  const from = byId("analysisFrom").value || "0000-01-01";
  const to = byId("analysisTo").value || "9999-12-31";
  return activeSales().filter(sale => (storeId === "all" || sale.storeId === storeId) && sale.date >= from && sale.date <= to);
}
function renderAnalysis() {
  if (!byId("analysisTable")) return;
  const rows = getAnalysisRows();
  const products = aggregate(rows);
  byId("analysisTotal").textContent = formatNumber(sum(rows));
  byId("analysisCount").textContent = formatNumber(products.length);
  byId("analysisTop").textContent = products[0] ? `${products[0].code} · ${formatNumber(products[0].qty)}` : "—";
  const low = [...products].filter(product => product.qty > 0).sort((a, b) => a.qty - b.qty)[0];
  byId("analysisLow").textContent = low ? `${low.code} · ${formatNumber(low.qty)}` : "—";
  const from = byId("analysisFrom").value;
  const to = byId("analysisTo").value;
  if (from && to && from <= to) {
    const duration = Math.round((dateAtNoon(to) - dateAtNoon(from)) / 86400000) + 1;
    const previousEnd = dateAtNoon(from);
    previousEnd.setDate(previousEnd.getDate() - 1);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousStart.getDate() - duration + 1);
    const previousRows = activeSales().filter(sale =>
      (byId("analysisStore").value === "all" || sale.storeId === byId("analysisStore").value)
      && sale.date >= localDate(previousStart) && sale.date <= localDate(previousEnd)
    );
    const previousTotal = sum(previousRows);
    const difference = sum(rows) - previousTotal;
    const change = previousTotal ? `${difference > 0 ? "+" : ""}${((difference / previousTotal) * 100).toLocaleString("pt-PT", { maximumFractionDigits: 1 })}%` : (sum(rows) ? "Sem base anterior" : "0%");
    byId("analysisPrevious").textContent = formatNumber(previousTotal);
    byId("analysisChange").textContent = change;
  } else {
    byId("analysisPrevious").textContent = "—";
    byId("analysisChange").textContent = "—";
  }
  renderBars("analysisProducts", products.map(item => ({ label: `${item.code} · ${item.name}`, qty: item.qty })));
  renderBars("analysisStores", permittedStores().map(store => ({ label: store.name, qty: sum(rows.filter(sale => sale.storeId === store.id)) })).sort((a, b) => b.qty - a.qty));
  const groupedByDay = new Map();
  rows.forEach(row => groupedByDay.set(row.date, (groupedByDay.get(row.date) || 0) + Number(row.qty || 0)));
  renderBars("analysisDays", [...groupedByDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, qty]) => ({ label: formatDate(date), qty })), "label", 31);
  byId("analysisTable").innerHTML = products.length ? `<table><thead><tr><th>Posição</th><th>Código</th><th>Produto</th><th class="num">Unidades</th><th>Lojas</th></tr></thead><tbody>${products.map((item, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.name)}</td><td class="num">${formatNumber(item.qty)}</td><td>${item.stores.size}</td></tr>`).join("")}</tbody></table>` : '<p class="empty muted">Sem vendas para o período selecionado.</p>';
}
byId("applyAnalysis").addEventListener("click", renderAnalysis);

function csvEscape(value) {
  let text = String(value ?? "");
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function exportCsvRows(rows, filename) {
  const values = [["data", "loja", "codigo", "produto", "quantidade", "observacoes"]];
  rows.forEach(row => values.push([row.date, storeName(row.storeId), row.code, row.name, row.qty, row.notes || ""]));
  const csv = `\uFEFF${values.map(row => row.map(csvEscape).join(";")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
byId("exportCsv").addEventListener("click", () => exportCsvRows(filteredSales().filter(row => !row.voided), "waleva-vendas.csv"));
byId("analysisCsv").addEventListener("click", () => exportCsvRows(getAnalysisRows(), "waleva-analise.csv"));

function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const separator = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === separator) { row.push(cell.trim()); cell = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim()); cell = "";
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(value => value !== "")) rows.push(row);
  return rows;
}
function normalizeSpreadsheetDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return localDate(value);
  if (typeof value === "number" && window.XLSX) {
    const parsed = window.XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const localized = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return localized ? `${localized[3]}-${localized[2].padStart(2, "0")}-${localized[1].padStart(2, "0")}` : text;
}
byId("csvFile").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("O ficheiro não pode exceder 5 MB.");
    let rows;
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      if (!window.XLSX) throw new Error("O leitor Excel não está disponível. Liga-te à Internet e volta a carregar a página.");
      const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error("O ficheiro Excel não contém folhas.");
      rows = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: true, defval: "" });
    } else {
      rows = parseCsv((await file.text()).replace(/^\uFEFF/, ""));
    }
    if (rows.length < 2) throw new Error("O ficheiro não contém linhas de dados.");
    const headers = rows[0].map(header => header.trim().toLocaleLowerCase("pt-PT"));
    const indexOf = (...names) => headers.findIndex(header => names.includes(header));
    const columns = {
      date: indexOf("data", "date"), store: indexOf("loja", "store"),
      code: indexOf("codigo", "código", "code"), name: indexOf("produto", "nome", "name"),
      qty: indexOf("quantidade", "demanda", "qty"), notes: indexOf("observacoes", "observações", "notes")
    };
    if (Object.values(columns).slice(0, 5).some(index => index < 0)) throw new Error("Faltam colunas obrigatórias: data, loja, codigo, produto e quantidade.");
      const seen = new Set();
      state.importRows = rows.slice(1).map((cells, index) => {
      const storeText = (cells[columns.store] || "").trim();
      const store = state.stores.find(item => item.id === storeText || item.name.toLocaleLowerCase("pt-PT") === storeText.toLocaleLowerCase("pt-PT"));
      const qty = Number((cells[columns.qty] || "").replace(",", "."));
      const sale = {
        date: normalizeSpreadsheetDate(cells[columns.date]), storeId: store?.id || "",
        code: (cells[columns.code] || "").trim(), name: (cells[columns.name] || "").trim(),
        qty, notes: columns.notes < 0 ? "" : (cells[columns.notes] || "").trim()
      };
      const key = `${sale.date}|${sale.storeId}|${sale.code.toLocaleLowerCase("pt-PT")}|${sale.name.toLocaleLowerCase("pt-PT")}`;
      const error = validateImportedSale(sale, store);
      if (!error && seen.has(key)) return { line: index + 2, sale, error: "Possível duplicado neste ficheiro." };
      if (!error) seen.add(key);
      return { line: index + 2, sale, error };
    });
    renderImportPreview();
  } catch (error) { showMessage(`Não foi possível validar o CSV: ${error.message}`, "error"); }
  finally { event.target.value = ""; }
});
function validateImportedSale(sale, store) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sale.date) || Number.isNaN(dateAtNoon(sale.date).getTime()) || localDate(dateAtNoon(sale.date)) !== sale.date) return "Data inválida (use AAAA-MM-DD).";
  if (!store) return "Loja desconhecida.";
  if (!store.active || !permittedStores(true).some(item => item.id === store.id)) return "Loja inativa ou sem autorização.";
  if (!sale.code || !sale.name || !Number.isSafeInteger(sale.qty) || sale.qty < 1) return "Código, produto ou quantidade inválida.";
  if (sale.notes.length > 500) return "Observações excedem 500 caracteres.";
  if (duplicateOf(sale)) return "Possível duplicado.";
  return "";
}
function renderImportPreview() {
  const valid = state.importRows.filter(row => !row.error).length;
  const invalid = state.importRows.length - valid;
  byId("importPreview").innerHTML = state.importRows.length ? `<p>${valid} linhas válidas · ${invalid} linhas com problemas</p><div class="table-wrap"><table><thead><tr><th>Linha</th><th>Data</th><th>Loja</th><th>Código</th><th>Produto</th><th>Qtd.</th><th>Validação</th></tr></thead><tbody>${state.importRows.slice(0, 100).map(row => `<tr><td>${row.line}</td><td>${escapeHtml(row.sale.date)}</td><td>${escapeHtml(storeName(row.sale.storeId) || "—")}</td><td>${escapeHtml(row.sale.code)}</td><td>${escapeHtml(row.sale.name)}</td><td>${escapeHtml(row.sale.qty)}</td><td>${escapeHtml(row.error || "OK")}</td></tr>`).join("")}</tbody></table></div>${state.importRows.length > 100 ? "<p>Pré-visualização limitada às primeiras 100 linhas.</p>" : ""}<button class="button primary" id="commitImport" ${valid === 0 || state.importRows.length > 400 ? "disabled" : ""}>Guardar ${valid} linhas válidas</button>${state.importRows.length > 400 ? "<p class='message'>Importa no máximo 400 linhas de cada vez.</p>" : ""}` : "";
  byId("commitImport")?.addEventListener("click", commitImport);
}
async function commitImport() {
  const rows = state.importRows.filter(row => !row.error);
  if (!rows.length) return;
  try {
    const batch = writeBatch(db);
    rows.forEach(({ sale }) => {
      const now = serverTimestamp();
      batch.set(doc(db, "salesEntries", crypto.randomUUID()), {
        ...sale, createdBy: state.user.uid, createdAt: now, updatedBy: state.user.uid, updatedAt: now, history: []
      });
    });
    await batch.commit();
    state.importRows = [];
    renderImportPreview();
    showMessage(navigator.onLine
      ? `${rows.length} registos enviados; a confirmação de sincronização aparece em cada linha.`
      : `${rows.length} registos guardados neste dispositivo e pendentes de sincronização.`, "success");
  } catch (error) { showMessage(`A importação não foi guardada. Corrige o erro antes de tentar novamente: ${error.message}`, "error"); }
}

function renderCloseReview() {
  if (!byId("closeReview")) return;
  const end = byId("closeDate").value;
  if (!end || !isAdmin()) {
    byId("closeReview").innerHTML = isAdmin() ? "" : '<p class="muted">O fecho semanal está disponível apenas para administradores.</p>';
    byId("confirmClose").disabled = true;
    return;
  }
  const [start, finish] = weekRange(end);
  if (finish !== end) {
    const adjusted = dateAtNoon(end);
    adjusted.setDate(adjusted.getDate() + (6 - adjusted.getDay()));
    byId("closeDate").value = localDate(adjusted);
    return renderCloseReview();
  }
  const rows = within(activeSales(), start, finish);
  const voidedRows = within(state.sales.filter(row => row.voided), start, finish);
  const products = aggregate(rows);
  const alreadyClosed = state.closures.some(closure => closure.start === start && closure.end === finish);
  const periodFinished = finish <= localDate();
  const weekRows = within(state.sales, start, finish);
  state.closeSnapshot = { start, end: finish, rows, products, weekRows };
  const storeRows = permittedStores().map(store => `<tr><td>${escapeHtml(store.name)}</td><td class="num">${formatNumber(sum(rows.filter(row => row.storeId === store.id)))}</td></tr>`).join("");
  const productRows = products.map(product => `<tr><td>${escapeHtml(product.code)}</td><td>${escapeHtml(product.name)}</td><td class="num">${formatNumber(product.qty)}</td></tr>`).join("");
  const changes = [...rows, ...voidedRows].reduce((count, row) => count + (row.history || []).filter(change => change.action !== "voided").length, 0);
  byId("closeReview").innerHTML = `${alreadyClosed ? '<p class="message">Esta semana já tem um fecho registado; não pode ser duplicado.</p>' : ""}${!periodFinished ? '<p class="message">A semana ainda não terminou. O fecho só pode ser confirmado a partir do sábado selecionado.</p>' : ""}<p><b>Período:</b> ${formatDate(start)} – ${formatDate(finish)} · <b>Unidades:</b> ${formatNumber(sum(rows))} · <b>Produtos:</b> ${products.length} · <b>Corrigidos:</b> ${changes} · <b>Anulados:</b> ${voidedRows.length}</p><div class="content-grid"><div><h3>Total por loja</h3><div class="table-wrap"><table><thead><tr><th>Loja</th><th class="num">Unidades</th></tr></thead><tbody>${storeRows || "<tr><td colspan='2'>Sem lojas autorizadas</td></tr>"}</tbody></table></div></div><div><h3>Total por produto</h3><div class="table-wrap"><table><thead><tr><th>Código</th><th>Produto</th><th class="num">Unidades</th></tr></thead><tbody>${productRows || "<tr><td colspan='3'>Sem vendas nesta semana</td></tr>"}</tbody></table></div></div></div><p class="muted tiny">Revisa este resumo antes de confirmar. O fecho guarda uma cópia dos totais e não altera as vendas originais.</p>`;
  byId("confirmClose").disabled = alreadyClosed || !periodFinished || weekRows.length === 0 || !navigator.onLine || state.dataFromCache || weekRows.some(row => row.pending);
}
byId("reviewClose").addEventListener("click", renderCloseReview);
byId("closeDate").addEventListener("change", renderCloseReview);
byId("confirmClose").addEventListener("click", async () => {
  const snapshot = state.closeSnapshot;
  if (!snapshot || !isAdmin() || !hasConfirmedConnection() || snapshot.end > localDate()) {
    showMessage("O fecho exige que a semana tenha terminado e que o Firestore confirme os dados.", "error");
    return;
  }
  if (!(await confirmAction("Confirmar fecho semanal", `Guardar o fecho de ${formatDate(snapshot.start)} a ${formatDate(snapshot.end)} com ${formatNumber(sum(snapshot.rows))} unidades?`))) return;
  const button = byId("confirmClose");
  button.disabled = true;
  const weekId = snapshot.start;
  try {
    const serverSnapshot = await getDocsFromServer(query(collection(db, "salesEntries")));
    const weekRows = serverSnapshot.docs.map(item => ({ id: item.id, ...item.data() })).filter(row => row.date >= snapshot.start && row.date <= snapshot.end);
    if (saleSignature(weekRows) !== saleSignature(snapshot.weekRows)) {
      state.sales = serverSnapshot.docs.map(item => ({ id: item.id, ...item.data(), pending: false }));
      state.dataFromCache = false;
      state.online = true;
      renderAll();
      showMessage("Os dados mudaram desde a revisão. Confere o resumo atualizado e confirma novamente.", "error");
      return;
    }
    const serverSales = activeSales(weekRows);
    const products = aggregate(serverSales);
    const byStore = permittedStores().map(store => ({ storeId: store.id, name: store.name, qty: sum(serverSales.filter(row => row.storeId === store.id)) }));
    await runTransaction(db, async transaction => {
      const closureRef = doc(db, "weeklyClosures", weekId);
      const existing = await transaction.get(closureRef);
      if (existing.exists()) throw new Error("Já existe um fecho para esta semana.");
      transaction.set(closureRef, {
        start: snapshot.start, end: snapshot.end, total: sum(serverSales), byStore,
        byProduct: products.map(({ code, name, qty }) => ({ code, name, qty })),
        correctedRecords: weekRows.reduce((count, row) => count + (row.history || []).filter(change => change.action !== "voided").length, 0),
        voidedRecords: weekRows.filter(row => row.voided).length,
        closedBy: state.user.uid, closedAt: serverTimestamp()
      });
    });
    showMessage("Fecho semanal guardado com confirmação do Firestore.", "success");
  } catch (error) {
    showMessage(`O fecho não foi guardado: ${error.message}`, "error");
    renderCloseReview();
  }
});
byId("printClose").addEventListener("click", () => {
  document.body.classList.add("print-report");
  window.print();
});
window.addEventListener("afterprint", () => document.body.classList.remove("print-report"));
function renderClosures() {
  if (!byId("closuresTable")) return;
  if (!isAdmin()) {
    byId("closuresTable").innerHTML = '<p class="muted">Consulta de fechos disponível para administradores autorizados.</p>';
    return;
  }
  byId("closuresTable").innerHTML = state.closures.length ? `<table><thead><tr><th>Semana</th><th class="num">Unidades</th><th>Fechado por</th><th>Fechado em</th><th>Correções</th><th>Ações</th></tr></thead><tbody>${state.closures.map(closure => {
    const amendments = amendmentsFor(closure.id);
    const currentTotal = amendments[0]?.total ?? closure.total;
    const amendmentHistory = amendments.length
      ? `<details><summary>${amendments.length} correções</summary><ul>${amendments.map(amendment => `<li>${formatNumber(amendment.previousTotal)} → ${formatNumber(amendment.total)} unidades · ${escapeHtml(amendment.reason)} · ${escapeHtml(amendment.correctedBy)}</li>`).join("")}</ul></details>`
      : "—";
    return `<tr><td>${formatDate(closure.start)} – ${formatDate(closure.end)}</td><td class="num">${formatNumber(currentTotal)}</td><td>${escapeHtml(closure.closedBy)}</td><td>${escapeHtml(timestampSort(closure.closedAt).replace("T", " ").slice(0, 16))}</td><td>${amendmentHistory}</td><td><button class="button secondary print-closure" data-id="${escapeHtml(closure.id)}">Imprimir / PDF</button> <button class="button secondary amend-closure" data-id="${escapeHtml(closure.id)}">Registar correção</button></td></tr>`;
  }).join("")}</tbody></table>` : '<p class="empty muted">Ainda não existem fechos semanais.</p>';
  document.querySelectorAll(".amend-closure").forEach(button => button.addEventListener("click", () => amendClosure(button.dataset.id)));
  document.querySelectorAll(".print-closure").forEach(button => button.addEventListener("click", () => {
    const closure = state.closures.find(item => item.id === button.dataset.id);
    if (!closure) return;
    const amendment = amendmentsFor(closure.id)[0];
    const currentTotal = amendment?.total ?? closure.total;
    const report = window.open("", "_blank");
    if (!report) { showMessage("Permite janelas de impressão para abrir o relatório.", "error"); return; }
    report.opener = null;
    const byStore = amendment?.byStore || closure.byStore || [];
    const byProduct = amendment?.byProduct || closure.byProduct || [];
    report.document.write(`<title>Fecho WALEVA ${escapeHtml(formatDate(closure.start))}</title><h1>WALEVA · Fecho semanal</h1><p>${escapeHtml(formatDate(closure.start))} – ${escapeHtml(formatDate(closure.end))}</p><h2>${formatNumber(currentTotal)} unidades</h2><p>Responsável UID: ${escapeHtml(closure.closedBy)}</p><p>Corrigidos: ${amendment?.correctedRecords ?? closure.correctedRecords ?? 0} · Anulados: ${amendment?.voidedRecords ?? closure.voidedRecords ?? 0}</p>${amendment ? `<p>Correção: ${escapeHtml(amendment.reason)} · Responsável: ${escapeHtml(amendment.correctedBy)}</p>` : ""}<h3>Por loja</h3><ul>${byStore.map(store => `<li>${escapeHtml(store.name)}: ${formatNumber(store.qty)}</li>`).join("")}</ul><h3>Por produto</h3><ul>${byProduct.map(product => `<li>${escapeHtml(product.code)} · ${escapeHtml(product.name)}: ${formatNumber(product.qty)}</li>`).join("")}</ul><script>window.print()<\/script>`);
    report.document.close();
  }));
}
function amendmentsFor(closureId) {
  return state.amendments.filter(amendment => amendment.closureId === closureId)
    .sort((a, b) => timestampSort(b.correctedAt).localeCompare(timestampSort(a.correctedAt)));
}
async function amendClosure(id) {
  if (!isAdmin() || !navigator.onLine || state.dataFromCache) {
    showMessage("É necessária uma ligação confirmada ao Firestore para corrigir um fecho.", "error");
    return;
  }
  const closure = state.closures.find(item => item.id === id);
  if (!closure) return;
  const reason = window.prompt("Descreve o motivo da correção do fecho:");
  if (!reason?.trim()) return;
  try {
    const [salesSnapshot, amendmentsSnapshot] = await Promise.all([
      getDocsFromServer(query(collection(db, "salesEntries"))),
      getDocsFromServer(query(collection(db, "weeklyClosureAmendments")))
    ]);
    const rows = salesSnapshot.docs.map(item => ({ id: item.id, ...item.data() }))
      .filter(row => row.date >= closure.start && row.date <= closure.end);
    const validRows = activeSales(rows);
    const products = aggregate(validRows);
    const byStore = permittedStores().map(store => ({
      storeId: store.id, name: store.name,
      qty: sum(validRows.filter(row => row.storeId === store.id))
    }));
    const priorAmendments = amendmentsSnapshot.docs.map(item => item.data()).filter(item => item.closureId === id);
    const latest = priorAmendments.sort((a, b) => timestampSort(b.correctedAt).localeCompare(timestampSort(a.correctedAt)))[0];
    const previousTotal = latest?.total ?? closure.total;
    if (!(await confirmAction("Guardar correção do fecho", `Registar a correção de ${formatDate(closure.start)} a ${formatDate(closure.end)}? Total anterior: ${formatNumber(previousTotal)}; total revisto: ${formatNumber(sum(validRows))}. O fecho original será preservado.`))) return;
    await setDoc(doc(db, "weeklyClosureAmendments", crypto.randomUUID()), {
      closureId: id, previousTotal, total: sum(validRows), reason: reason.trim(),
      byStore, byProduct: products.map(({ code, name, qty }) => ({ code, name, qty })),
      correctedRecords: rows.reduce((count, row) => count + (row.history || []).filter(change => change.action !== "voided").length, 0),
      voidedRecords: rows.filter(row => row.voided).length,
      correctedBy: state.user.uid, correctedAt: serverTimestamp()
    });
    showMessage("Correção guardada como novo registo de auditoria; o fecho original foi preservado.", "success");
  } catch (error) {
    showMessage(`Não foi possível corrigir o fecho: ${error.message}`, "error");
  }
}

byId("userForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdmin()) return;
  const uid = byId("userUid").value.trim();
  const storeIds = [...document.querySelectorAll("#userStoreOptions input:checked")].map(input => input.value);
  if (storeIds.length > 30) {
    showMessage("Um perfil pode ter autorização para, no máximo, 30 lojas.", "error");
    return;
  }
  try {
    await setDoc(doc(db, "users", uid), {
      email: byId("userEmail").value.trim(), role: byId("userRole").value,
      storeIds, active: true, updatedAt: serverTimestamp()
    }, { merge: true });
    event.currentTarget.reset();
    showMessage("Perfil autorizado. A conta tem de existir no Firebase Authentication.", "success");
  } catch (error) { showMessage(`Não foi possível guardar o perfil: ${error.message}`, "error"); }
});
function renderUsers() {
  if (!byId("usersTable") || !isAdmin()) return;
  byId("userStoreOptions").innerHTML = state.stores.map(store => `<label class="check-option"><input type="checkbox" value="${escapeHtml(store.id)}">${escapeHtml(store.name)}</label>`).join("");
  byId("usersTable").innerHTML = state.users.length ? `<h3>Perfis autorizados</h3><table><thead><tr><th>E-mail</th><th>Perfil</th><th>Lojas</th><th>Estado</th><th>Ação</th></tr></thead><tbody>${state.users.map(user => `<tr><td>${escapeHtml(user.email)}</td><td>${escapeHtml(ROLE_NAMES[user.role] || user.role)}</td><td>${escapeHtml((user.storeIds || []).map(storeName).join(", "))}</td><td>${user.active ? "Ativo" : "Inativo"}</td><td><button class="button secondary toggle-user" data-id="${escapeHtml(user.id)}" data-active="${!user.active}" ${user.id === state.user.uid ? "disabled title='Não podes desativar a tua própria conta'" : ""}>${user.active ? "Desativar" : "Ativar"}</button></td></tr>`).join("")}</tbody></table>` : "";
  document.querySelectorAll(".toggle-user").forEach(button => button.addEventListener("click", async () => {
    const user = state.users.find(item => item.id === button.dataset.id);
    if (!user) return;
    try {
      await setDoc(doc(db, "users", user.id), {
        email: user.email, role: user.role, storeIds: user.storeIds || [],
        active: button.dataset.active === "true", updatedAt: serverTimestamp()
      });
    }
    catch (error) { showMessage(`Não foi possível alterar o perfil: ${error.message}`, "error"); }
  }));
}

updateConnectionStatus();
