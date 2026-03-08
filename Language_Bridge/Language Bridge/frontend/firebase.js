import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
    getAuth,
    browserLocalPersistence,
    setPersistence,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    fetchSignInMethodsForEmail,
    sendPasswordResetEmail,
    signInWithPopup,
    GoogleAuthProvider,
    updateProfile,
    onAuthStateChanged,
    signOut,
    deleteUser
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-storage.js";
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    runTransaction,
    serverTimestamp,
    collection,
    addDoc,
    where,
    query,
    getDocs,
    orderBy,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAqsyRDWO7KuJYMgGmRuh2WfZBPsSSnLtk",
    authDomain: "language-bridge-b96e4.firebaseapp.com",
    projectId: "language-bridge-b96e4",
    storageBucket: "language-bridge-b96e4.firebasestorage.app",
    messagingSenderId: "755017296883",
    appId: "1:755017296883:web:97f3c3ef9f1c11fe280086"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const storage = getStorage(app);
const db = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.warn("Firebase auth persistence setup failed:", error?.message || error);
});

function sanitizePathSegment(value, fallback = "file") {
    return (value || fallback)
        .toString()
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, "_") || fallback;
}

function pathForProfilePhoto(userId, fileName = "photo") {
    const uid = sanitizePathSegment(userId, "user");
    const name = sanitizePathSegment(fileName, "photo");
    return `profile-photos/${uid}/${Date.now()}-${name}`;
}

function pathForAttachment(userId, fileName = "attachment") {
    const uid = sanitizePathSegment(userId, "user");
    const name = sanitizePathSegment(fileName, "attachment");
    return `chat-attachments/${uid}/${Date.now()}-${name}`;
}

async function uploadFile(path, file) {
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
}

async function getUsernameRecord(usernameKey) {
    const key = sanitizePathSegment(usernameKey, "").toLowerCase();
    if (!key) return null;

    const snap = await getDoc(doc(db, "usernames", key));
    return snap.exists() ? snap.data() : null;
}

async function reserveUsername(usernameKey, { uid, email, username }) {
    const key = sanitizePathSegment(usernameKey, "").toLowerCase();
    if (!key) {
        const err = new Error("Username is invalid");
        err.code = "lb/invalid-username";
        throw err;
    }

    const usernameRef = doc(db, "usernames", key);
    await runTransaction(db, async (transaction) => {
        const existing = await transaction.get(usernameRef);
        if (existing.exists()) {
            const err = new Error("Username already exists");
            err.code = "lb/username-already-used";
            throw err;
        }

        transaction.set(usernameRef, {
            uid,
            email: (email || "").toLowerCase(),
            username,
            key,
            createdAt: serverTimestamp()
        });
    });
}

async function saveUserProfile(uid, payload = {}) {
    const userRef = doc(db, "users", uid);
    await setDoc(userRef, {
        ...payload,
        email: (payload.email || "").toLowerCase(),
        updatedAt: serverTimestamp()
    }, { merge: true });
}

function emailKey(email) {
    return sanitizePathSegment((email || "").toLowerCase(), "user");
}

function getChatIdByEmails(emailA, emailB) {
    const keys = [emailKey(emailA), emailKey(emailB)].sort();
    return `chat_${keys[0]}__${keys[1]}`;
}

async function saveChatMessage(payload = {}) {
    const fromEmail = (payload.fromEmail || "").toLowerCase().trim();
    const toEmail = (payload.toEmail || "").toLowerCase().trim();
    if (!fromEmail || !toEmail) {
        const err = new Error("Missing chat participant email");
        err.code = "lb/invalid-chat-participant";
        throw err;
    }

    const chatId = getChatIdByEmails(fromEmail, toEmail);
    const fromKey = emailKey(fromEmail);
    const toKey = emailKey(toEmail);
    const chatRef = doc(db, "chats", chatId);

    await setDoc(chatRef, {
        chatId,
        participants: [fromEmail, toEmail],
        participantKeys: [fromKey, toKey],
        participantProfiles: {
            [fromKey]: {
                email: fromEmail,
                username: payload.fromName || fromEmail.split("@")[0]
            },
            [toKey]: {
                email: toEmail,
                username: payload.toName || toEmail.split("@")[0]
            }
        },
        lastMessage: payload.text || "",
        lastMessageAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    }, { merge: true });

    await addDoc(collection(chatRef, "messages"), {
        fromEmail,
        toEmail,
        senderName: payload.fromName || "",
        receiverName: payload.toName || "",
        text: payload.text || "",
        translation: payload.translation || null,
        targetLanguage: payload.targetLanguage || "en",
        createdAt: serverTimestamp()
    });

    return chatId;
}

async function getUserChats(userEmail) {
    const email = (userEmail || "").toLowerCase().trim();
    if (!email) return [];

    const chatQuery = query(
        collection(db, "chats"),
        where("participants", "array-contains", email)
    );

    const snap = await getDocs(chatQuery);
    return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function getChatMessagesByEmails(emailA, emailB) {
    const chatId = getChatIdByEmails(emailA, emailB);
    const messagesQuery = query(
        collection(db, "chats", chatId, "messages"),
        orderBy("createdAt", "asc")
    );
    const snap = await getDocs(messagesQuery);
    return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function subscribeUserChats(userEmail, onChange, onError) {
    const email = (userEmail || "").toLowerCase().trim();
    if (!email || typeof onChange !== "function") return () => {};

    const chatQuery = query(
        collection(db, "chats"),
        where("participants", "array-contains", email)
    );

    return onSnapshot(chatQuery, (snap) => {
        onChange(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
    }, (error) => {
        if (typeof onError === "function") onError(error);
    });
}

function subscribeChatMessagesByEmails(emailA, emailB, onChange, onError) {
    if (typeof onChange !== "function") return () => {};

    const chatId = getChatIdByEmails(emailA, emailB);
    const messagesQuery = query(
        collection(db, "chats", chatId, "messages"),
        orderBy("createdAt", "asc")
    );

    return onSnapshot(messagesQuery, (snap) => {
        onChange(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
    }, (error) => {
        if (typeof onError === "function") onError(error);
    });
}

window.lbFirebase = {
    app,
    auth,
    storage,
    db,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    fetchSignInMethodsForEmail,
    sendPasswordResetEmail,
    signInWithPopup,
    GoogleAuthProvider,
    updateProfile,
    onAuthStateChanged,
    signOut,
    deleteUser,
    getUsernameRecord,
    reserveUsername,
    saveUserProfile,
    getChatIdByEmails,
    saveChatMessage,
    getUserChats,
    getChatMessagesByEmails,
    subscribeUserChats,
    subscribeChatMessagesByEmails,
    pathForProfilePhoto,
    pathForAttachment,
    uploadFile
};
