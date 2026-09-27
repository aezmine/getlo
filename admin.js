import { collection, onSnapshot, deleteDoc, doc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
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
let allMergedRecords = [];
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
   2. DISTANCE CALCULATOR (Haversine formula in km)
   ============================================================= */
function getDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

/* =============================================================
   3. PROCESS & MERGE FIRESTORE DOCUMENTS INTO SINGLE ROWS
   ============================================================= */
function processAndMergeRecords(rawDocs) {
  // Sort descending by client timestamp / createdAt
  const sorted = rawDocs.slice().sort((a, b) => {
    const timeA = a.createdAt?.toMillis?.() || a.clientTimestamp || a.gpsTimestamp || 0;
    const timeB = b.createdAt?.toMillis?.() || b.clientTimestamp || b.gpsTimestamp || 0;
    return timeB - timeA;
  });

  const mergedRows = [];
  const handledLegacyIds = new Set();

  for (let i = 0; i < sorted.length; i++) {
    const docA = sorted[i];
    if (handledLegacyIds.has(docA.id)) continue;

    // Check if unified session document (new format)
    if (docA.ipLatitude != null || docA.gpsLatitude != null || docA.hasGps !== undefined || docA.status === 'GPS_VERIFIED') {
      const ipLat = docA.ipLatitude != null ? Number(docA.ipLatitude) : (docA.method === 'IP_GEOLOCATION' ? Number(docA.latitude) : null);
      const ipLng = docA.ipLongitude != null ? Number(docA.ipLongitude) : (docA.method === 'IP_GEOLOCATION' ? Number(docA.longitude) : null);
      const gpsLat = docA.gpsLatitude != null ? Number(docA.gpsLatitude) : (docA.method === 'BROWSER_GPS' ? Number(docA.latitude) : null);
      const gpsLng = docA.gpsLongitude != null ? Number(docA.gpsLongitude) : (docA.method === 'BROWSER_GPS' ? Number(docA.longitude) : null);
      const hasGps = Boolean(docA.hasGps || gpsLat != null);

      let distanceDiffKm = docA.distanceDiffKm;
      if (distanceDiffKm == null && ipLat != null && gpsLat != null) {
        distanceDiffKm = getDistanceKm(ipLat, ipLng, gpsLat, gpsLng);
      }

      mergedRows.push({
        id: docA.id,
        docIds: [docA.id],
        userName: docA.userName || '—',
        time: docA.createdAt?.toDate?.() || new Date(docA.clientTimestamp || docA.gpsTimestamp || Date.now()),
        deviceName: docA.deviceName || 'Unknown Device',
        hostDomain: docA.hostDomain || '—',
        ip: docA.ip || '—',
        city: [docA.ipCity || docA.city, docA.ipRegion || docA.region, docA.ipCountry || docA.country].filter(Boolean).join(', ') || 'Unknown Location',
        ipLat,
        ipLng,
        hasGps,
        gpsLat,
        gpsLng,
        gpsAccuracy: docA.gpsAccuracy || docA.accuracy,
        distanceDiffKm,
        gpsStatus: docA.gpsStatus || null,
        gpsErrorReason: docA.gpsErrorReason || null,
        gpsErrorMessage: docA.gpsErrorMessage || null
      });

      handledLegacyIds.add(docA.id);
      continue;
    }

    // Legacy format pairing (IP_GEOLOCATION and BROWSER_GPS recorded in separate documents)
    if (docA.method === 'BROWSER_GPS') {
      let partnerDoc = null;
      const timeA = docA.clientTimestamp || docA.createdAt?.toMillis?.() || 0;

      for (let j = 0; j < sorted.length; j++) {
        if (i === j) continue;
        const candidate = sorted[j];
        if (handledLegacyIds.has(candidate.id)) continue;
        if (candidate.method === 'IP_GEOLOCATION') {
          const timeB = candidate.clientTimestamp || candidate.createdAt?.toMillis?.() || 0;
          const sameIp = docA.ip && candidate.ip && docA.ip === candidate.ip;
          const sameDevice = docA.deviceName && candidate.deviceName && docA.deviceName === candidate.deviceName;
          const closeTime = Math.abs(timeA - timeB) < 15 * 60 * 1000; // 15 mins window

          if ((sameIp || sameDevice) && closeTime) {
            partnerDoc = candidate;
            break;
          }
        }
      }

      if (partnerDoc) {
        handledLegacyIds.add(docA.id);
        handledLegacyIds.add(partnerDoc.id);

        const ipLat = partnerDoc.latitude != null ? Number(partnerDoc.latitude) : null;
        const ipLng = partnerDoc.longitude != null ? Number(partnerDoc.longitude) : null;
        const gpsLat = docA.latitude != null ? Number(docA.latitude) : null;
        const gpsLng = docA.longitude != null ? Number(docA.longitude) : null;
        const distanceDiffKm = getDistanceKm(ipLat, ipLng, gpsLat, gpsLng);

        mergedRows.push({
          id: docA.id,
          docIds: [docA.id, partnerDoc.id],
          userName: docA.userName || partnerDoc.userName || '—',
          time: docA.createdAt?.toDate?.() || new Date(timeA || partnerDoc.clientTimestamp || Date.now()),
          deviceName: docA.deviceName || partnerDoc.deviceName || 'Unknown Device',
          hostDomain: docA.hostDomain || partnerDoc.hostDomain || '—',
          ip: docA.ip || partnerDoc.ip || '—',
          city: [partnerDoc.city, partnerDoc.region, partnerDoc.country].filter(Boolean).join(', ') || 'Unknown Location',
          ipLat,
          ipLng,
          hasGps: true,
          gpsLat,
          gpsLng,
          gpsAccuracy: docA.accuracy,
          distanceDiffKm
        });
      } else {
        // Standalone GPS legacy
        handledLegacyIds.add(docA.id);
        mergedRows.push({
          id: docA.id,
          docIds: [docA.id],
          userName: docA.userName || '—',
          time: docA.createdAt?.toDate?.() || new Date(timeA || Date.now()),
          deviceName: docA.deviceName || 'Unknown Device',
          hostDomain: docA.hostDomain || '—',
          ip: docA.ip || '—',
          city: [docA.city, docA.region, docA.country].filter(Boolean).join(', ') || 'Unknown Location',
          ipLat: null,
          ipLng: null,
          hasGps: true,
          gpsLat: Number(docA.latitude),
          gpsLng: Number(docA.longitude),
          gpsAccuracy: docA.accuracy,
          distanceDiffKm: null
        });
      }
    } else if (docA.method === 'IP_GEOLOCATION') {
      let partnerDoc = null;
      const timeA = docA.clientTimestamp || docA.createdAt?.toMillis?.() || 0;

      for (let j = 0; j < sorted.length; j++) {
        if (i === j) continue;
        const candidate = sorted[j];
        if (handledLegacyIds.has(candidate.id)) continue;
        if (candidate.method === 'BROWSER_GPS') {
          const timeB = candidate.clientTimestamp || candidate.createdAt?.toMillis?.() || 0;
          const sameIp = docA.ip && candidate.ip && docA.ip === candidate.ip;
          const sameDevice = docA.deviceName && candidate.deviceName && docA.deviceName === candidate.deviceName;
          const closeTime = Math.abs(timeA - timeB) < 15 * 60 * 1000;

          if ((sameIp || sameDevice) && closeTime) {
            partnerDoc = candidate;
            break;
          }
        }
      }

      if (partnerDoc) {
        handledLegacyIds.add(docA.id);
        handledLegacyIds.add(partnerDoc.id);

        const ipLat = docA.latitude != null ? Number(docA.latitude) : null;
        const ipLng = docA.longitude != null ? Number(docA.longitude) : null;
        const gpsLat = partnerDoc.latitude != null ? Number(partnerDoc.latitude) : null;
        const gpsLng = partnerDoc.longitude != null ? Number(partnerDoc.longitude) : null;
        const distanceDiffKm = getDistanceKm(ipLat, ipLng, gpsLat, gpsLng);

        mergedRows.push({
          id: docA.id,
          docIds: [docA.id, partnerDoc.id],
          userName: docA.userName || partnerDoc.userName || '—',
          time: partnerDoc.createdAt?.toDate?.() || new Date(partnerDoc.clientTimestamp || timeA || Date.now()),
          deviceName: partnerDoc.deviceName || docA.deviceName || 'Unknown Device',
          hostDomain: docA.hostDomain || partnerDoc.hostDomain || '—',
          ip: docA.ip || partnerDoc.ip || '—',
          city: [docA.city, docA.region, docA.country].filter(Boolean).join(', ') || 'Unknown Location',
          ipLat,
          ipLng,
          hasGps: true,
          gpsLat,
          gpsLng,
          gpsAccuracy: partnerDoc.accuracy,
          distanceDiffKm
        });
      } else {
        // Standalone IP legacy (GPS pending)
        handledLegacyIds.add(docA.id);
        mergedRows.push({
          id: docA.id,
          docIds: [docA.id],
          userName: docA.userName || '—',
          time: docA.createdAt?.toDate?.() || new Date(timeA || Date.now()),
          deviceName: docA.deviceName || 'Unknown Device',
          hostDomain: docA.hostDomain || '—',
          ip: docA.ip || '—',
          city: [docA.city, docA.region, docA.country].filter(Boolean).join(', ') || 'Unknown Location',
          ipLat: Number(docA.latitude),
          ipLng: Number(docA.longitude),
          hasGps: false,
          gpsLat: null,
          gpsLng: null,
          gpsAccuracy: null,
          distanceDiffKm: null
        });
      }
    } else {
      handledLegacyIds.add(docA.id);
      mergedRows.push({
        id: docA.id,
        docIds: [docA.id],
        userName: docA.userName || '—',
        time: docA.createdAt?.toDate?.() || new Date(docA.clientTimestamp || Date.now()),
        deviceName: docA.deviceName || 'Unknown Device',
        hostDomain: docA.hostDomain || '—',
        ip: docA.ip || '—',
        city: '—',
        ipLat: docA.latitude != null ? Number(docA.latitude) : null,
        ipLng: docA.longitude != null ? Number(docA.longitude) : null,
        hasGps: false,
        gpsLat: null,
        gpsLng: null,
        gpsAccuracy: null,
        distanceDiffKm: null
      });
    }
  }

  return mergedRows;
}

/* =============================================================
   4. FIRESTORE REAL-TIME LISTENER
   ============================================================= */
function startRealtimeListener() {
  if (!isFirebaseConfigured || !db) {
    tableBody.innerHTML = `<tr><td colspan="6" class="empty-state">Firebase is not configured. Check firebase-config.js.</td></tr>`;
    return;
  }

  tableBody.innerHTML = `<tr><td colspan="6" class="empty-state">Loading real-time records…</td></tr>`;

  try {
    const q = collection(db, 'locations');

    unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
      const rawRecords = [];
      snapshot.forEach((docSnapshot) => {
        rawRecords.push({
          id: docSnapshot.id,
          ...docSnapshot.data()
        });
      });

      // Merge records so IP and GPS from the same visit are in the EXACT SAME row
      allMergedRecords = processAndMergeRecords(rawRecords);
      renderTable();
    }, (err) => {
      console.error('Firestore listener error:', err);
      tableBody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:#f87171;">Firestore error: ${err.message}</td></tr>`;
    });
  } catch (err) {
    console.error('Failed to listen to Firestore:', err);
    tableBody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:#f87171;">Listener initialization error: ${err.message}</td></tr>`;
  }
}

