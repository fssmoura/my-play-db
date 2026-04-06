import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-analytics.js";

const firebaseConfig = {
    apiKey: "AIzaSyAjFriPkwUvVsiC2OrkF4BjHPgto7qUjs4",
    authDomain: "my-play-db.firebaseapp.com",
    projectId: "my-play-db",
    storageBucket: "my-play-db.firebasestorage.app",
    messagingSenderId: "687614387832",
    appId: "1:687614387832:web:913f21d3d8837cf069ef8d",
    measurementId: "G-D7G9RF7GVF"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const analytics = getAnalytics(app);

export { db, analytics };
