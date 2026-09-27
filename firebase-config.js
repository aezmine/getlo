import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* =============================================================
   FIREBASE CONFIGURATION
   ============================================================= */
export const firebaseConfig = {
  apiKey: "AIzaSyCv4W9nZ9rT2mBhfAmx8dQG10ucz7cOO4g",
  authDomain: "dapatlo.firebaseapp.com",
  projectId: "dapatlo",
  storageBucket: "dapatlo.firebasestorage.app",
  messagingSenderId: "808491824496",
  appId: "1:808491824496:web:5d2b446cfea93193af0bb5"
};

// Validated configuration flag
export const isFirebaseConfigured = Boolean(
  firebaseConfig.projectId &&
  !firebaseConfig.projectId.includes("YOUR_PROJECT_ID") &&
  firebaseConfig.apiKey &&
  !firebaseConfig.apiKey.includes("YOUR_API_KEY")
);

let db = null;
if (isFirebaseConfigured) {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  } catch (err) {
    console.error("Firebase initialization failed:", err);
  }
}

export { db };
