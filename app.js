const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const toast = (message) => {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
};

$('#loginForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const email = $('#email').value.trim();
  const password = $('#password').value;
  if (!email || !password) return;
  $('#loginScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  toast('Welcome to your RailFlow workspace.');
});

$('#togglePassword').addEventListener('click', () => {
  const input = $('#password');
  input.type = input.type === 'password' ? 'text' : 'password';
});
$('#forgotLink').addEventListener('click', (e) => {
  e.preventDefault();
  $('#loginMessage').textContent = 'Password reset is a demo feature. Contact your workspace administrator.';
});
$('#ssoBtn').addEventListener('click', () => toast('Google SSO is a demo feature and is not connected.'));
$('#profileBtn').addEventListener('click', () => toast('Signed in as Alex Morgan · System Administrator.'));
$('#helpBtn').addEventListener('click', () => toast('Help center: support@railflow.io'));
$('#notificationBtn').addEventListener('click', () => toast('You’re all caught up — no new notifications.'));
$('#searchOpen').addEventListener('click', () => {
  $('#tableSearch').focus();
  $('#tableSearch').scrollIntoView({behavior:'smooth', block:'center'});
  toast('Search trains by name, number, source or destination.');
});
$('#exportBtn').addEventListener('click', () => {
  const rows = [['Train','Number','Route','Departure','Arrival','Status','Occupancy']];
  $$('#trainTable tr:not(.hidden)').forEach(row => {
    const cells = row.querySelectorAll('td');
    if (cells.length) rows.push([
      cells[0].innerText.replace(/\n/g,' '),
      cells[1].innerText.replace(/\n/g,' '),
      cells[2].innerText.replace(/\n/g,' '),
      cells[3].innerText.replace(/\n/g,' '),
      cells[4].innerText,
      cells[5].innerText
    ]);
  });
  const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'railflow-train-activity.csv';
  link.click();
  URL.revokeObjectURL(link.href);
  toast('Train activity report exported.');
});
$('#bannerClose').addEventListener('click', () => $('.banner').remove());
$('#viewReportBtn').addEventListener('click', () => toast('Performance report opened in demo mode.'));
$('#periodBtn').addEventListener('click', () => toast('Showing the last 7 days of sample data.'));
$('#chartMenu').addEventListener('click', () => toast('Chart options: weekly view · sample data.'));
$('#filterBtn').addEventListener('click', () => toast('Filters are ready to connect to your train data.'));
$$('.row-menu').forEach(button => button.addEventListener('click', () => toast('Train details menu — connect this action to your backend.')));

const pageCopy = {
  'Overview': ['Good morning, Alex', "Here's what's happening across your network today."],
  'Train Management': ['Train management', 'Monitor train availability, running status and occupancy.'],
  'Schedules': ['Train schedules', 'Review arrival, departure and platform information.'],
  'Bookings': ['Bookings', 'Manage passenger reservations and booking status.'],
  'Passengers': ['Passengers', 'View and manage passenger records.'],
  'Stations': ['Stations', 'Keep station details and stop information organized.'],
  'Payments': ['Payments', 'Track payment status, amounts and transaction records.'],
  'Reports': ['Reports & analytics', 'Review operational performance across your network.']
};
function setPage(page) {
  const copy = pageCopy[page] || [page, 'Manage your railway operations from one workspace.'];
  $('#breadcrumbPage').textContent = page;
  $('#pageTitle').textContent = copy[0];
  $('#pageSubtitle').textContent = copy[1];
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.page === page));
  if (page !== 'Overview') toast(`${page} view selected — UI demo with sample data.`);
  $('#sidebar').classList.remove('open');
}
$$('.nav-item').forEach(item => item.addEventListener('click', () => setPage(item.dataset.page)));
$$('[data-goto]').forEach(item => item.addEventListener('click', () => setPage(item.dataset.goto)));
$('#mobileMenu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

$('#tableSearch').addEventListener('input', (event) => {
  const term = event.target.value.trim().toLowerCase();
  let visible = 0;
  $$('#trainTable tr').forEach(row => {
    const match = (row.dataset.search || row.innerText.toLowerCase()).includes(term);
    row.classList.toggle('hidden', !match);
    if (match) visible++;
  });
  $('#showingCount').textContent = visible;
  $('#emptyState').classList.toggle('hidden', visible !== 0);
});

const modalBackdrop = $('#modalBackdrop');
function openModal() {
  modalBackdrop.classList.remove('hidden');
  $('#passengerName').focus();
}
function closeModal() { modalBackdrop.classList.add('hidden'); }
$('#addBookingBtn').addEventListener('click', openModal);
$('#closeModal').addEventListener('click', closeModal);
$('#cancelModal').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (event) => { if (event.target === modalBackdrop) closeModal(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });
const dateInput = $('#journeyDate');
const today = new Date();
dateInput.value = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0,10);
dateInput.min = dateInput.value;
$('#bookingForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('#passengerName').value.trim();
  if (!name) return;
  closeModal();
  event.target.reset();
  dateInput.value = new Date().toISOString().slice(0,10);
  toast(`Demo booking created for ${name}. Connect a backend to save records permanently.`);
});
$('#dateLabel').textContent = new Intl.DateTimeFormat('en-IN', {weekday:'long', month:'long', day:'numeric', year:'numeric'}).format(new Date()).toUpperCase();
