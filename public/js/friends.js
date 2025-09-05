let FRIENDS = [];
let INCOMING = [];
let OUTGOING = [];
let FRIEND_IDS = new Set();
let INCOMING_FROM_IDS = new Set();
let OUTGOING_TO_IDS = new Set();

document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('token');
  if (!token) return window.location.href = '/login';
  await loadFriends();
});

function alertBox(message, type = 'success') {
  const box = document.getElementById('friendsAlert');
  box.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show" role="alert">
    ${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`;
}

async function loadFriends() {
  const res = await fetch('/api/friends', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  const data = await res.json();
  FRIENDS = data.friends || [];
  INCOMING = data.incoming || [];
  OUTGOING = data.outgoing || [];

  FRIEND_IDS = new Set(FRIENDS.map(u => String(u._id)));
  INCOMING_FROM_IDS = new Set(INCOMING.map(r => String(r.from._id)));
  OUTGOING_TO_IDS = new Set(OUTGOING.map(r => String(r.to._id)));

  renderFriends();
  renderIncoming();
  renderOutgoing();
}

function userCard(u) {
  return `
    <div class="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
      <div class="d-flex align-items-center gap-3">
        <img src="${u.avatar || ''}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(u.username||'U')}&background=006233&color=fff'" class="rounded-circle" width="40" height="40">
        <div>
          <div class="fw-semibold">${u.username}</div>
          <div class="text-muted small">${u.email || ''}</div>
        </div>
      </div>
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-outline-danger" onclick="removeFriend('${u._id}')"><i class="bi bi-person-dash"></i> Remove</button>
      </div>
    </div>
  `;
}

function renderFriends() {
  const el = document.getElementById('friendsList');
  document.getElementById('friendsCount').textContent = FRIENDS.length;
  if (!FRIENDS.length) return el.innerHTML = `<div class="text-muted">No friends yet</div>`;
  el.innerHTML = FRIENDS.map(userCard).join('');
}

function renderIncoming() {
  const el = document.getElementById('incomingList');
  document.getElementById('incomingCount').textContent = INCOMING.length;
  if (!INCOMING.length) return el.innerHTML = `<div class="text-muted">No incoming requests</div>`;
  el.innerHTML = INCOMING.map(r => `
    <div class="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
      <div class="d-flex align-items-center gap-3">
        <img src="${r.from.avatar || ''}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(r.from.username||'U')}&background=C1272D&color=fff'" class="rounded-circle" width="40" height="40">
        <div>
          <div class="fw-semibold">${r.from.username}</div>
          <div class="text-muted small">${r.from.email || ''}</div>
        </div>
      </div>
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-success" onclick="acceptRequest('${r._id}')"><i class="bi bi-check2"></i> Accept</button>
        <button class="btn btn-sm btn-outline-secondary" onclick="declineRequest('${r._id}')"><i class="bi bi-x"></i> Decline</button>
      </div>
    </div>
  `).join('');
}

function renderOutgoing() {
  const el = document.getElementById('outgoingList');
  document.getElementById('outgoingCount').textContent = OUTGOING.length;
  if (!OUTGOING.length) return el.innerHTML = `<div class="text-muted">No outgoing requests</div>`;
  el.innerHTML = OUTGOING.map(r => `
    <div class="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
      <div class="d-flex align-items-center gap-3">
        <img src="${r.to.avatar || ''}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(r.to.username||'U')}&background=FFD700&color=000'" class="rounded-circle" width="40" height="40">
        <div>
          <div class="fw-semibold">${r.to.username}</div>
          <div class="text-muted small">${r.to.email || ''}</div>
        </div>
      </div>
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-outline-danger" onclick="cancelRequest('${r._id}')"><i class="bi bi-x-circle"></i> Cancel</button>
      </div>
    </div>
  `).join('');
}

async function searchUsers() {
  const q = document.getElementById('searchInput').value.trim();
  const box = document.getElementById('searchResults');
  if (!q) {
    box.innerHTML = `<div class="text-muted">Type to find users...</div>`;
    return;
  }
  const res = await fetch(`/api/friends/search?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  const data = await res.json();
  const users = data.users || [];
  if (!users.length) return box.innerHTML = `<div class="text-muted">No users found</div>`;

  box.innerHTML = users.map(u => {
    const isFriend = FRIEND_IDS.has(String(u._id));
    const isIncoming = INCOMING_FROM_IDS.has(String(u._id));
    const isOutgoing = OUTGOING_TO_IDS.has(String(u._id));
    let action = `<button class="btn btn-sm btn-primary" onclick="sendRequest('${u._id}')"><i class="bi bi-person-plus"></i> Add Friend</button>`;
    if (isFriend) action = `<span class="badge bg-success">Friends</span>`;
    else if (isIncoming) action = `<span class="badge bg-warning text-dark">Incoming request</span>`;
    else if (isOutgoing) action = `<span class="badge bg-secondary">Request sent</span>`;

    return `
      <div class="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
        <div class="d-flex align-items-center gap-3">
          <img src="${u.avatar || ''}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(u.username||'U')}&background=006233&color=fff'" class="rounded-circle" width="40" height="40">
          <div>
            <div class="fw-semibold">${u.username}</div>
            <div class="text-muted small">${u.email || ''}</div>
          </div>
        </div>
        <div class="d-flex gap-2">
          ${action}
        </div>
      </div>`;
  }).join('');
}

async function sendRequest(toUserId) {
  const res = await fetch('/api/friends/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify({ toUserId })
  });
  const data = await res.json();
  if (!res.ok) return alertBox(data.error || 'Failed to send request', 'danger');
  alertBox(data.message || 'Request sent');
  await loadFriends();
  searchUsers();
}

async function acceptRequest(requestId) {
  const res = await fetch(`/api/friends/accept/${requestId}`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  const data = await res.json();
  if (!res.ok) return alertBox(data.error || 'Failed to accept', 'danger');
  alertBox('Friend added');
  await loadFriends();
}

async function declineRequest(requestId) {
  const res = await fetch(`/api/friends/decline/${requestId}`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  const data = await res.json();
  if (!res.ok) return alertBox(data.error || 'Failed to decline', 'danger');
  alertBox('Request declined', 'secondary');
  await loadFriends();
}

async function cancelRequest(requestId) {
  const res = await fetch(`/api/friends/cancel/${requestId}`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  const data = await res.json();
  if (!res.ok) return alertBox(data.error || 'Failed to cancel', 'danger');
  alertBox('Request canceled', 'secondary');
  await loadFriends();
}

async function removeFriend(friendId) {
  if (!confirm('Remove this friend?')) return;
  const res = await fetch('/api/friends/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: JSON.stringify({ friendId })
  });
  const data = await res.json();
  if (!res.ok) return alertBox(data.error || 'Failed to remove', 'danger');
  alertBox('Friend removed', 'secondary');
  await loadFriends();
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login';
}
