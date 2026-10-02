// ============================================================
//  core/firebase.js
//  Єдине місце, де підключається Firebase (модульний SDK).
//  Сторінки імпортують усе потрібне звідси — версію SDK
//  міняємо тільки тут.
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getDatabase, ref, child, get, set, update, push, remove, onValue, off,
  query, orderByChild, orderByKey, equalTo, startAt, endAt, limitToLast,
  serverTimestamp, onDisconnect,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAjA4rxjvk0_2sILu11Bfc-UBiJ5LuDjJI',
  authDomain: 'educrm-85756.firebaseapp.com',
  databaseURL: 'https://educrm-85756-default-rtdb.firebaseio.com',
  projectId: 'educrm-85756',
  messagingSenderId: '248243910161',
  appId: '1:248243910161:web:43c4fc223c3754c0ffe3b0',
};

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getDatabase(app);

export {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  ref, child, get, set, update, push, remove, onValue, off,
  query, orderByChild, orderByKey, equalTo, startAt, endAt, limitToLast,
  serverTimestamp, onDisconnect,
};
