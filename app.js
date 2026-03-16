import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://jkenultexkujajrdnqsy.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprZW51bHRleGt1amFqcmRucXN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2OTEwMjQsImV4cCI6MjA4OTI2NzAyNH0.28yqUN6ym5n9HPiQovLneZCvCnzg7El3famWrYoiE4U";

const state = {
  session: null,
  profile: null,
  memberships: [],
  activeCompany: null,
  dailyRecords: [],
  cashInitial: { contanti: 0, pos: 0, allianz: 0, postepay: 0 },
  cashMovements: [],
  suppliers: [],
  supplierMovements: [],
  employees: [],
  employeeMovements: [],
  bookings: [],
};

let supabase = null;
let selectedCompanyId = null;
let selectedAlertRecord = null;
let pendingDailyRecord = null;

const $ = (id) => document.getElementById(id);
const n = (v) => Number(v || 0);
const todayStr = () => new Date().toISOString().slice(0, 10);
const euro = (v) =>
  new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(Number(v || 0));

const isSupervisor = () => state.profile?.global_role === "supervisor";

function safeEl(id) {
  return document.getElementById(id);
}

function showGlobalMessage(message, type = "ok") {
  const el = safeEl("globalFeedback");
  if (!el) return;
  el.innerHTML = `<div class="alert ${type === "ok" ? "okline" : ""}">${message}</div>`;
  setTimeout(() => {
    if (el) el.innerHTML = "";
  }, 4000);
}

function showAuthMessage(message, isError = false) {
  const el = safeEl("authFeedback");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#fecaca" : "#bbf7d0";
}

function hideAllViews() {
  ["bootScreen", "authView", "companySelectorView", "appView"].forEach((id) => {
    const el = safeEl(id);
    if (el) el.classList.add("hidden");
  });
}

function seedFields() {
  ["gData", "movData", "fornMovData", "dipMovData", "banData"].forEach((id) => {
    const el = safeEl(id);
    if (el && !el.value) el.value = todayStr();
  });

  const reportMonth = safeEl("reportMonth");
  const reportYear = safeEl("reportYear");

  if (reportMonth && reportMonth.options.length === 0) {
    ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].forEach(
      (m, i) => {
        const op = document.createElement("option");
        op.value = i + 1;
        op.textContent = m;
        reportMonth.appendChild(op);
      }
    );
    reportMonth.value = new Date().getMonth() + 1;
  }

  if (reportYear && reportYear.options.length === 0) {
    [2025, 2026, 2027, 2028].forEach((y) => {
      const op = document.createElement("option");
      op.value = y;
      op.textContent = y;
      reportYear.appendChild(op);
    });
    reportYear.value = new Date().getFullYear();
  }
}

function navigate(sectionId) {
  document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
  const section = safeEl(sectionId);
  if (section) section.classList.add("active");

  document.querySelectorAll(".nav-btn[data-section]").forEach((b) => {
    b.classList.toggle("active", b.dataset.section === sectionId);
  });

  const meta = {
    dashboard: ["Dashboard", "Panoramica rapida di incassi, casse e controlli."],
    giornaliera: ["Scheda giornaliera", "Inserimento rapido di coperti, incassi e produzione."],
    casse: ["Casse", "Gestione saldi iniziali e movimenti manuali."],
    fornitori: ["Fornitori", "Debiti, fatture, pagamenti e sospesi."],
    dipendenti: ["Dipendenti", "Dovuto, pagato, residuo e movimenti del personale."],
    banchetti: ["Prenotazioni / Banchetti", "Eventi, coperti adulti+bambini e importi."],
    report: ["Report base", "Riepilogo mensile per la ditta attiva."],
    superadmin: ["Superadmin", "Gestione aziende e assegnazioni."],
  };

  const pageTitle = safeEl("pageTitle");
  const pageSubtitle = safeEl("pageSubtitle");
  if (pageTitle) pageTitle.textContent = meta[sectionId]?.[0] || "Gestionale";
  if (pageSubtitle) pageSubtitle.textContent = meta[sectionId]?.[1] || "";
}

function getDailyTotals(rec) {
  const pranzoInc = n(rec.pranzo?.contanti) + n(rec.pranzo?.pos);
  const cenaInc = n(rec.cena?.contanti) + n(rec.cena?.pos);
  const banInc = n(rec.banchetti?.contanti) + n(rec.banchetti?.pos);
  const totalIncasso = pranzoInc + cenaInc + banInc;
  const totalCoperti =
    n(rec.pranzo?.coperti) + n(rec.cena?.coperti) + n(rec.banchetti?.coperti);
  return { totalIncasso, totalCoperti };
}

function validateDaily(rec) {
  const alerts = [];
  const totals = getDailyTotals(rec);
  const copertiTot =
    n(rec.pranzo?.coperti) + n(rec.cena?.coperti) + n(rec.banchetti?.coperti);
  const copertiPizzeria = copertiTot - n(rec.copertiRistorante);

  if (copertiPizzeria < 0) {
    alerts.push("Coperti pizzeria negativi: i coperti ristorante superano i coperti totali.");
  }

  if (n(rec.menu) + n(rec.supplementi) > n(rec.copertiRistorante)) {
    alerts.push("Menù + supplementi superano i coperti ristorante.");
  }

  const paymentNoService =
    (n(rec.pranzo?.contanti) + n(rec.pranzo?.pos) > 0 &&
      n(rec.pranzo?.coperti) === 0 &&
      n(rec.pranzo?.asporto) === 0) ||
    (n(rec.cena?.contanti) + n(rec.cena?.pos) > 0 &&
      n(rec.cena?.coperti) === 0 &&
      n(rec.cena?.asporto) === 0) ||
    (n(rec.banchetti?.contanti) + n(rec.banchetti?.pos) > 0 &&
      n(rec.banchetti?.coperti) === 0 &&
      n(rec.banchetti?.asporto) === 0);

  if (paymentNoService) {
    alerts.push("Sono presenti incassi in una colonna con 0 coperti e 0 asporto.");
  }

  if (totals.totalIncasso <= 0 && copertiTot > 0) {
    alerts.push("Ci sono coperti ma l'incasso totale è zero.");
  }

  return alerts;
}

