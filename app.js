// RailFlow frontend. The initial train-search page HTML/CSS layout is preserved.
// For local use keep localhost:3000. Replace with the deployed backend URL when hosting.
const API_BASE = "https://railway-mangemnet.onrender.com/api";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const TOKEN_KEY = "railflow_token";
const USER_KEY = "railflow_user";
let pendingSearch = null;
let searchResults = [];
let currentUser = null;
let authRole = "passenger";
let authMode = "login";
let currentAdminRows = [];
let currentAdminColumns = [];
let currentAdminPage = "Overview";

const toast = (message) => {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

async function api(path, options = {}, authenticated = true) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (authenticated) {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error("Cannot reach the RailFlow API. Keep `node app.js` running in the backend terminal and check API_BASE.");
  }
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    if (response.status === 401 && authenticated && sessionStorage.getItem(TOKEN_KEY)) {
      clearSession();
    }
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
}

function showScreen(screenId) {
  ["#loginScreen", "#authScreen", "#passengerPortal", "#app"].forEach((id) => {
    const element = $(id);
    if (element) element.classList.toggle("hidden", id !== screenId);
  });
  window.scrollTo({ top: 0, behavior: "auto" });
}

function stationCode(value) {
  const match = String(value || "").match(/\(([A-Z0-9]{2,10})\)\s*$/i);
  if (match) return match[1].toUpperCase();
  return String(value || "").trim().toUpperCase();
}

