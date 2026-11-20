import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported, logEvent } from "firebase/analytics";

const firebaseConfig = {
	apiKey: "AIzaSyBDZSOlGnDZuv9LpDWCBE3MjhO9qUjfTwA",
	authDomain: "dama-store.firebaseapp.com",
	projectId: "dama-store",
	storageBucket: "dama-store.firebasestorage.app",
	messagingSenderId: "80005345755",
	appId: "1:80005345755:web:8048d8aa1d27f6187ff7fe",
	measurementId: "G-J557MTRP00",
};

const analytics = isSupported()
	.then((supported) => supported ? getAnalytics(initializeApp(firebaseConfig)) : null)
	.catch(() => null);

export async function sendEvent(name, params) {
	const client = await analytics;
	if (!client) return;
	try {
		logEvent(client, name, params);
	} catch { /* Keep telemetry failures off the storefront. */ }
}