function fillDailyForm(rec) {
  $("gData").value = rec.data || "";
  $("gPizze").value = rec.pizze ?? 0;
  $("gCopertiRistorante").value = rec.copertiRistorante ?? 0;
  $("gMenu").value = rec.menu ?? 0;
  $("gSupplementi").value = rec.supplementi ?? 0;
  $("gPortate").value = rec.portate ?? 0;
  $("gBancone").value = rec.bancone ?? 0;
  $("gNote").value = rec.note || "";

  $("pranzoCoperti").value = rec.pranzo?.coperti ?? 0;
  $("pranzoAsporto").value = rec.pranzo?.asporto ?? 0;
  $("pranzoContanti").value = rec.pranzo?.contanti ?? 0;
  $("pranzoPos").value = rec.pranzo?.pos ?? 0;

  $("cenaCoperti").value = rec.cena?.coperti ?? 0;
  $("cenaAsporto").value = rec.cena?.asporto ?? 0;
  $("cenaContanti").value = rec.cena?.contanti ?? 0;
  $("cenaPos").value = rec.cena?.pos ?? 0;

  $("banchettiCoperti").value = rec.banchetti?.coperti ?? 0;
  $("banchettiAsporto").value = rec.banchetti?.asporto ?? 0;
  $("banchettiContanti").value = rec.banchetti?.contanti ?? 0;
  $("banchettiPos").value = rec.banchetti?.pos ?? 0;
}

function collectDailyFromForm() {
  return {
    data: $("gData").value,
    pizze: n($("gPizze").value),
    copertiRistorante: n($("gCopertiRistorante").value),
    menu: n($("gMenu").value),
    supplementi: n($("gSupplementi").value),
    portate: n($("gPortate").value),
    bancone: n($("gBancone").value),
    note: $("gNote").value.trim(),
    pranzo: {
      coperti: n($("pranzoCoperti").value),
      asporto: n($("pranzoAsporto").value),
      contanti: n($("pranzoContanti").value),
      pos: n($("pranzoPos").value),
    },
    cena: {
      coperti: n($("cenaCoperti").value),
      asporto: n($("cenaAsporto").value),
      contanti: n($("cenaContanti").value),
      pos: n($("cenaPos").value),
    },
    banchetti: {
      coperti: n($("banchettiCoperti").value),
      asporto: n($("banchettiAsporto").value),
      contanti: n($("banchettiContanti").value),
      pos: n($("banchettiPos").value),
    },
  };
}

function supplierSuspeso(supplier) {
  const moves = state.supplierMovements.filter((m) => m.supplier_id === supplier.id);
  const fatture = moves
    .filter((m) => m.tipo === "fattura")
    .reduce((a, b) => a + n(b.importo), 0);
  const pagamenti = moves
    .filter((m) => m.tipo === "pagamento")
    .reduce((a, b) => a + n(b.importo), 0);

  return n(supplier.sospeso_iniziale) + fatture - pagamenti;
}

function employeePaid(employee) {
  return state.employeeMovements
    .filter((m) => m.employee_id === employee.id)
    .reduce((a, b) => a + n(b.importo), 0);
}

function computeCashBalances() {
  const balances = { ...state.cashInitial };

  state.dailyRecords.forEach((rec) => {
    balances.contanti +=
      n(rec.pranzo?.contanti) + n(rec.cena?.contanti) + n(rec.banchetti?.contanti);

    const lordo = n(rec.pranzo?.pos) + n(rec.cena?.pos) + n(rec.banchetti?.pos);
    balances.pos += lordo - lordo * 0.0195;
  });

  state.cashMovements.forEach((m) => {
    balances[m.cassa] += (m.tipo === "entrata" ? 1 : -1) * n(m.importo);
  });

  return balances;
}

function computeGlobalAlerts() {
  const alerts = [];

  state.dailyRecords.forEach((r) => {
    validateDaily(r).forEach((msg) => alerts.push({ title: r.data, text: msg }));
  });

  state.suppliers.forEach((s) => {
    const sosp = supplierSuspeso(s);
    if (sosp > 0) {
      alerts.push({
        title: "Fornitore aperto",
        text: `${s.nome}: sospeso residuo ${euro(sosp)}`,
      });
    }
  });

  state.employees.forEach((e) => {
    const residuo = n(e.dovuto_mensile) - employeePaid(e);
    if (residuo > 0) {
      alerts.push({
        title: "Dipendente da saldare",
        text: `${e.nome}: residuo ${euro(residuo)}`,
      });
    }
  });

  return alerts;
}

async function initSupabase() {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      console.error("Errore getSession:", error);
      hideAllViews();
      safeEl("authView")?.classList.remove("hidden");
      showAuthMessage("Errore Supabase: " + error.message, true);
      return false;
    }

    state.session = session;
    return true;
  } catch (err) {
    console.error("Errore initSupabase:", err);
    hideAllViews();
    safeEl("authView")?.classList.remove("hidden");
    showAuthMessage("Errore avvio app: " + (err?.message || err), true);
    return false;
  }
}

function setAuthTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.authTab === tab);
  });

  safeEl("loginTab")?.classList.toggle("hidden", tab !== "login");
  safeEl("registerTab")?.classList.toggle("hidden", tab !== "register");
}

async function login() {
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value.trim();

  const { error, data } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    showAuthMessage(error.message, true);
    return;
  }

  state.session = data.session;
  await bootstrapAfterAuth();
}

