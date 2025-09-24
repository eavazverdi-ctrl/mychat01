// برد پیام ساده با Firebase (Firestore + Storage) — بدون WebRTC
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
await signInAnonymously(auth).catch(e => addSys('خطا در ورود ناشناس به Firebase'));

// --- UI
const log = document.getElementById("log");
const form = document.getElementById("chatForm");
const input = document.getElementById("text");
const copyInvite = document.getElementById("copyInvite");
const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");

const cidPrefix = crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).slice(2));
const me = () => (auth.currentUser?.uid || 'guest') + '-' + cidPrefix.slice(0,6);

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
function addSys(t){
  const d = el('div', {className:'sys', textContent:t});
  log.appendChild(d); log.scrollTop = log.scrollHeight;
}
function addTextMessage({text, uid, cid}){
  if (renderedCids.has(cid)) return;
  renderedCids.add(cid);
  const you = uid.startsWith(auth.currentUser?.uid || ''); // ساده
  const wrap = el("div", {className: "msg" + (you ? " you" : "")});
  const b = el("div", {className:"bubble"});
  if (!you) b.style.background = colorFromId(uid);
  b.appendChild(el("span", {className:"from", textContent: you? "شما" : uid.slice(0,6)}));
  b.appendChild(el("div", {textContent: text}));
  wrap.appendChild(b);
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
}
function addFileMessage({name, url, uid, cid}){
  if (renderedCids.has(cid)) return;
  renderedCids.add(cid);
  const you = uid.startsWith(auth.currentUser?.uid || '');
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
await setDoc(roomDoc, { exists: true }, { merge: true }).catch(e => addSys('خطا در اتصال به Firestore'));
const msgsCol = collection(db, "rooms", ROOM_ID, "messages");

// --- live stream (incremental) ---
const renderedCids = new Set();
onSnapshot(query(msgsCol, orderBy("t", "asc")), (snap) => {
  snap.docChanges().forEach(ch => {
    if (ch.type !== 'added') return;
    const m = ch.doc.data();
    if (m.type === "txt") addTextMessage({text: m.text, uid: m.uid, cid: m.cid || ch.doc.id});
    if (m.type === "file") addFileMessage({name: m.name, url: m.url, uid: m.uid, cid: m.cid || ch.doc.id});
  });
}, (err) => {
  addSys('دریافت پیام‌ها مجاز نیست. قوانین Firestore/Storage را بررسی کنید.');
});

// --- send text (optimistic render) ---
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = (input.value || "").trim();
  if (!text) return;
  const cid = (Date.now() + '-' + Math.random().toString(36).slice(2));
  // optimistic
  addTextMessage({text, uid: me(), cid});
  try{
    await addDoc(msgsCol, { type:"txt", text, uid: me(), cid, t: serverTimestamp() });
  }catch(e){
    addSys('ارسال پیام ناموفق بود (Rules/Network).');
  }
  input.value = "";
});

// --- choose & upload file
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileName.textContent = file ? file.name : "";
  if (!file) return;

  const cid = (Date.now() + '-' + Math.random().toString(36).slice(2));
  // upload
  const path = `rooms/${ROOM_ID}/files/${cid}_${file.name}`;
  try{
    const task = uploadBytesResumable(ref(storage, path), file);
    task.on("state_changed", ()=>{}, (err)=>{
      addSys('خطا در آپلود فایل.'); 
    }, async ()=>{
      const url = await getDownloadURL(task.snapshot.ref);
      // optimistic render
      addFileMessage({name:file.name, url, uid:me(), cid});
      await addDoc(msgsCol, { type:"file", name:file.name, url, uid:me(), cid, t: serverTimestamp() });
      fileInput.value = ""; fileName.textContent = "";
    });
  }catch(e){
    addSys('آپلود مجاز نیست. قوانین Storage را بررسی کنید.');
  }
});

// --- copy invite
copyInvite.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(location.href); addSys("لینک کپی شد."); }
  catch { addSys("خطا در کپی لینک"); }
});
