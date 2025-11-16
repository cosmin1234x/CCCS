// firebase-init.js
// Single, clean Firebase setup for a static site (Netlify etc.)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBKhIjeiNyCCdzrTcS3p1a3RStlH26aUmM",
  authDomain: "mc-training-portal.firebaseapp.com",
  projectId: "mc-training-portal",
  storageBucket: "mc-training-portal.firebasestorage.app",
  messagingSenderId: "1047989594370",
  appId: "1:1047989594370:web:f99cdb4b857feebf63fa1b",
  measurementId: "G-MWD6GQXH4W"
};

// Initialize Firebase ONCE
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const analytics = getAnalytics(app);

// Export what other files need
export { app, auth, db, analytics };
