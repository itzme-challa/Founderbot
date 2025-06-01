// utils/firebase.ts
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, push, set, onValue, remove, get, DataSnapshot } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyDNME0C__0yE84_fmabt9_qhnv7l4Y2osg',
  authDomain: 'telegrambot-d9bde.firebaseapp.com',
  databaseURL: 'https://telegrambot-d9bde-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'telegrambot-d9bde',
  storageBucket: 'telegrambot-d9bde.firebasestorage.app',
  messagingSenderId: '1016643360568',
  appId: '1:1016643360568:web:a495de89c5f7f983e6d3cd',
  measurementId: 'G-ZQLEPBPWZV',
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, push, set, onValue, remove, get, DataSnapshot };
