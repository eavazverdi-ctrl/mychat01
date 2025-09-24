// برد پیام ساده با Firebase (Firestore + Storage)، لینک ثابت، بدون WebRTC
const ROOM_ID = "global-room-1";

import { FIREBASE_CONFIG } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, serverTimestamp, onSnapshot, query, orderBy, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";

// --- init
const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
await signInAnonymously(auth);

// --- UI
const statusBar = document.getElementById("statusBar");
const log = document.getElementById("log");
const form = document.getElementById("chatForm");
const input = document.getElementById("text");
const sendBtn = document.getElementById("sendBtn");
const copyInvite = document.getElementById("copyInvite");
const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");

const me = () => auth.currentUser?.uid || Math.random().toString(36).slice(2);

function setStatus(t){ statusBar.textContent = t; }
function colorFromId(id) {
  let h = 0;
  for (let i=0;i<id.length;i++) h = (h*31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 35%)`;
}
function el(tag, props={}, children=[]) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for(const c of children) e.appendChild(c);
  return e;
}
function addTextMessage({text, uid}){
  const you = uid === me();
  const wrap = el("div", {className: "msg" + (you ? " you" : "")});
  const b = el("div", {className:"bubble"});
  if (!you) b.style.background = colorFromId(uid);
  b.appendChild(el("span", {className:"from", textContent: you? "شما" : uid.slice(0,6)}));
  b.appendChild(el("div", {textContent: text}));
  wrap.appendChild(b);
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
}
function addFileMessage({name, url, uid}){
  const you = uid === me();
  const wrap = el("div", {className: "msg" + (you ? " you" : "")});
  const b = el("div", {className:"bubble"});
  if (!you) b.style.background = colorFromId(uid);
  b.appendChild(el("span", {className:"from", textContent: you? "شما" : uid.slice(0,6)}));
  const a = el("a", {href:url, textContent:`📄 دریافت فایل: ${name}`, className:"link"});
  a.setAttribute("download", name);
  b.appendChild(a);
  wrap.appendChild(b);
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
}

// --- Firestore collections
const roomDoc = doc(db, "rooms", ROOM_ID);
await setDoc(roomDoc, { exists: true }, { merge: true });
const msgsCol = collection(db, "rooms", ROOM_ID, "messages");

// --- live stream of messages
onSnapshot(query(msgsCol, orderBy("t", "asc")), (snap) => {
  log.innerHTML = ""; // ساده: کل صفحه را هر بار می‌سازیم (برای مقیاس کوچک OK)
  snap.forEach(d => {
    const m = d.data();
    if (m.type === "txt") addTextMessage({text: m.text, uid: m.uid});
    if (m.type === "file") addFileMessage({name: m.name, url: m.url, uid: m.uid});
  });
  setStatus("آماده");
});

// --- send text
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = (input.value || "").trim();
  if (!text) return;
  await addDoc(msgsCol, { type:"txt", text, uid: me(), t: serverTimestamp() });
  input.value = "";
});

// --- choose & upload file
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileName.textContent = file ? file.name : "";
  if (!file) return;

  const path = `rooms/${ROOM_ID}/files/${me()}_${Date.now()}_${file.name}`;
  const storageRef = ref(storage, path);
  const task = uploadBytesResumable(storageRef, file);
  setStatus("در حال آپلود فایل…");
  task.on("state_changed", (snap) => {
    const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
    setStatus(`آپلود: ${pct}%`);
  }, (err) => {
    setStatus("خطا در آپلود فایل");
  }, async () => {
    const url = await getDownloadURL(task.snapshot.ref);
    await addDoc(msgsCol, { type:"file", name:file.name, url, uid:me(), t: serverTimestamp() });
    setStatus("فایل ارسال شد.");
    fileInput.value = "";
    fileName.textContent = "";
  });
});

// --- copy invite
copyInvite.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(location.href); setStatus("لینک کپی شد."); }
  catch { setStatus("خطا در کپی لینک"); }
});
