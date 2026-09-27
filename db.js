import { collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, isFirebaseConfigured } from './firebase-config.js';

/**
 * Saves a location entry into Cloud Firestore under the 'locations' collection.
 * 
 * @param {object} data - Location data object (latitude, longitude, accuracy, method, city, etc.)
 * @returns {Promise<{ success: boolean, docId?: string, error?: string, skipped?: boolean }>}
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
      userAgent: navigator.userAgent
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
