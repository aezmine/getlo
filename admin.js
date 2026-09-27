import { collection, onSnapshot, query, orderBy, deleteDoc, doc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, isFirebaseConfigured } from './firebase-config.js';

const PASSCODE = 'kacak123';

// DOM elements
const lockScreen   = document.getElementById('lockScreen');
const dashboard    = document.getElementById('dashboard');
const passInput    = document.getElementById('passInput');
const passError    = document.getElementById('passError');
const passForm     = document.getElementById('passForm');
const logoutBtn    = document.getElementById('logoutBtn');
const refreshBtn   = document.getElementById('refreshBtn');
const searchInput  = document.getElementById('searchInput');
const filterBtns   = document.querySelectorAll('.filter-btn');
const tableBody    = document.getElementById('tableBody');
const recordCount  = document.getElementById('recordCount');

// State
let allRecords = [];
let currentFilter = 'ALL';
let currentSearch = '';
let unsubscribeSnapshot = null;

/* =============================================================
   1. AUTHENTICATION & PASSCODE GATE
   ============================================================= */
function unlock() {
  lockScreen.style.display = 'none';
  dashboard.style.display = 'block';
  sessionStorage.setItem('admin_auth', 'granted');
  startRealtimeListener();
}

function lock() {
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
    unsubscribeSnapshot = null;
  }
  sessionStorage.removeItem('admin_auth');
  dashboard.style.display = 'none';
  lockScreen.style.display = 'flex';
  passInput.value = '';
  passError.style.display = 'none';
  passInput.focus();
}

window.checkPasscode = function() {
  const entered = (passInput.value || '').trim();
  if (entered === PASSCODE) {
    passError.style.display = 'none';
    unlock();
  } else {
    passError.style.display = 'block';
    passInput.select();
  }
};

if (logoutBtn) logoutBtn.addEventListener('click', lock);

// Check if already authenticated in this session
if (sessionStorage.getItem('admin_auth') === 'granted') {
  unlock();
} else {
  lock();
}

/* =============================================================
   2. FIRESTORE REAL-TIME LISTENER
   ============================================================= */
function startRealtimeListener() {
  if (!isFirebaseConfigured || !db) {
    tableBody.innerHTML = `<tr><td colspan="9" class="empty-state">Firebase is not configured. Check firebase-config.js.</td></tr>`;
    return;
  }

  tableBody.innerHTML = `<tr><td colspan="9" class="empty-state">Loading real-time records…</td></tr>`;

  try {
    const q = collection(db, 'locations');
    
    unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
      const records = [];
      snapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        records.push({
          id: docSnapshot.id,
          ...data
        });
      });

      // Sort by timestamp (newest first)
      records.sort((a, b) => {
        const timeA = a.createdAt?.toMillis?.() || a.clientTimestamp || 0;
        const timeB = b.createdAt?.toMillis?.() || b.clientTimestamp || 0;
        return timeB - timeA;
      });

      allRecords = records;
      renderTable();
    }, (err) => {
      console.error('Firestore listener error:', err);
      tableBody.innerHTML = `<tr><td colspan="9" class="empty-state" style="color:#f87171;">Firestore error: ${err.message}</td></tr>`;
    });
  } catch (err) {
    console.error('Failed to listen to Firestore:', err);
    tableBody.innerHTML = `<tr><td colspan="9" class="empty-state" style="color:#f87171;">Listener initialization error: ${err.message}</td></tr>`;
  }
}

/* =============================================================
   3. TABLE RENDERING & FILTERING
   ============================================================= */
function renderTable() {
  const queryText = currentSearch.toLowerCase().trim();

  const filtered = allRecords.filter((rec) => {
    // Filter by type
    if (currentFilter !== 'ALL' && rec.method !== currentFilter) {
      return false;
    }

    // Search query
    if (queryText) {
      const haystack = [
        rec.deviceName || '',
        rec.hostDomain || '',
        rec.city || '',
        rec.region || '',
        rec.country || '',
        rec.ip || '',
        rec.latitude || '',
        rec.longitude || ''
      ].join(' ').toLowerCase();

      if (!haystack.includes(queryText)) return false;
    }

    return true;
  });

  recordCount.textContent = `${filtered.length} of ${allRecords.length} records`;

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="9" class="empty-state">No matching records found.</td></tr>`;
    return;
  }

  tableBody.innerHTML = filtered.map((rec) => {
    // Format timestamp
    let timeStr = '—';
    if (rec.createdAt?.toDate) {
      timeStr = rec.createdAt.toDate().toLocaleString();
    } else if (rec.clientTimestamp) {
      timeStr = new Date(rec.clientTimestamp).toLocaleString();
    }

    // Method badge
    const isGps = rec.method === 'BROWSER_GPS';
    const methodBadge = isGps
      ? `<span class="badge-method badge-gps">GPS</span>`
      : `<span class="badge-method badge-ip">IP</span>`;

    // Location & Coordinates
    const city = [rec.city, rec.region, rec.country].filter(Boolean).join(', ') || 'Unknown Location';
    const lat = rec.latitude ? Number(rec.latitude).toFixed(6) : '—';
    const lng = rec.longitude ? Number(rec.longitude).toFixed(6) : '—';
    
    // Maps URL
    const mapsLink = (rec.latitude && rec.longitude)
      ? `<a href="https://www.google.com/maps?q=${rec.latitude},${rec.longitude}" target="_blank" rel="noopener noreferrer" class="maps-link" style="display: inline-flex; align-items: center; gap: 0.35rem;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          ${lat}, ${lng}
         </a>`
      : '—';

    // Accuracy
    const accuracy = rec.accuracy 
      ? (isGps ? `${Number(rec.accuracy).toFixed(1)} m` : 'City-level')
      : '—';

    return `
      <tr id="row-${rec.id}">
        <td><strong>${timeStr}</strong></td>
        <td>${methodBadge}</td>
        <td>${escapeHtml(rec.deviceName || 'Unknown')}</td>
        <td>${escapeHtml(rec.hostDomain || '—')}</td>
        <td>${escapeHtml(city)}</td>
        <td>${mapsLink}</td>
        <td>${accuracy}</td>
        <td><code>${escapeHtml(rec.ip || '—')}</code></td>
        <td>
          <button class="btn-delete" data-id="${rec.id}">Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  // Attach delete handlers
  document.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.id));
  });
}

/**
 * Handle document deletion.
 */
async function handleDelete(docId) {
  if (!confirm(`Delete record ID ${docId.slice(0, 8)}…?`)) return;

  try {
    await deleteDoc(doc(db, 'locations', docId));
  } catch (err) {
    alert('Delete failed: ' + err.message);
  }
}

/**
 * Sanitize text to prevent HTML injection.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* =============================================================
   4. EVENT LISTENERS
   ============================================================= */
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    currentSearch = e.target.value;
    renderTable();
  });
}

filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    filterBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderTable();
  });
});

if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    if (unsubscribeSnapshot) unsubscribeSnapshot();
    startRealtimeListener();
  });
}
