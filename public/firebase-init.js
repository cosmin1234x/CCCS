// firebase-init.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBKhIjeiNyCCdzrTcS3p1a3RStlH26aUmM",
  authDomain: "mc-training-portal.firebaseapp.com",
  projectId: "mc-training-portal",
  storageBucket: "mc-training-portal.firebasestorage.app",
  messagingSenderId: "1047989594370",
  appId: "1:1047989594370:web:f99cdb4b857feebf63fa1b",
  measurementId: "G-MWD6GQXH4W"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