async function register() {
  const email = $("registerEmail")?.value.trim();
  const password = $("registerPassword")?.value.trim();

  const companyName = $("registerCompanyName")?.value.trim() || "";
  const vatNumber = $("registerVatNumber")?.value.trim() || "";
  const phone = $("registerPhone")?.value.trim() || "";

  if (!email || !password || !companyName) {
    showAuthMessage("Compila almeno nome ditta, email e password.", true);
    return;
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        company_name: companyName,
        vat_number: vatNumber,
        phone,
      },
    },
  });

  if (error) {
    showAuthMessage(error.message, true);
    return;
  }

  showAuthMessage(
    "Registrazione completata. Se la conferma email è disattivata puoi entrare subito."
  );
  setAuthTab("login");
  if (safeEl("loginEmail")) $("loginEmail").value = email;
}

async function logout() {
  await supabase.auth.signOut();
  state.session = null;
  state.profile = null;
  state.memberships = [];
  state.activeCompany = null;
  selectedCompanyId = null;
  hideAllViews();
  safeEl("authView")?.classList.remove("hidden");
}

async function fetchProfileAndMemberships() {
  const [{ data: profile, error: pErr }, { data: memberships, error: mErr }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", state.session.user.id).single(),
      supabase
        .from("company_users")
        .select("id, role, company_id, companies(id, name, vat_number)")
        .order("created_at", { ascending: true }),
    ]);

  if (pErr) throw pErr;
  if (mErr) throw mErr;

  state.profile = profile;
  state.memberships = memberships || [];
}

function renderCompanySelector() {
  hideAllViews();
  safeEl("companySelectorView")?.classList.remove("hidden");

  const info = safeEl("companyInfo");
  if (info) {
    info.textContent = `${state.profile?.email || ""} · ${
      isSupervisor() ? "supervisor" : "utente"
    }`;
  }

  const grid = safeEl("companyGrid");
  if (!grid) return;

  grid.innerHTML = state.memberships
    .map(
      (m) => `
    <div class="card company-card ${
      selectedCompanyId === m.company_id ? "selected" : ""
    }" data-company-id="${m.company_id}">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:start;">
        <div>
          <div style="font-weight:800;font-size:18px;">${m.companies.name}</div>
          <div class="muted tiny">${m.companies.vat_number || "P.IVA non inserita"}</div>
        </div>
        <span class="tag">${m.role}</span>
      </div>
    </div>`
    )
    .join("");

  document.querySelectorAll(".company-card").forEach((card) => {
    card.addEventListener("click", () => {
      selectedCompanyId = card.dataset.companyId;
      renderCompanySelector();
    });
  });
}

async function bootstrapAfterAuth() {
  await fetchProfileAndMemberships();

  if (state.memberships.length === 0) {
    hideAllViews();
    safeEl("authView")?.classList.remove("hidden");
    showAuthMessage("Questo account non è collegato a nessuna ditta.", true);
    return;
  }

  if (isSupervisor() || state.memberships.length > 1) {
    selectedCompanyId = selectedCompanyId || state.memberships[0].company_id;
    renderCompanySelector();
  } else {
    selectedCompanyId = state.memberships[0].company_id;
    await openCompany(selectedCompanyId);
  }
}

async function openCompany(companyId) {
  const membership = state.memberships.find((m) => m.company_id === companyId);
  if (!membership) return;

  state.activeCompany = {
    id: companyId,
    name: membership.companies.name,
    role: membership.role,
  };

  const companyName = safeEl("activeCompanyName");
  const companyRole = safeEl("activeCompanyRole");
  if (companyName) companyName.textContent = membership.companies.name;
  if (companyRole) companyRole.textContent = `Ruolo: ${membership.role}`;

  hideAllViews();
  safeEl("appView")?.classList.remove("hidden");
  seedFields();
  await refreshData();
}

async function fetchCompanyTable(table, orderColumn = "created_at", ascending = true) {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("company_id", state.activeCompany.id)
    .order(orderColumn, { ascending });

  if (error) throw error;
  return data || [];
}

async function loadCompanyData() {
  const [
    daily_records,
    cash_state,
    cash_movements,
    suppliers,
    supplier_movements,
    employees,
    employee_movements,
    bookings,
  ] = await Promise.all([
    fetchCompanyTable("daily_records", "data", true),
    fetchCompanyTable("cash_state", "kind", true),
    fetchCompanyTable("cash_movements", "data", true),
    fetchCompanyTable("suppliers", "nome", true),
    fetchCompanyTable("supplier_movements", "data", true),
    fetchCompanyTable("employees", "nome", true),
    fetchCompanyTable("employee_movements", "data", true),
    fetchCompanyTable("bookings", "data", true),
  ]);

  state.dailyRecords = daily_records.map((r) => r.payload);
  state.cashMovements = cash_movements;
  state.suppliers = suppliers;
  state.supplierMovements = supplier_movements;
  state.employees = employees;
  state.employeeMovements = employee_movements;
  state.bookings = bookings;

  state.cashInitial = { contanti: 0, pos: 0, allianz: 0, postepay: 0 };
  cash_state.forEach((r) => {
    state.cashInitial[r.kind] = n(r.amount);
  });
}

async function refreshData(message = null) {
  try {
    await loadCompanyData();
    renderAll();
    if (message) showGlobalMessage(message);
  } catch (err) {
    console.error(err);
    showGlobalMessage(err.message || "Errore caricamento dati", "error");
  }
}

async function upsertCashState(kind, amount) {
  const { error } = await supabase
    .from("cash_state")
    .upsert({ company_id: state.activeCompany.id, kind, amount }, { onConflict: "company_id,kind" });

  if (error) throw error;
}

async function saveCashInitial() {
  try {
    await Promise.all([
      upsertCashState("contanti", n($("cashInitContanti").value)),
      upsertCashState("pos", n($("cashInitPos").value)),
      upsertCashState("allianz", n($("cashInitAllianz").value)),
      upsertCashState("postepay", n($("cashInitPostepay").value)),
    ]);

    await refreshData("Saldi iniziali salvati.");
  } catch (err) {
    showGlobalMessage(err.message, "error");
  }
}

