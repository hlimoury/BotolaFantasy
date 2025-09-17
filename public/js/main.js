// public/js/main.js (FULL)
document.addEventListener('DOMContentLoaded', () => {
  renderNavbar();
  if (window.location.pathname === '/') {
    // Optional homepage call if you use it
    try { loadTopManagers(); } catch (_) {}
  }
});

function active(path) {
  return window.location.pathname.startsWith(path) ? 'active' : '';
}

function renderNavbar() {
  const nav = document.querySelector('#navbarNav .navbar-nav');
  if (!nav) return;

  const token = localStorage.getItem('token');

  if (!token) {
    // Logged out navbar
    nav.innerHTML = `
    <li class="nav-item">
            <a class="nav-link" href="https://instagram.com/fantasybotola" target="_blank" title="Follow us on Instagram">
              <i class="bi bi-instagram"></i>
            </a>
          </li>
          
      <li class="nav-item">
        <a class="nav-link ${active('/leaderboard')}" href="/leaderboard">Leaderboard</a>
      </li>
      <li class="nav-item">
        <a class="nav-link btn btn-outline-light ms-2" href="/login">Login</a>
      </li>
      <li class="nav-item">
        <a class="nav-link btn btn-success ms-2" href="/signup">Sign Up</a>
      </li>
    `;
    return;
  }

  const user = JSON.parse(localStorage.getItem('user') || '{}');
  nav.innerHTML = `
  <li class="nav-item">
            <a class="nav-link" href="https://instagram.com/fantasybotola" target="_blank" title="Follow us on Instagram">
              <i class="bi bi-instagram"></i>
            </a>
          </li>
          
    <li class="nav-item">
      <a class="nav-link ${active('/dashboard')}" href="/dashboard">My Team</a>
    </li>
    <li class="nav-item">
      <a class="nav-link ${active('/leaderboard')}" href="/leaderboard">Leaderboard</a>
    </li>
    <li class="nav-item">
      <a class="nav-link ${active('/friends')}" href="/friends">Friends</a>
    </li>
    <li class="nav-item">
      <a class="nav-link ${active('/leagues')}" href="/leagues">Leagues</a>
    </li>
    ${user.isAdmin ? `
      <li class="nav-item">
        <a class="nav-link ${active('/admin')}" href="/admin">Admin</a>
      </li>` : ''
    }
    <li class="nav-item">
      <span class="navbar-text text-white me-3">Welcome, ${user.username || 'Manager'}!</span>
    </li>
    <li class="nav-item">
      <button class="btn btn-outline-light" onclick="logout()">Logout</button>
    </li>
  `;
}

async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/';
}

// Optional: homepage "Top Managers" table filler
async function loadTopManagers() {
  const el = document.getElementById('topManagersTable');
  if (!el) return;
  try {
    const res = await fetch('/api/leaderboard/top');
    const managers = await res.json();
    el.innerHTML = (managers || []).map((m, i) => `
      <tr>
        <td><span class="rank-badge rank-${i + 1}">${i + 1}</span></td>
        <td>${m.username}</td>
        <td><strong>${m.totalPoints}</strong> pts</td>
      </tr>
    `).join('');
  } catch (e) {
    el.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Unable to load</td></tr>`;
  }
}
// public/js/main.js (append at the very end)
(function playtestNoticeOnce() {
  const KEY = 'playtest_ack_v1';
  const token = localStorage.getItem('token');
  const path = window.location.pathname;

  // Show only to logged-in users, skip on login/signup pages, and only once
  if (!token || localStorage.getItem(KEY) || path === '/login' || path === '/signup') return;

  // Overlay
  const overlay = document.createElement('div');
  overlay.id = 'playtestOverlay';
  overlay.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,.6);
    z-index:20000; display:flex; align-items:center; justify-content:center; padding:16px;
  `;

  // Box
  const box = document.createElement('div');
  box.style.cssText = `
    background:#fff; border-radius:16px; max-width:560px; width:100%;
    box-shadow:0 20px 60px rgba(0,0,0,.25); overflow:hidden; font-family:inherit;
    animation: pt_floatIn .25s ease-out;
  `;

  const html = `
    <style>
      @keyframes pt_floatIn { from { transform: translateY(16px); opacity:0 } to { transform: translateY(0); opacity:1 } }
      .pt-btn { border:none; border-radius:10px; padding:8px 14px; font-weight:700; cursor:pointer; }
      .pt-btn-plain { border:1px solid #ced4da; background:#fff; font-weight:600; }
      .pt-btn-ok { background:#28a745; color:#fff; }
      .pt-badge { display:inline-block; border-radius:999px; padding:4px 10px; font-weight:600; margin:2px 4px 2px 0; }
    </style>
    <div style="background:linear-gradient(135deg,#ff4d4f,#bf3032); color:#fff; padding:16px 18px; display:flex; align-items:center; justify-content:space-between;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="bi bi-exclamation-triangle-fill" style="font-size:20px;"></span>
        <strong>Play Test Notice</strong>
      </div>
      <span class="badge bg-dark">v1</span>
    </div>

    <div style="padding:18px;">
      <p style="margin:0 0 10px 0; color:#333;">
        This is a play test limited to the following clubs:
      </p>
      <div class="pt-teams" style="margin-bottom:10px;">
        <span class="pt-badge" style="background:#28a745; color:#fff;">Raja</span>
        <span class="pt-badge" style="background:#dc3545; color:#fff;">Wydad</span>
        <span class="pt-badge" style="background:#000; color:#fff;">AS FAR</span>
        <span class="pt-badge" style="background:#ffc107; color:#000;">RS Berkane</span>
      </div>
      <p style="margin:0 0 6px 0; color:#333;">
        If you encounter any issue, please contact the developer:
      </p>
      <a href="https://www.instagram.com/mozart1st/" target="_blank" rel="noopener"
         style="text-decoration:none; display:inline-flex; gap:8px; align-items:center; color:#0d6efd;">
        <span class="bi bi-instagram"></span> @mozart1st
      </a>
    </div>

    <div style="display:flex; gap:10px; padding:12px 18px; background:#f8f9fa; border-top:1px solid #eee; justify-content:flex-end;">
      <button id="ptLater" class="pt-btn pt-btn-plain">Later</button>
      <button id="ptOk" class="pt-btn pt-btn-ok">I Understand</button>
    </div>
  `;

  box.innerHTML = html;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Button handlers
  const close = () => {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.removeEventListener('keydown', onKey);
  };
  document.getElementById('ptLater').addEventListener('click', close);
  document.getElementById('ptOk').addEventListener('click', () => {
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
    close();
  });

  // Optional: ESC closes without acknowledging
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
})();
