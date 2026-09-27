import { saveLocationRecord } from './db.js';

// DOM References
const statusBadge = document.getElementById('statusBadge');
const valMethod   = document.getElementById('valMethod');
const valLat      = document.getElementById('valLat');
const valLng      = document.getElementById('valLng');
const valArea     = document.getElementById('valArea');
const valAcc      = document.getElementById('valAcc');
const valDevice   = document.getElementById('valDevice');
const valHost     = document.getElementById('valHost');
const valTime     = document.getElementById('valTime');
const valDbStatus = document.getElementById('valDbStatus');
const errorBox    = document.getElementById('errorBox');
const gpsBtn      = document.getElementById('gpsBtn');
const ipBtn       = document.getElementById('ipBtn');

// Cache detected network host & device info
let detectedHost = 'Resolving…';
let detectedDevice = detectDeviceName();

// Geolocation options
const GPS_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0
};

/**
 * Identifies the phone / PC device name & OS.
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
 * UI helper to set field values.
 */
function setField(el, text) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove('field__value--empty');
}

/**
 * UI helper to set database status.
 */
function setDbStatus(text, stateClass) {
  valDbStatus.textContent = text;
  valDbStatus.className = 'field__value';
  if (stateClass === 'syncing') valDbStatus.classList.add('field__value--syncing');
  else if (stateClass === 'success') valDbStatus.classList.add('field__value--success');
  else if (stateClass === 'fail') valDbStatus.classList.add('field__value--fail');
}

/**
 * UI helper to set status badge.
 */
function setStatus(label, key) {
  statusBadge.textContent = label;
  statusBadge.className = 'badge badge--' + key;
}

/**
 * Show error box.
 */
function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add('visible');
}

/**
 * Clear error box.
 */
function clearError() {
  errorBox.textContent = '';
  errorBox.classList.remove('visible');
}

/* =============================================================
   1. ZERO-PERMISSION IP GEOLOCATION (Instant on Page Load)
   ============================================================= */
export async function fetchIpLocation() {
  clearError();
  setStatus('IP Lookup…', 'loading');
  setDbStatus('Fetching IP coordinates…', 'syncing');
  if (ipBtn) ipBtn.disabled = true;

  try {
    // Primary free IP service (HTTPS, no API key required)
    let res = await fetch('https://ipwho.is/');
    let data = await res.json();

    if (!data.success && data.message) {
      // Fallback service
      res = await fetch('https://freeipapi.com/api/json');
      const fallback = await res.json();
      data = {
        latitude: fallback.latitude,
        longitude: fallback.longitude,
        city: fallback.cityName,
        region: fallback.regionName,
        country: fallback.countryName,
        ip: fallback.ipAddress,
        connection: { domain: fallback.ipAddress, isp: 'Standard ISP' }
      };
    }

    // Resolve network host / domain
    detectedHost = data.connection?.domain || data.connection?.isp || data.ip || 'Unknown Host';

    // Populate UI
    setField(valMethod, 'IP Geolocation (No Permission)');
    setField(valLat, Number(data.latitude).toFixed(6));
    setField(valLng, Number(data.longitude).toFixed(6));
    setField(valArea, `${data.city || 'Unknown'}, ${data.region || ''} ${data.country || ''}`.trim());
    setField(valAcc, 'City-level (~5–15 km)');
    setField(valDevice, detectedDevice);
    setField(valHost, detectedHost);
    setField(valTime, new Date().toLocaleTimeString());

    setStatus('Active (IP)', 'allowed');
    setDbStatus('Saving to Firestore…', 'syncing');

    // Save to Firestore
    const dbResult = await saveLocationRecord({
      latitude: Number(data.latitude),
      longitude: Number(data.longitude),
      accuracy: 10000,
      method: 'IP_GEOLOCATION',
      city: data.city,
      region: data.region,
      country: data.country,
      ip: data.ip,
      deviceName: detectedDevice,
      hostDomain: detectedHost,
      timestamp: Date.now()
    });

    if (dbResult.success) {
      setDbStatus(`Saved (ID: ${dbResult.docId.slice(0, 6)}…)`, 'success');
    } else {
      setDbStatus(dbResult.error || 'Firestore save failed', 'fail');
      showError(`Firestore Error: ${dbResult.error}`);
    }
  } catch (err) {
    console.error('IP lookup error:', err);
    setStatus('Error', 'error');
    showError('Could not fetch IP location: ' + err.message);
    setDbStatus('Skipped', 'fail');
  } finally {
    if (ipBtn) ipBtn.disabled = false;
  }
}

/* =============================================================
   2. HIGH-ACCURACY BROWSER GPS (Requires User Permission)
   ============================================================= */
export function requestGpsLocation() {
  if (!navigator.geolocation) {
    setStatus('Unsupported', 'unsupported');
    showError('navigator.geolocation is not supported by this browser.');
    return;
  }

  clearError();
  setStatus('Requesting GPS…', 'loading');
  setDbStatus('Waiting for GPS lock…', 'syncing');
  if (gpsBtn) gpsBtn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const coords = position.coords;

      setField(valMethod, 'Browser GPS (High Precision)');
      setField(valLat, coords.latitude.toFixed(7));
      setField(valLng, coords.longitude.toFixed(7));
      setField(valAcc, `${coords.accuracy.toFixed(1)} m`);
      setField(valDevice, detectedDevice);
      setField(valHost, detectedHost);
      setField(valTime, new Date(position.timestamp).toLocaleTimeString());

      setStatus('Active (GPS)', 'allowed');
      setDbStatus('Saving GPS to Firestore…', 'syncing');

      // Save GPS fix to Firestore
      const dbResult = await saveLocationRecord({
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
        method: 'BROWSER_GPS',
        deviceName: detectedDevice,
        hostDomain: detectedHost,
        timestamp: position.timestamp
      });

      if (dbResult.success) {
        setDbStatus(`Saved (ID: ${dbResult.docId.slice(0, 6)}…)`, 'success');
      } else {
        setDbStatus(dbResult.error || 'Failed to save', 'fail');
        showError(`Firestore Error: ${dbResult.error}`);
      }

      if (gpsBtn) gpsBtn.disabled = false;
    },
    (error) => {
      let message = '';
      let statusKey = 'error';

      switch (error.code) {
        case error.PERMISSION_DENIED:
          statusKey = 'denied';
          message = 'Permission denied. The user refused location access.';
          break;
        case error.POSITION_UNAVAILABLE:
          message = 'GPS position unavailable. Ensure Location Services are turned on in Windows / Mobile settings.';
          break;
        case error.TIMEOUT:
          message = 'GPS timed out. Laptops/indoors lack satellite view. IP location is still active above.';
          break;
        default:
          message = 'GPS error: ' + (error.message || 'code ' + error.code);
      }

      setStatus(statusKey === 'denied' ? 'Denied' : 'Error',
                statusKey === 'denied' ? 'denied' : 'error');
      showError(message);
      if (gpsBtn) gpsBtn.disabled = false;
    },
    GPS_OPTIONS
  );
}

// Initial UI population
setField(valDevice, detectedDevice);

// Event Listeners
if (gpsBtn) gpsBtn.addEventListener('click', requestGpsLocation);
if (ipBtn) ipBtn.addEventListener('click', fetchIpLocation);

// Auto-run zero-permission IP location immediately when page opens!
fetchIpLocation();