async function saveCashMovement() {
  const payload = {
    company_id: state.activeCompany.id,
    data: $("movData").value,
    cassa: $("movCassa").value,
    tipo: $("movTipo").value,
    importo: n($("movImporto").value),
    descrizione: $("movDescrizione").value.trim(),
  };

  if (!payload.data || !payload.descrizione || payload.importo <= 0) {
    showGlobalMessage("Compila data, descrizione e importo.", "error");
    return;
  }

  const { error } = await supabase.from("cash_movements").insert(payload);
  if (error) {
    showGlobalMessage(error.message, "error");
    return;
  }

  await refreshData("Movimento di cassa salvato.");
}

async function persistDailyRecord(rec) {
  const { error } = await supabase
    .from("daily_records")
    .upsert(
      { company_id: state.activeCompany.id, data: rec.data, payload: rec },
      { onConflict: "company_id,data" }
    );

  if (error) {
    showGlobalMessage(error.message, "error");
    return false;
  }
  return true;
}

function openConfirmSaveModal(rec, alerts) {
  pendingDailyRecord = rec;
  const dateEl = safeEl("confirmSaveDate");
  const alertsEl = safeEl("confirmSaveAlerts");
  const modal = safeEl("confirmSaveModal");

  if (dateEl) dateEl.textContent = `Giornata: ${rec.data}`;
  if (alertsEl) {
    alertsEl.innerHTML = alerts
      .map(
        (a) => `<div class="item"><div><strong>Alert</strong><small>${a}</small></div></div>`
      )
      .join("");
  }
  modal?.classList.remove("hidden");
}

function closeConfirmSaveModal() {
  safeEl("confirmSaveModal")?.classList.add("hidden");
}

async function forceSavePendingDay() {
  if (!pendingDailyRecord) return;
  const ok = await persistDailyRecord(pendingDailyRecord);
  if (!ok) return;

  const fb = safeEl("giornalieraFeedback");
  if (fb) {
    fb.innerHTML =
      `<div class="alert">Scheda salvata con alert confermati. Controlla i dati quando puoi.</div>`;
  }

  closeConfirmSaveModal();
  pendingDailyRecord = null;
  await refreshData("Scheda giornaliera salvata.");
}

async function saveDaily() {
  const rec = collectDailyFromForm();
  if (!rec.data) {
    showGlobalMessage("Inserisci la data.", "error");
    return;
  }

  const alerts = validateDaily(rec);
  if (alerts.length) {
    openConfirmSaveModal(rec, alerts);
    return;
  }

  const ok = await persistDailyRecord(rec);
  if (!ok) return;

  const fb = safeEl("giornalieraFeedback");
  if (fb) {
    fb.innerHTML =
      `<div class="alert okline">Giornata salvata correttamente. Nessun alert bloccante nella V1.</div>`;
  }

  await refreshData("Scheda giornaliera salvata.");
}

async function deleteDailyByDate(dateStr) {
  if (!confirm(`Vuoi davvero cancellare la giornata ${dateStr}?`)) return;

  const { error } = await supabase
    .from("daily_records")
    .delete()
    .eq("company_id", state.activeCompany.id)
    .eq("data", dateStr);

  if (error) {
    showGlobalMessage(error.message, "error");
    return;
  }

  await refreshData("Giornata cancellata.");
}

