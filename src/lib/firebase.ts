import { getApp, getApps, initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: 'AIzaSyDj9ddB1JorFzgfTojMwx0U_wml7hFivwA',
  authDomain: 'dnd-rnr.firebaseapp.com',
  projectId: 'dnd-rnr',
  storageBucket: 'dnd-rnr.firebasestorage.app',
  messagingSenderId: '1083554524916',
  appId: '1:1083554524916:web:f3b023d4129045d688b8a1',
};

export const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
