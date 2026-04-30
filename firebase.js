// ============================================================
//  FIREBASE CONFIG
//  Заміни значення на свої з Firebase Console:
//  console.firebase.google.com → Project Settings → Your Apps
// ============================================================

 const firebaseConfig = {
    apiKey: "AIzaSyAjA4rxjvk0_2sILu11Bfc-UBiJ5LuDjJI",
    authDomain: "educrm-85756.firebaseapp.com",
    databaseURL: "https://educrm-85756-default-rtdb.firebaseio.com",
    projectId: "educrm-85756",
    messagingSenderId: "248243910161",
    appId: "1:248243910161:web:43c4fc223c3754c0ffe3b0"
  };

firebase.initializeApp(firebaseConfig);
const db   = firebase.database();
const auth = firebase.auth();