function loadDailyByDate(dateStr) {
  const rec = state.dailyRecords.find((r) => r.data === dateStr);
  if (!rec) return;

  fillDailyForm(rec);
  navigate("giornaliera");

  const fb = safeEl("giornalieraFeedback");
  if (fb) {
    fb.innerHTML =
      `<div class="alert okline">Hai caricato la giornata ${rec.data} nel form. Modifica i campi e premi "Salva giornata".</div>`;
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveSupplier() {
  const nome = $("fornNome").value.trim();
  const alias = $("fornAlias").value.trim();
  const sospeso_iniziale = n($("fornSospeso").value);

  if (!nome) {
    showGlobalMessage("Inserisci il nome del fornitore.", "error");
    return;
  }

  const existing = state.suppliers.find((s) => s.nome.toLowerCase() === nome.toLowerCase());
  const aliases = [...(existing?.aliases || [])];
  if (alias && !aliases.includes(alias)) aliases.push(alias);

  const payload = {
    company_id: state.activeCompany.id,
    nome,
    aliases,
    sospeso_iniziale,
  };

  const result = existing
    ? await supabase.from("suppliers").update(payload).eq("id", existing.id)
    : await supabase.from("suppliers").insert(payload);

  if (result.error) {
    showGlobalMessage(result.error.message, "error");
    return;
  }

  await refreshData("Fornitore salvato.");
}

async function saveSupplierMovement() {
  const supplier = state.suppliers.find((s) => s.nome === $("fornMovNome").value);

  const payload = {
    company_id: state.activeCompany.id,
    supplier_id: supplier?.id,
    data: $("fornMovData").value,
    tipo: $("fornMovTipo").value,
    importo: n($("fornMovImporto").value),
    nota: $("fornMovNota").value.trim(),
  };

  if (!payload.supplier_id || !payload.data || payload.importo <= 0) {
    showGlobalMessage("Controlla fornitore, data e importo.", "error");
    return;
  }

  const { error } = await supabase.from("supplier_movements").insert(payload);
  if (error) {
    showGlobalMessage(error.message, "error");
    return;
  }

  await refreshData("Movimento fornitore salvato.");
}

async function saveEmployee() {
  const nome = $("dipNome").value.trim();
  const ruolo = $("dipRuolo").value.trim();
  const dovuto_mensile = n($("dipDovuto").value);

  if (!nome) {
    showGlobalMessage("Inserisci il nome del dipendente.", "error");
    return;
  }

  const existing = state.employees.find((e) => e.nome.toLowerCase() === nome.toLowerCase());
  const payload = { company_id: state.activeCompany.id, nome, ruolo, dovuto_mensile };

  const result = existing
    ? await supabase.from("employees").update(payload).eq("id", existing.id)
    : await supabase.from("employees").insert(payload);

  if (result.error) {
    showGlobalMessage(result.error.message, "error");
    return;
  }

  await refreshData("Dipendente salvato.");
}

async function saveEmployeeMovement() {
  const employee = state.employees.find((e) => e.nome === $("dipMovNome").value);

  const payload = {
    company_id: state.activeCompany.id,
    employee_id: employee?.id,
    data: $("dipMovData").value,
    tipo: $("dipMovTipo").value,
    importo: n($("dipMovImporto").value),
    nota: $("dipMovNota").value.trim(),
  };

  if (!payload.employee_id || !payload.data || payload.importo <= 0) {
    showGlobalMessage("Controlla dipendente, data e importo.", "error");
    return;
  }

  const { error } = await supabase.from("employee_movements").insert(payload);
  if (error) {
    showGlobalMessage(error.message, "error");
    return;
  }

  await refreshData("Movimento dipendente salvato.");
}

function fillBookingForm(b) {
  $("banData").value = b.data || "";
  $("banNome").value = b.nome || "";
  $("banAdulti").value = b.adulti ?? 0;
  $("banBambini").value = b.bambini ?? 0;
  $("banTipo").value = b.tipo || "banchetto";
  $("banImporto").value = b.importo ?? 0;
  $("banOra").value = b.ora || "";
  $("banNote").value = b.note || "";
}

async function saveBooking() {
  const existingId = $("saveBanBtn")?.dataset.editId || "";

  const payload = {
    company_id: state.activeCompany.id,
    data: $("banData").value,
    nome: $("banNome").value.trim(),
    adulti: n($("banAdulti").value),
    bambini: n($("banBambini").value),
    tipo: $("banTipo").value,
    importo: n($("banImporto").value),
    ora: $("banOra").value.trim(),
    note: $("banNote").value.trim(),
  };

  if (!payload.data || !payload.nome) {
    showGlobalMessage("Inserisci data e nome evento.", "error");
    return;
  }

  const query = existingId
    ? supabase
        .from("bookings")
        .update(payload)
        .eq("id", existingId)
        .eq("company_id", state.activeCompany.id)
    : supabase.from("bookings").insert(payload);

  const { error } = await query;
  if (error) {
    showGlobalMessage(error.message, "error");
    return;
  }

  const btn = safeEl("saveBanBtn");
  if (btn) {
    btn.dataset.editId = "";
    btn.textContent = "Salva prenotazione";
  }

  await refreshData(existingId ? "Prenotazione aggiornata." : "Prenotazione salvata.");
}

function editBookingById(id) {
  const b = state.bookings.find((x) => x.id === id);
  if (!b) return;

  fillBookingForm(b);

  const btn = safeEl("saveBanBtn");
  if (btn) {
    btn.dataset.editId = id;
    btn.textContent = "Aggiorna prenotazione";
  }

  navigate("banchetti");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteBookingById(id) {
  const b = state.bookings.find((x) => x.id === id);
  if (!b) return;

  if (!confirm(`Vuoi davvero cancellare la prenotazione "${b.nome}" del ${b.data}?`)) return;

  const { error } = await supabase
    .from("bookings")
    .delete()
    .eq("id", id)
    .eq("company_id", state.activeCompany.id);

  if (error) {
    showGlobalMessage(error.message, "error");
    return;
  }

  await refreshData("Prenotazione cancellata.");
}

async function exportBackup() {
  const snapshot = {
    company: state.activeCompany,
    exported_at: new Date().toISOString(),
    dailyRecords: state.dailyRecords,
    cashInitial: state.cashInitial,
    cashMovements: state.cashMovements,
    suppliers: state.suppliers,
    supplierMovements: state.supplierMovements,
    employees: state.employees,
    employeeMovements: state.employeeMovements,
    bookings: state.bookings,
  };

  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: "application/json",
  });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `backup_${state.activeCompany.name.replaceAll(" ", "_")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importBackup(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!confirm(`Importare il backup nella ditta attiva: ${state.activeCompany.name}?`)) {
      return;
    }

    for (const rec of data.dailyRecords || []) {
      await supabase.from("daily_records").upsert(
        {
          company_id: state.activeCompany.id,
          data: rec.data,
          payload: rec,
        },
        { onConflict: "company_id,data" }
      );
    }

    if (data.cashInitial) {
      for (const [kind, amount] of Object.entries(data.cashInitial)) {
        await supabase
          .from("cash_state")
          .upsert(
            { company_id: state.activeCompany.id, kind, amount },
            { onConflict: "company_id,kind" }
          );
      }
    }

    for (const m of data.cashMovements || []) {
      await supabase.from("cash_movements").insert({
        company_id: state.activeCompany.id,
        data: m.data,
        cassa: m.cassa,
        tipo: m.tipo,
        importo: m.importo,
        descrizione: m.descrizione || "",
      });
    }

    const supplierIdMap = {};
    for (const s of data.suppliers || []) {
      const res = await supabase
        .from("suppliers")
        .insert({
          company_id: state.activeCompany.id,
          nome: s.nome,
          aliases: s.aliases || [],
          sospeso_iniziale: n(s.sospeso_iniziale || s.sospesoIniziale || 0),
        })
        .select("id,nome")
        .single();

      if (!res.error && res.data) supplierIdMap[s.nome] = res.data.id;
    }

    for (const sm of data.supplierMovements || []) {
      const sid = sm.supplier_id || supplierIdMap[sm.supplier_nome] || supplierIdMap[sm.nome];
      if (sid) {
        await supabase.from("supplier_movements").insert({
          company_id: state.activeCompany.id,
          supplier_id: sid,
          data: sm.data,
          tipo: sm.tipo,
          importo: sm.importo,
          nota: sm.nota || "",
        });
      }
    }

    const employeeIdMap = {};
    for (const e of data.employees || []) {
      const res = await supabase
        .from("employees")
        .insert({
          company_id: state.activeCompany.id,
          nome: e.nome,
          ruolo: e.ruolo || "",
          dovuto_mensile: n(e.dovuto_mensile || e.dovutoMensile || 0),
        })
        .select("id,nome")
        .single();

      if (!res.error && res.data) employeeIdMap[e.nome] = res.data.id;
    }

    for (const em of data.employeeMovements || []) {
      const eid = em.employee_id || employeeIdMap[em.employee_nome] || employeeIdMap[em.nome];
      if (eid) {
        await supabase.from("employee_movements").insert({
          company_id: state.activeCompany.id,
          employee_id: eid,
          data: em.data,
          tipo: em.tipo,
          importo: em.importo,
          nota: em.nota || "",
        });
      }
    }

    for (const b of data.bookings || []) {
      await supabase.from("bookings").insert({
        company_id: state.activeCompany.id,
        data: b.data,
        nome: b.nome,
        adulti: b.adulti,
        bambini: b.bambini,
        tipo: b.tipo,
        importo: b.importo,
        ora: b.ora || "",
        note: b.note || "",
      });
    }

    await refreshData("Backup importato nella ditta attiva.");
  } catch (err) {
    showGlobalMessage("Backup non valido: " + err.message, "error");
  }
}

function openAlertModalByDate(dateStr) {
  const rec = state.dailyRecords.find((r) => r.data === dateStr);
  if (!rec) return;

  selectedAlertRecord = rec;
  const alerts = validateDaily(rec);
  const totals = getDailyTotals(rec);

  const dateEl = safeEl("alertModalDate");
  const reasons = safeEl("alertReasons");
  const summary = safeEl("alertQuickSummary");
  const modal = safeEl("alertModal");

  if (dateEl) dateEl.textContent = `Giornata: ${rec.data}`;

  if (reasons) {
    reasons.innerHTML = alerts.length
      ? alerts
          .map(
            (a) => `<div class="item"><div><strong>Alert</strong><small>${a}</small></div></div>`
          )
          .join("")
      : `<div class="alert okline">Nessun alert attivo per questa giornata.</div>`;
  }

  const summaryItems = [
    ["Coperti totali", totals.totalCoperti],
    ["Coperti ristorante", rec.copertiRistorante ?? 0],
    ["Incasso totale", euro(totals.totalIncasso)],
    ["Pizze", rec.pizze ?? 0],
    ["Menù / Supplementi", `${rec.menu ?? 0} / ${rec.supplementi ?? 0}`],
    [
      "Pranzo",
      `Coperti ${rec.pranzo?.coperti ?? 0} · Contanti ${euro(
        rec.pranzo?.contanti ?? 0
      )} · POS ${euro(rec.pranzo?.pos ?? 0)}`,
    ],
    [
      "Cena",
      `Coperti ${rec.cena?.coperti ?? 0} · Contanti ${euro(
        rec.cena?.contanti ?? 0
      )} · POS ${euro(rec.cena?.pos ?? 0)}`,
    ],
    [
      "Banchetti",
      `Coperti ${rec.banchetti?.coperti ?? 0} · Contanti ${euro(
        rec.banchetti?.contanti ?? 0
      )} · POS ${euro(rec.banchetti?.pos ?? 0)}`,
    ],
  ];

  if (summary) {
    summary.innerHTML = summaryItems
      .map(
        ([t, v]) => `<div class="item"><div><strong>${t}</strong></div><div>${v}</div></div>`
      )
      .join("");
  }

  modal?.classList.remove("hidden");
}

function closeAlertModal() {
  safeEl("alertModal")?.classList.add("hidden");
}

function editSelectedAlertDay() {
  if (!selectedAlertRecord) return;
  fillDailyForm(selectedAlertRecord);
  closeAlertModal();
  navigate("giornaliera");

  const fb = safeEl("giornalieraFeedback");
  if (fb) {
    fb.innerHTML =
      `<div class="alert okline">Hai caricato la giornata ${selectedAlertRecord.data} nel form. Modifica i campi e premi "Salva giornata".</div>`;
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderDashboard() {
  const last = [...state.dailyRecords].sort((a, b) => b.data.localeCompare(a.data))[0];
  const totals = last ? getDailyTotals(last) : { totalIncasso: 0, totalCoperti: 0 };
  const alerts = computeGlobalAlerts();
  const balances = computeCashBalances();

  safeEl("kpiIncasso") && (safeEl("kpiIncasso").textContent = euro(totals.totalIncasso));
  safeEl("kpiCoperti") && (safeEl("kpiCoperti").textContent = totals.totalCoperti);
  safeEl("kpiFornitori") &&
    (safeEl("kpiFornitori").textContent = state.suppliers.filter((s) => supplierSuspeso(s) > 0).length);
  safeEl("kpiAlert") && (safeEl("kpiAlert").textContent = alerts.length);

  safeEl("cashContanti") && (safeEl("cashContanti").textContent = euro(balances.contanti));
  safeEl("cashPos") && (safeEl("cashPos").textContent = euro(balances.pos));
  safeEl("cashAllianz") && (safeEl("cashAllianz").textContent = euro(balances.allianz));
  safeEl("cashPostepay") && (safeEl("cashPostepay").textContent = euro(balances.postepay));

  const alertsBox = safeEl("alertsBox");
  if (alertsBox) {
    alertsBox.innerHTML = alerts.length
      ? alerts
          .slice(0, 8)
          .map(
            (a) =>
              `<div class="item alert-row" data-alert-date="${a.title}" style="cursor:pointer;">
                <div><strong>${a.title}</strong><small>${a.text}</small></div>
                <span class="tag">vedi</span>
              </div>`
          )
          .join("")
      : `<div class="alert okline">Nessun alert attivo.</div>`;

    document.querySelectorAll(".alert-row").forEach((row) => {
      row.addEventListener("click", () => openAlertModalByDate(row.dataset.alertDate));
    });
  }

  const dashboardFornitori = safeEl("dashboardFornitori");
  if (dashboardFornitori) {
    dashboardFornitori.innerHTML =
      state.suppliers
        .slice(-5)
        .reverse()
        .map(
          (s) => `
            <div class="item">
              <div><strong>${s.nome}</strong><small>${(s.aliases || []).join(", ") || "nessun alias"}</small></div>
              <div>${euro(supplierSuspeso(s))}</div>
            </div>`
        )
        .join("") || `<div class="muted tiny">Nessun fornitore registrato.</div>`;
  }

  const dashboardBanchetti = safeEl("dashboardBanchetti");
  if (dashboardBanchetti) {
    dashboardBanchetti.innerHTML =
      state.bookings
        .slice(-5)
        .reverse()
        .map(
          (b) => `
            <div class="item">
              <div><strong>${b.nome}</strong><small>${b.data} · ${b.tipo}</small></div>
              <div>${b.adulti}+${b.bambini}</div>
            </div>`
        )
        .join("") || `<div class="muted tiny">Nessuna prenotazione registrata.</div>`;
  }
}

function renderDailyTable() {
  const tbody = safeEl("giorniTable");
  if (!tbody) return;

  tbody.innerHTML = state.dailyRecords
    .map((r) => {
      const totals = getDailyTotals(r);
      const alerts = validateDaily(r);

      return `<tr>
        <td><button class="btn ghost day-edit-btn" data-day-date="${r.data}" style="padding:6px 10px;">${r.data}</button></td>
        <td>${totals.totalCoperti}</td>
        <td>${euro(totals.totalIncasso)}</td>
        <td>${r.pizze}</td>
        <td>${r.menu} / ${r.supplementi}</td>
        <td style="display:flex;gap:8px;flex-wrap:wrap;">
          ${
            alerts.length
              ? `<button class="btn ghost day-alert-btn" data-alert-date="${r.data}" style="padding:6px 10px;color:#fca5a5;">Alert</button>`
              : '<span class="ok">OK</span>'
          }
          <button class="btn ghost day-delete-btn" data-day-date="${r.data}" style="padding:6px 10px;">Cancella</button>
        </td>
      </tr>`;
    })
    .join("");

  document.querySelectorAll(".day-alert-btn").forEach((btn) => {
    btn.addEventListener("click", () => openAlertModalByDate(btn.dataset.alertDate));
  });

  document.querySelectorAll(".day-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => loadDailyByDate(btn.dataset.dayDate));
  });

  document.querySelectorAll(".day-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteDailyByDate(btn.dataset.dayDate));
  });
}

function renderCash() {
  safeEl("cashInitContanti") && (safeEl("cashInitContanti").value = state.cashInitial.contanti || 0);
  safeEl("cashInitPos") && (safeEl("cashInitPos").value = state.cashInitial.pos || 0);
  safeEl("cashInitAllianz") && (safeEl("cashInitAllianz").value = state.cashInitial.allianz || 0);
  safeEl("cashInitPostepay") && (safeEl("cashInitPostepay").value = state.cashInitial.postepay || 0);

  const tbody = safeEl("movimentiTable");
  if (!tbody) return;

  tbody.innerHTML = state.cashMovements
    .map(
      (m) => `<tr>
        <td>${m.data}</td>
        <td>${m.cassa}</td>
        <td>${m.tipo}</td>
        <td>${m.descrizione || ""}</td>
        <td>${euro(m.importo)}</td>
      </tr>`
    )
    .join("");
}

function renderSuppliers() {
  const select = safeEl("fornMovNome");
  if (select) {
    select.innerHTML = state.suppliers.map((s) => `<option value="${s.nome}">${s.nome}</option>`).join("");
  }

  const tbody = safeEl("fornitoriTable");
  if (!tbody) return;

  tbody.innerHTML = state.suppliers
    .map((s) => {
      const sosp = supplierSuspeso(s);
      const last = state.supplierMovements.filter((m) => m.supplier_id === s.id).slice(-1)[0];

      return `<tr>
        <td>${s.nome}</td>
        <td>${(s.aliases || []).join(", ") || "—"}</td>
        <td>${euro(sosp)}</td>
        <td>${last ? `${last.data} · ${last.tipo} ${euro(last.importo)}` : "—"}</td>
        <td>${sosp > 0 ? '<span class="warn">Aperto</span>' : '<span class="ok">Chiuso</span>'}</td>
      </tr>`;
    })
    .join("");
}

function renderEmployees() {
  const select = safeEl("dipMovNome");
  if (select) {
    select.innerHTML = state.employees.map((e) => `<option value="${e.nome}">${e.nome}</option>`).join("");
  }

  const tbody = safeEl("dipendentiTable");
  if (!tbody) return;

  tbody.innerHTML = state.employees
    .map((e) => {
      const pagato = employeePaid(e);
      const residuo = n(e.dovuto_mensile) - pagato;

      return `<tr>
        <td>${e.nome}</td>
        <td>${e.ruolo || "—"}</td>
        <td>${euro(e.dovuto_mensile)}</td>
        <td>${euro(pagato)}</td>
        <td>${residuo > 0 ? `<span class="warn">${euro(residuo)}</span>` : `<span class="ok">${euro(residuo)}</span>`}</td>
      </tr>`;
    })
    .join("");
}

function renderBookings() {
  const tbody = safeEl("banchettiTable");
  if (!tbody) return;

  tbody.innerHTML = state.bookings
    .map(
      (b) => `<tr>
        <td>${b.data}</td>
        <td>${b.nome}</td>
        <td>${b.adulti}+${b.bambini}</td>
        <td>${b.tipo}</td>
        <td>${euro(b.importo)}</td>
        <td>${[b.ora, b.note].filter(Boolean).join(" · ") || "—"}</td>
        <td style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn ghost booking-edit-btn" data-booking-id="${b.id}" style="padding:6px 10px;">Modifica</button>
          <button class="btn ghost booking-delete-btn" data-booking-id="${b.id}" style="padding:6px 10px;">Cancella</button>
        </td>
      </tr>`
    )
    .join("");

  document.querySelectorAll(".booking-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => editBookingById(btn.dataset.bookingId));
  });

  document.querySelectorAll(".booking-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteBookingById(btn.dataset.bookingId));
  });
}

function runMonthlyReport() {
  const monthEl = safeEl("reportMonth");
  const yearEl = safeEl("reportYear");
  if (!monthEl || !yearEl) return;

  const month = String(monthEl.value).padStart(2, "0");
  const year = String(yearEl.value);

  const records = state.dailyRecords.filter((r) => r.data.startsWith(`${year}-${month}`));

  let copPranzo = 0;
  let copCena = 0;
  let copBanchetti = 0;
  let incasso = 0;
  let asporto = 0;
  let bancone = 0;
  let pizze = 0;

  records.forEach((r) => {
    copPranzo += n(r.pranzo?.coperti);
    copCena += n(r.cena?.coperti);
    copBanchetti += n(r.banchetti?.coperti);
    incasso += getDailyTotals(r).totalIncasso;
    asporto += n(r.pranzo?.asporto) + n(r.cena?.asporto) + n(r.banchetti?.asporto);
    bancone += n(r.bancone);
    pizze += n(r.pizze);
  });

  safeEl("rCopPranzo") && (safeEl("rCopPranzo").textContent = copPranzo);
  safeEl("rCopCena") && (safeEl("rCopCena").textContent = copCena);
  safeEl("rCopBanchetti") && (safeEl("rCopBanchetti").textContent = copBanchetti);
  safeEl("rIncasso") && (safeEl("rIncasso").textContent = euro(incasso));

  const summary = safeEl("reportSummary");
  if (!summary) return;

  summary.innerHTML = [
    `<div class="item"><div><strong>Totale coperti complessivi</strong><small>pranzo + cena + banchetti</small></div><div>${
      copPranzo + copCena + copBanchetti
    }</div></div>`,
    `<div class="item"><div><strong>Asporto totale</strong><small>somma delle tre colonne</small></div><div>${euro(
      asporto
    )}</div></div>`,
    `<div class="item"><div><strong>Bancone totale</strong><small>incasso registrato a bancone</small></div><div>${euro(
      bancone
    )}</div></div>`,
    `<div class="item"><div><strong>Pizze totali</strong><small>somma delle giornate del mese</small></div><div>${pizze}</div></div>`,
    `<div class="item"><div><strong>Giornate presenti</strong><small>schede giornaliere salvate nel mese</small></div><div>${records.length}</div></div>`,
  ].join("");
}

function renderAll() {
  renderDashboard();
  renderDailyTable();
  renderCash();
  renderSuppliers();
  renderEmployees();
  renderBookings();
  runMonthlyReport();
}

function bindEvents() {
  document.querySelectorAll(".nav-btn[data-section]").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.section));
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setAuthTab(btn.dataset.authTab));
  });

  safeEl("loginBtn")?.addEventListener("click", login);
  safeEl("registerBtn")?.addEventListener("click", register);
  safeEl("logoutBtn")?.addEventListener("click", logout);
  safeEl("selectorLogoutBtn")?.addEventListener("click", logout);

  safeEl("enterCompanyBtn")?.addEventListener("click", async () => {
    if (!selectedCompanyId) {
      alert("Seleziona una ditta.");
      return;
    }
    await openCompany(selectedCompanyId);
  });

  safeEl("switchCompanyBtn")?.addEventListener("click", () => {
    if (isSupervisor() || state.memberships.length > 1) renderCompanySelector();
  });

  safeEl("saveDayBtn")?.addEventListener("click", saveDaily);
  safeEl("saveCashInitBtn")?.addEventListener("click", saveCashInitial);
  safeEl("saveMovBtn")?.addEventListener("click", saveCashMovement);
  safeEl("saveFornBtn")?.addEventListener("click", saveSupplier);
  safeEl("saveFornMovBtn")?.addEventListener("click", saveSupplierMovement);
  safeEl("saveDipBtn")?.addEventListener("click", saveEmployee);
  safeEl("saveDipMovBtn")?.addEventListener("click", saveEmployeeMovement);
  safeEl("saveBanBtn")?.addEventListener("click", saveBooking);
  safeEl("runReportBtn")?.addEventListener("click", runMonthlyReport);
  safeEl("refreshBtn")?.addEventListener("click", () => refreshData("Dati aggiornati dal cloud."));
  safeEl("backupBtn")?.addEventListener("click", exportBackup);

  safeEl("importFile")?.addEventListener("change", (e) => {
    if (e.target.files?.[0]) importBackup(e.target.files[0]);
  });

  safeEl("closeAlertModalBtn")?.addEventListener("click", closeAlertModal);
  safeEl("editAlertDayBtn")?.addEventListener("click", editSelectedAlertDay);

  safeEl("closeConfirmSaveModalBtn")?.addEventListener("click", closeConfirmSaveModal);
  safeEl("reviewDayBtn")?.addEventListener("click", closeConfirmSaveModal);
  safeEl("forceSaveDayBtn")?.addEventListener("click", forceSavePendingDay);

  safeEl("cardFornitori")?.addEventListener("click", () => navigate("fornitori"));
  safeEl("cardCoperti")?.addEventListener("click", () => navigate("giornaliera"));
  safeEl("cardIncasso")?.addEventListener("click", () => navigate("giornaliera"));
  safeEl("cardAlert")?.addEventListener("click", () => {
    navigate("dashboard");
    const first = document.querySelector(".alert-row");
    if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

async function main() {
  try {
    bindEvents();
    seedFields();

    const ok = await initSupabase();
    if (!ok) return;

    supabase.auth.onAuthStateChange(async (_event, session) => {
      state.session = session;
    });

    if (state.session) {
      await bootstrapAfterAuth();
    } else {
      hideAllViews();
      safeEl("authView")?.classList.remove("hidden");
    }
  } catch (err) {
    console.error("Errore main:", err);
    hideAllViews();
    safeEl("authView")?.classList.remove("hidden");
    showAuthMessage("Errore avvio app: " + (err?.message || err), true);
  }
}

main();
