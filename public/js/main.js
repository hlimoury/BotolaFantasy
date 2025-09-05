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