function formatDate(value) {
  if (!value) return "—";
  const dateText = String(value).slice(0, 10);
  const parsed = new Date(`${dateText}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? dateText : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
}
function formatTime(value) { return String(value || "—").slice(0, 5); }
function formatCurrency(value) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value || 0)); }
function shortDateLabel(value) { return value ? formatDate(value) : "your selected date"; }

function setSearchMessage(message, isError = false) {
  const target = $("#searchMessage");
  target.textContent = message;
  target.classList.add("visible");
  target.classList.toggle("error", isError);
}

// Keep the original landing page and design, but make its search database-backed.
const ticketDateInput = $("#ticketDate");
const todayLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
ticketDateInput.min = todayLocal;
if (!ticketDateInput.value) ticketDateInput.value = todayLocal;

$("#swapStations").addEventListener("click", () => {
  const from = $("#fromStation");
  const to = $("#toStation");
  const previousFrom = from.value;
  from.value = to.value;
  to.value = previousFrom;
  from.focus();
});

$("#ticketSearchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const fromLabel = $("#fromStation").value.trim();
  const toLabel = $("#toStation").value.trim();
  const date = ticketDateInput.value;
  if (!fromLabel || !toLabel || !date) return setSearchMessage("Choose source, destination and journey date.", true);
  const from = stationCode(fromLabel);
  const to = stationCode(toLabel);
  if (from === to) return setSearchMessage("Choose two different stations to plan your journey.", true);
  if (date < ticketDateInput.min) return setSearchMessage("Please choose today or a future journey date.", true);

  const button = event.submitter;
  if (button) { button.disabled = true; button.dataset.originalText = button.innerHTML; button.textContent = "SEARCHING..."; }
  setSearchMessage("Searching RailFlow schedules in the database...");
  try {
    searchResults = await api(`/trains/search?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${encodeURIComponent(date)}`, {}, false);
    pendingSearch = { from, to, fromLabel, toLabel, date };
    $("#authRouteSummary").textContent = `${fromLabel} → ${toLabel} · ${shortDateLabel(date)} · ${searchResults.length} demo schedule${searchResults.length === 1 ? "" : "s"} found`;
    $("#authSubtitle").textContent = searchResults.length
      ? `We found ${searchResults.length} demo schedule${searchResults.length === 1 ? "" : "s"}. Sign in to continue and reserve a seat.`
      : "No demo trains match this route/date. Passengers can sign in, or choose administrator access to review all schedules.";
    $("#authError").classList.add("hidden");
    setAuthRole("passenger");
    authMode = "login";
    updateAuthFormMode();
    showScreen("#authScreen");
  } catch (error) {
    setSearchMessage(error.message, true);
  } finally {
    if (button) { button.disabled = false; button.innerHTML = button.dataset.originalText || 'SEARCH TRAINS <span aria-hidden="true">→</span>'; }
  }
});

function setAuthRole(role) {
  authRole = role === "admin" ? "admin" : "passenger";
  $$('[data-auth-role]').forEach((button) => button.classList.toggle("active", button.dataset.authRole === authRole));
  if (authRole === "admin") authMode = "login";
  updateAuthFormMode();
}
function updateAuthFormMode() {
  const isRegister = authRole === "passenger" && authMode === "register";
  $("#authTitle").innerHTML = authRole === "admin" ? 'Administrator access<span>.</span>' : (isRegister ? 'Create passenger account<span>.</span>' : 'Sign in to continue<span>.</span>');
  $("#authSubtitle").textContent = authRole === "admin"
    ? "Sign in with the administrator account configured for this project."
    : (isRegister ? "Create an account to book tickets and view your reservations." : "Sign in to reserve a seat and see your saved bookings.");
  $("#authNameGroup").classList.toggle("hidden", !isRegister);
  $("#authName").required = isRegister;
  $("#authPassword").autocomplete = isRegister ? "new-password" : "current-password";
  $("#authSubmit").innerHTML = authRole === "admin" ? 'Sign in as administrator <span>→</span>' : (isRegister ? 'Create account and continue <span>→</span>' : 'Sign in and continue <span>→</span>');
  $("#authModeLine").classList.toggle("hidden", authRole === "admin");
  $("#authModeLine").innerHTML = isRegister
    ? 'Already registered? <button type="button" id="authModeToggle">Sign in instead</button>'
    : 'New to RailFlow? <button type="button" id="authModeToggle">Create a passenger account</button>';
  const toggle = $("#authModeToggle");
  if (toggle) toggle.addEventListener("click", () => { authMode = authMode === "login" ? "register" : "login"; updateAuthFormMode(); });
}
$$('[data-auth-role]').forEach((button) => button.addEventListener("click", () => setAuthRole(button.dataset.authRole)));
$("#backToSearch").addEventListener("click", () => showScreen("#loginScreen"));
$("#authBrandHome").addEventListener("click", (event) => { event.preventDefault(); showScreen("#loginScreen"); });

function saveSession(data) {
  sessionStorage.setItem(TOKEN_KEY, data.token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
  currentUser = data.user;
}
function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  currentUser = null;
}

$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorBox = $("#authError");
  errorBox.classList.add("hidden");
  const submit = $("#authSubmit");
  submit.disabled = true;
  const oldText = submit.textContent;
  submit.textContent = "PLEASE WAIT...";
  const body = {
    email: $("#authEmail").value.trim(),
    password: $("#authPassword").value,
    role: authRole
  };
  if (authRole === "passenger" && authMode === "register") body.full_name = $("#authName").value.trim();
  try {
    const path = authRole === "passenger" && authMode === "register" ? "/auth/register" : "/auth/login";
    const data = await api(path, { method: "POST", body: JSON.stringify(body) }, false);
    saveSession(data);
    $("#authPassword").value = "";
    if (currentUser.role === "admin") await showAdminWorkspace();
    else await showPassengerWorkspace();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.classList.remove("hidden");
  } finally {
    submit.disabled = false;
    submit.innerHTML = authRole === "admin" ? 'Sign in as administrator <span>→</span>' : ((authMode === "register") ? 'Create account and continue <span>→</span>' : 'Sign in and continue <span>→</span>');
  }
});

function renderSearchResults() {
  const wrapper = $("#searchResults");
  $("#passengerRouteSummary").textContent = pendingSearch
    ? `${pendingSearch.fromLabel} → ${pendingSearch.toLabel} · ${formatDate(pendingSearch.date)}`
    : "You can search for a journey from the landing page.";
  $("#searchResultCount").textContent = `${searchResults.length} schedule${searchResults.length === 1 ? "" : "s"}`;
  if (!searchResults.length) {
    wrapper.innerHTML = '<div class="flow-no-results"><strong>No schedules found for this search.</strong><p>Try another station pair/date, or sign out and run the search again. The sample timetable contains demonstration data only.</p><button type="button" class="secondary-btn" id="searchAgainFromEmpty">Search again</button></div>';
    $("#searchAgainFromEmpty").addEventListener("click", () => showScreen("#loginScreen"));
    return;
  }
  wrapper.innerHTML = searchResults.map((train) => `
    <article class="search-result-card">
      <div class="search-result-main"><div class="search-result-train"><span class="result-train-icon">▰</span><div><strong>${escapeHtml(train.train_name)}</strong><small>${escapeHtml(train.train_number)} · ${escapeHtml(train.train_type || "Demo")}</small></div></div><span class="flow-small-pill">Demo schedule</span></div>
      <div class="search-result-route"><div><strong>${escapeHtml(formatTime(train.departure_time))}</strong><span>${escapeHtml(train.source_code)} · ${escapeHtml(train.source_station)}</span></div><div class="route-track"><i></i><span>Journey</span><i></i></div><div><strong>${escapeHtml(formatTime(train.arrival_time))}</strong><span>${escapeHtml(train.destination_code)} · ${escapeHtml(train.destination_station)}</span></div></div>
      <div class="search-result-bottom"><div><span>Journey date</span><strong>${escapeHtml(formatDate(train.journey_date))}</strong></div><div><span>Available seats</span><strong>${Number(train.available_seats)}</strong></div><div><span>Fare / seat</span><strong>${escapeHtml(formatCurrency(train.fare))}</strong></div><div class="result-book-controls"><label>Class<select class="result-class"><option>Sleeper</option><option>AC 3 Tier</option><option>AC 2 Tier</option><option>AC First Class</option><option>Chair Car</option></select></label><label>Seats<select class="result-seats"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option></select></label><button type="button" class="flow-book-btn" data-schedule-id="${Number(train.schedule_id)}">Book ticket →</button></div></div>
    </article>`).join("");
  $$(".flow-book-btn").forEach((button) => button.addEventListener("click", async () => {
    const card = button.closest(".search-result-card");
    const seats = Number(card.querySelector(".result-seats").value);
    const travelClass = card.querySelector(".result-class").value;
    button.disabled = true;
    const old = button.textContent;
    button.textContent = "SAVING...";
    try {
      const booking = await api("/bookings", {
        method: "POST",
        body: JSON.stringify({ schedule_id: Number(button.dataset.scheduleId), seats_booked: seats, travel_class: travelClass })
      });
      toast(`Booking saved: ${booking.booking_reference}`);
      await renderSearchResultsAfterBooking(Number(button.dataset.scheduleId), seats);
      await loadMyBookings();
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }));
}

async function renderSearchResultsAfterBooking(scheduleId, seatsBooked) {
  searchResults = searchResults.map((row) => row.schedule_id === scheduleId
    ? { ...row, available_seats: Math.max(0, Number(row.available_seats) - seatsBooked) }
    : row).filter((row) => Number(row.available_seats) > 0);
  renderSearchResults();
}

async function loadMyBookings() {
  const body = $("#myBookingsBody");
  const message = $("#myBookingsMessage");
  body.innerHTML = '<tr><td colspan="6">Loading bookings…</td></tr>';
  message.textContent = "";
  try {
    const bookings = await api("/bookings");
    if (!bookings.length) {
      body.innerHTML = '<tr><td colspan="6">No bookings yet. Book one of the schedules above to create your first database record.</td></tr>';
      return;
    }
    body.innerHTML = bookings.map((b) => `<tr><td><strong>${escapeHtml(b.booking_reference)}</strong></td><td>${escapeHtml(b.train_number)} · ${escapeHtml(b.train_name)}</td><td>${escapeHtml(formatDate(b.journey_date))}</td><td>${Number(b.seats_booked)}</td><td>${escapeHtml(formatCurrency(b.total_fare))}</td><td><span class="flow-status ${String(b.booking_status).toLowerCase()}">${escapeHtml(b.booking_status)}</span></td></tr>`).join("");
    message.textContent = "These rows are loaded from MySQL through the backend API.";
  } catch (error) {
    body.innerHTML = '<tr><td colspan="6">Could not load bookings.</td></tr>';
    message.textContent = error.message;
  }
}

async function showPassengerWorkspace() {
  if (!currentUser) return;
  $("#passengerWelcome").textContent = `${currentUser.full_name} · Passenger`;
  showScreen("#passengerPortal");
  renderSearchResults();
  await loadMyBookings();
}

const adminPageConfig = {
  "Overview": { title: "Live operations overview", subtitle: "Counts and recent bookings read directly from Aiven MySQL.", endpoint: "/admin/dashboard", type: "overview" },
  "Train Management": { title: "All trains", subtitle: "Train records stored in the database.", endpoint: "/admin/trains", columns: [["train_number","Train number"],["train_name","Train name"],["train_type","Type"],["schedule_count","Schedules"]] },
  "Schedules": { title: "All schedules", subtitle: "Routes, dates, times, availability and fares.", endpoint: "/admin/schedules", columns: [["train_number","Train"],["train_name","Train name"],["source_code","From code"],["source_station","From station"],["destination_code","To code"],["destination_station","To station"],["journey_date","Journey date"],["departure_time","Departure"],["arrival_time","Arrival"],["available_seats","Seats left"],["fare","Fare"]] },
  "Bookings": { title: "All bookings", subtitle: "Every booking currently saved in MySQL.", endpoint: "/admin/bookings", columns: [["booking_reference","Reference"],["full_name","Passenger"],["email","Email"],["train_number","Train"],["train_name","Train name"],["source_station","From"],["destination_station","To"],["journey_date","Journey date"],["seats_booked","Seats"],["travel_class","Class"],["total_fare","Total fare"],["booking_status","Status"],["created_at","Created"]] },
  "Passengers": { title: "Passenger accounts", subtitle: "Registered passenger accounts and booking counts.", endpoint: "/admin/passengers", columns: [["full_name","Name"],["email","Email"],["role","Role"],["booking_count","Bookings"],["created_at","Created"]] },
  "Stations": { title: "Stations", subtitle: "Station codes and cities configured in the database.", endpoint: "/admin/stations", columns: [["station_code","Code"],["station_name","Station name"],["city","City"],["schedule_count","Schedules"]] },
  "Payments": { title: "Fare records", subtitle: "Booking fares only; an online payment gateway is not integrated.", endpoint: "/admin/bookings", columns: [["booking_reference","Reference"],["full_name","Passenger"],["train_number","Train"],["total_fare","Fare amount"],["booking_status","Booking status"],["created_at","Created"]] },
  "Reports": { title: "Booking reports", subtitle: "Aggregated totals calculated from MySQL booking records.", endpoint: "/admin/reports", columns: [["booking_status","Status"],["booking_count","Bookings"],["seats_total","Seats booked"],["fare_total","Fare total"]] }
};

function updateAdminProfile() {
  if (!currentUser) return;
  const initials = currentUser.full_name.split(/\s+/).map((part) => part[0]).slice(0,2).join("").toUpperCase();
  const profileName = $(".profile-info strong");
  const profileRole = $(".profile-info small");
  const avatar = $(".avatar");
  const topAvatar = $(".top-avatar");
  if (profileName) profileName.textContent = currentUser.full_name;
  if (profileRole) profileRole.textContent = "System Administrator";
  if (avatar) avatar.textContent = initials;
  if (topAvatar) topAvatar.textContent = initials;
  const heading = $("#pageTitle");
  if (heading) heading.textContent = `Welcome, ${currentUser.full_name}`;
  const addButton = $("#addBookingBtn");
  if (addButton) addButton.classList.add("hidden");
}

function setAdminMetrics(metrics = {}) {
  $("#metricTrains").textContent = metrics.trains ?? "—";
  $("#metricSchedules").textContent = metrics.schedules ?? "—";
  $("#metricBookings").textContent = metrics.bookings ?? "—";
  $("#metricPassengers").textContent = metrics.passengers ?? "—";
}

function displayValue(key, value) {
  if (key === "fare" || key === "total_fare" || key === "fare_total" || key === "confirmed_fare_total") return formatCurrency(value);
  if (key === "journey_date") return formatDate(value);
  if (key === "departure_time" || key === "arrival_time") return formatTime(value);
  return value == null || value === "" ? "—" : value;
}

function renderAdminTable(columns, rows) {
  currentAdminColumns = columns || [];
  currentAdminRows = rows || [];
  $("#adminTableHead").innerHTML = `<tr>${currentAdminColumns.map(([, label]) => `<th>${escapeHtml(label.toUpperCase())}</th>`).join("")}</tr>`;
  applyAdminTableFilter();
}

function applyAdminTableFilter() {
  const term = String($("#adminTableSearch").value || "").trim().toLowerCase();
  const filtered = currentAdminRows.filter((row) => currentAdminColumns.some(([key]) => String(displayValue(key, row[key]) ?? "").toLowerCase().includes(term)));
  $("#adminTableBody").innerHTML = filtered.map((row) => `<tr>${currentAdminColumns.map(([key]) => `<td>${escapeHtml(displayValue(key, row[key]))}</td>`).join("")}</tr>`).join("");
  $("#adminEmpty").classList.toggle("hidden", filtered.length !== 0);
  $("#adminRowCount").textContent = `${filtered.length} row${filtered.length === 1 ? "" : "s"}${term ? ` matching “${term}”` : ""}`;
}

async function renderAdminPage(page = "Overview") {
  currentAdminPage = page;
  const config = adminPageConfig[page] || adminPageConfig.Overview;
  $("#adminTableTitle").textContent = config.title;
  $("#adminTableSubtitle").textContent = config.subtitle;
  $("#adminTableSearch").value = "";
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  $("#breadcrumbPage").textContent = page;
  $("#pageSubtitle").textContent = config.subtitle;
  $("#pageTitle").textContent = page === "Overview" ? `Welcome, ${currentUser.full_name}` : config.title;
  try {
    // Keep the metric cards and sidebar counters live on every admin page.
    const dashboard = await api("/admin/dashboard");
    setAdminMetrics(dashboard.metrics);
    const trainBadge = $('.nav-item[data-page="Train Management"] .nav-count');
    const bookingBadge = $('.nav-item[data-page="Bookings"] .nav-count');
    if (trainBadge) trainBadge.textContent = dashboard.metrics.trains;
    if (bookingBadge) bookingBadge.textContent = dashboard.metrics.bookings;

    if (config.type === "overview") {
      const columns = [["booking_reference","Reference"],["full_name","Passenger"],["train_number","Train"],["train_name","Train name"],["source_station","From"],["destination_station","To"],["journey_date","Journey date"],["seats_booked","Seats"],["total_fare","Fare"],["booking_status","Status"]];
      renderAdminTable(columns, dashboard.recentBookings || []);
      $("#adminTableTitle").textContent = "Recent database bookings";
      $("#adminTableSubtitle").textContent = `Confirmed fare total: ${formatCurrency(dashboard.metrics?.confirmed_fare_total)}. Newly created bookings appear here after refresh.`;
    } else {
      const data = await api(config.endpoint);
      const rows = Array.isArray(data) ? data : [];
      renderAdminTable(config.columns || [], rows);
    }
  } catch (error) {
    renderAdminTable([["message","Error"]], [{ message: error.message }]);
  }
}

async function showAdminWorkspace() {
  if (!currentUser || currentUser.role !== "admin") return;
  updateAdminProfile();
  // Hide original static mock dashboard widgets; replace them with live database rows.
  [".banner", ".section-head", ".stats-grid", ".dashboard-grid", "#sampleTrainPanel"].forEach((selector) => {
    const element = $(selector);
    if (element) element.classList.add("hidden");
  });
  $("#adminLivePanel").classList.remove("hidden");
  showScreen("#app");
  await renderAdminPage("Overview");
}

$$('.nav-item').forEach((item) => item.addEventListener("click", () => renderAdminPage(item.dataset.page)));
$$('[data-goto]').forEach((item) => item.addEventListener("click", () => renderAdminPage(item.dataset.goto)));
$("#adminTableSearch").addEventListener("input", applyAdminTableFilter);
$("#refreshAdminData").addEventListener("click", () => renderAdminPage(currentAdminPage));
$("#adminLogout").addEventListener("click", logout);
$("#passengerLogout").addEventListener("click", logout);
$("#refreshMyBookings").addEventListener("click", loadMyBookings);
$("#passengerBackToSearch").addEventListener("click", () => showScreen("#loginScreen"));
$("#passengerBrandHome").addEventListener("click", (event) => { event.preventDefault(); showScreen("#loginScreen"); });
$("#exportBtn").addEventListener("click", () => {
  const rows = [currentAdminColumns.map(([, label]) => label), ...currentAdminRows.map((row) => currentAdminColumns.map(([key]) => displayValue(key, row[key])))];
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `railflow-${currentAdminPage.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

function logout() {
  clearSession();
  searchResults = [];
  showScreen("#loginScreen");
  toast("You have signed out of RailFlow.");
}

// Keep cosmetic controls usable; all operational/admin data paths above are database-backed.
$("#helpBtn").addEventListener("click", () => toast("RailFlow help: review README.md for setup and presentation SQL."));
$("#notificationBtn").addEventListener("click", () => toast("You're all caught up."));
$("#profileBtn").addEventListener("click", () => toast(`Signed in as ${currentUser?.full_name || "administrator"}. Use Sign out to end the session.`));
$("#bannerClose").addEventListener("click", () => $(".banner").remove());
$("#viewReportBtn").addEventListener("click", () => renderAdminPage("Reports"));
$("#periodBtn").addEventListener("click", () => toast("Metrics are calculated from current database records."));
$("#chartMenu").addEventListener("click", () => toast("Live booking summaries are available in Reports & analytics."));
$("#filterBtn").addEventListener("click", () => toast("Use the table search field to filter rows."));
$("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#searchOpen").addEventListener("click", () => {
  const input = $("#adminTableSearch");
  if (input && !$("#adminLivePanel").classList.contains("hidden")) { input.focus(); input.scrollIntoView({ behavior: "smooth", block: "center" }); }
  else toast("Use the journey search page to search schedules.");
});

$("#dateLabel").textContent = new Intl.DateTimeFormat("en-IN", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()).toUpperCase();

// Restore the current session after a refresh, if the token is still valid.
(async function restoreSession() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) return;
  try {
    const data = await api("/me");
    currentUser = data.user;
    if (currentUser.role === "admin") await showAdminWorkspace();
    else await showPassengerWorkspace();
  } catch {
    clearSession();
    showScreen("#loginScreen");
  }
})();
