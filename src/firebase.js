import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
	apiKey: "AIzaSyBDZSOlGnDZuv9LpDWCBE3MjhO9qUjfTwA",
	authDomain: "dama-store.firebaseapp.com",
	projectId: "dama-store",
	storageBucket: "dama-store.firebasestorage.app",
	messagingSenderId: "80005345755",
	appId: "1:80005345755:web:8048d8aa1d27f6187ff7fe",
	measurementId: "G-J557MTRP00",
};

export const app = import.meta.env.VITE_ENABLE_ANALYTICS === "true" ? initializeApp(firebaseConfig) : null;

/** @type {import("firebase/analytics").Analytics | null} */
export let analytics = null;

export const whenAnalytics = (app ? isSupported() : Promise.resolve(false))
	.then((ok) => {
		if (!ok) return null;
		analytics = getAnalytics(app);
		return analytics;
	})
	.catch(() => null);
