import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

if (import.meta.env.DEV) {
  console.log("Firebase Config Check:", {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ? `${import.meta.env.VITE_FIREBASE_API_KEY.substring(0, 10)}...` : "MISSING",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "MISSING",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "MISSING",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "MISSING",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "MISSING",
    appId: import.meta.env.VITE_FIREBASE_APP_ID ? `${import.meta.env.VITE_FIREBASE_APP_ID.substring(0, 15)}...` : "MISSING",
  });
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const hasAllConfig = 
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.storageBucket &&
  firebaseConfig.messagingSenderId &&
  firebaseConfig.appId;

if (!hasAllConfig) {
  const missing = [];
  if (!firebaseConfig.apiKey) missing.push("VITE_FIREBASE_API_KEY");
  if (!firebaseConfig.authDomain) missing.push("VITE_FIREBASE_AUTH_DOMAIN");
  if (!firebaseConfig.projectId) missing.push("VITE_FIREBASE_PROJECT_ID");
  if (!firebaseConfig.storageBucket) missing.push("VITE_FIREBASE_STORAGE_BUCKET");
  if (!firebaseConfig.messagingSenderId) missing.push("VITE_FIREBASE_MESSAGING_SENDER_ID");
  if (!firebaseConfig.appId) missing.push("VITE_FIREBASE_APP_ID");
  
  console.error("Firebase Configuration Error: Missing variables:", missing);
  console.error("Make sure you:");
  console.error("   1. Have all VITE_FIREBASE_* variables in frontend/.env");
  console.error("   2. Restarted the Vite dev server after adding .env variables");
  console.error("   3. Variables don't have 'your-' placeholder values");
  
  throw new Error(
    `Firebase configuration incomplete. Missing: ${missing.join(", ")}. Please check frontend/.env and restart the dev server.`
  );
}

let app;
let auth;
let db;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  console.log("Firebase initialized successfully");
  console.log("Firestore initialized:", db ? "Yes" : "No");
} catch (error) {
  console.error("Firebase initialization error:", error);
  console.error("Config used:", {
    ...firebaseConfig,
    apiKey: firebaseConfig.apiKey ? `${firebaseConfig.apiKey.substring(0, 10)}...` : "MISSING",
  });
  throw error;
}

export { auth, db };
export default app;