/* =============================================================
   5. TABLE RENDERING & FILTERING
   ============================================================= */
function renderTable() {
  const queryText = currentSearch.toLowerCase().trim();

  const filtered = allMergedRecords.filter((rec) => {
    // Filter logic
    if (currentFilter === 'VERIFIED' && !rec.hasGps) return false;
    if (currentFilter === 'PENDING' && rec.hasGps) return false;
    if (currentFilter === 'MISMATCH') {
      if (!rec.hasGps || rec.distanceDiffKm == null || rec.distanceDiffKm <= 25) return false;
    }

    // Search query logic
    if (queryText) {
      const haystack = [
        rec.userName || '',
        rec.deviceName || '',
        rec.hostDomain || '',
        rec.city || '',
        rec.ip || '',
        rec.ipLat != null ? String(rec.ipLat) : '',
        rec.ipLng != null ? String(rec.ipLng) : '',
        rec.gpsLat != null ? String(rec.gpsLat) : '',
        rec.gpsLng != null ? String(rec.gpsLng) : ''
      ].join(' ').toLowerCase();

      if (!haystack.includes(queryText)) return false;
    }

    return true;
  });

  recordCount.textContent = `${filtered.length} of ${allMergedRecords.length} visits`;

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="7" class="empty-state">No matching visit logs found.</td></tr>`;
    return;
  }

  tableBody.innerHTML = filtered.map((rec) => {
    // Format timestamp
    const timeStr = rec.time instanceof Date ? rec.time.toLocaleString() : new Date(rec.time).toLocaleString();

    // Data 1 (IP) Details
    let ipCell = '—';
    if (rec.ipLat != null && rec.ipLng != null) {
      const ipLatStr = rec.ipLat.toFixed(6);
      const ipLngStr = rec.ipLng.toFixed(6);
      ipCell = `
        <div style="margin-bottom: 4px; color: #f1f5f9;">
          <span class="badge-tag badge-tag-ip">IP</span> ${escapeHtml(rec.city)}
        </div>
        <a href="https://www.google.com/maps?q=${rec.ipLat},${rec.ipLng}" target="_blank" rel="noopener noreferrer" class="maps-link">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          ${ipLatStr}, ${ipLngStr}
        </a>
      `;
    } else {
      ipCell = `<span style="color: #64748b; font-style: italic;">No IP Coordinates</span>`;
    }

    // Data 2 (GPS) Details
    let gpsCell = '—';
    if (rec.hasGps && rec.gpsLat != null && rec.gpsLng != null) {
      const gpsLatStr = rec.gpsLat.toFixed(6);
      const gpsLngStr = rec.gpsLng.toFixed(6);
      const accStr = rec.gpsAccuracy ? `±${Number(rec.gpsAccuracy).toFixed(1)} m` : 'Precision locked';
      gpsCell = `
        <div style="margin-bottom: 4px; color: #86efac; font-weight: 600;">
          <span class="badge-tag badge-tag-gps">GPS</span> ${accStr}
        </div>
        <a href="https://www.google.com/maps?q=${rec.gpsLat},${rec.gpsLng}" target="_blank" rel="noopener noreferrer" class="maps-link">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          ${gpsLatStr}, ${gpsLngStr}
        </a>
      `;
    } else if (rec.gpsErrorReason || rec.gpsStatus === 'FAILED') {
      gpsCell = `<span class="badge-status badge-mismatch" title="${escapeHtml(rec.gpsErrorMessage || '')}">❌ ${escapeHtml(rec.gpsErrorReason || 'GPS Failed')}</span>`;
    } else {
      gpsCell = `<span class="badge-status badge-pending">⏳ Awaiting Click</span>`;
    }

    // Location Verification & Comparison
    let verificationCell = '';
    if (rec.hasGps && rec.ipLat != null && rec.gpsLat != null) {
      const dist = rec.distanceDiffKm;
      let badgeHtml = '';

      if (dist != null) {
        if (dist <= 20) {
          badgeHtml = `<span class="badge-status badge-match">✓ Match (~${dist < 1 ? Math.round(dist * 1000) + ' m' : dist.toFixed(1) + ' km'})</span>`;
        } else if (dist <= 80) {
          badgeHtml = `<span class="badge-status badge-near">~ Nearby (~${dist.toFixed(1)} km)</span>`;
        } else {
          badgeHtml = `<span class="badge-status badge-mismatch">⚠ Mismatch (~${Math.round(dist)} km off)</span>`;
        }
      } else {
        badgeHtml = `<span class="badge-status badge-match">✓ GPS Verified</span>`;
      }

      const compareUrl = `https://www.google.com/maps/dir/?api=1&origin=${rec.ipLat},${rec.ipLng}&destination=${rec.gpsLat},${rec.gpsLng}`;
      verificationCell = `
        <div>${badgeHtml}</div>
        <a href="${compareUrl}" target="_blank" rel="noopener noreferrer" class="btn-compare-map">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
          Compare on Map ↗
        </a>
      `;
    } else if (rec.hasGps) {
      verificationCell = `<span class="badge-status badge-gps-only">GPS Only (No IP)</span>`;
    } else {
      verificationCell = `<span class="badge-status badge-pending">GPS Pending</span>`;
    }

    // User Name Display
    const nameDisplay = (rec.userName && rec.userName !== '—')
      ? `<strong style="color: #f8fafc; font-size: 0.92rem;">${escapeHtml(rec.userName)}</strong>`
      : `<span style="color: #64748b; font-style: italic;">—</span>`;

    return `
      <tr id="row-${rec.id}">
        <td><strong>${timeStr}</strong></td>
        <td>${nameDisplay}</td>
        <td>
          <div style="font-weight: 600; color: #f1f5f9;">${escapeHtml(rec.deviceName)}</div>
          <div style="font-size: 0.76rem; color: #94a3b8; margin-top: 2px;">${escapeHtml(rec.hostDomain)}</div>
          <code style="display: inline-block; margin-top: 4px; font-size: 0.76rem; color: #38bdf8; background: #0f172a; padding: 0.1rem 0.35rem; border-radius: 4px;">${escapeHtml(rec.ip)}</code>
        </td>
        <td>${ipCell}</td>
        <td>${gpsCell}</td>
        <td>${verificationCell}</td>
        <td>
          <button class="btn-delete" data-docids='${JSON.stringify(rec.docIds)}'>Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  // Attach delete handlers
  document.querySelectorAll('.btn-delete').forEach((btn) => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.docids));
  });
}

/**
 * Handle document deletion (handles single or paired legacy document IDs).
 */
async function handleDelete(docIdsJson) {
  let docIds = [];
  try {
    docIds = JSON.parse(docIdsJson);
  } catch (e) {
    docIds = [docIdsJson];
  }

  if (!confirm(`Delete this visit record?`)) return;

  try {
    await Promise.all(docIds.map(id => deleteDoc(doc(db, 'locations', id))));
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
   6. EVENT LISTENERS
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
