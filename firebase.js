import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, OAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAlieK1bKZvFNW-aGtrUovKdZUpl4758Uk",
  authDomain: "country-learning-app.firebaseapp.com",
  projectId: "country-learning-app",
  storageBucket: "country-learning-app.firebasestorage.app",
  messagingSenderId: "721836628691",
  appId: "1:721836628691:web:a577ea3d71067669be1226",
  measurementId: "G-GJ82H2Q114",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
export const appleProvider = new OAuthProvider("apple.com");
