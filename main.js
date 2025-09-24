// ===== تنظیمات ثابت =====
const ROOM_ID = "global-room-1"; // شناسه اتاق ثابت
const STUN_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

// --- Firebase config را از فایل محلی بخوان (config.js) ---
import { FIREBASE_CONFIG } from "./config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, collection, addDoc, getDocs, serverTimestamp, orderBy, query
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { signInAnonymously, getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);
await signInAnonymously(auth);

const me = () => auth.currentUser?.uid || Math.random().toString(36).slice(2);

// UI refs
const statusBar = document.getElementById("statusBar");
const log = document.getElementById("log");
const form = document.getElementById("chatForm");
const input = document.getElementById("text");
const sendBtn = document.getElementById("sendBtn");
const copyInvite = document.getElementById("copyInvite");
const fileInput = document.getElementById("fileInput");
const fileBtn = document.getElementById("fileBtn");
const fileName = document.getElementById("fileName");

// Helpers
function addSys(t) {
  const d = document.createElement("div");
  d.className = "sys";
  d.textContent = t;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}
function colorFromId(id) {
  // ثابت ولی متفاوت برای هر کاربر
  let h = 0;
  for (let i=0;i<id.length;i++) h = (h*31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 35%)`;
}
function addMsgBubble({text, from, you=false}) {
  const wrap = document.createElement("div");
  wrap.className = "msg" + (you ? " you" : "");
  const b = document.createElement("div");
  b.className = "bubble";
  if (!you) b.style.background = colorFromId(from);
  const name = document.createElement("span");
  name.className = "from";
  name.textContent = you ? "شما" : from.slice(0,6);
  b.appendChild(name);
  const content = document.createElement("div");
  content.textContent = text;
  b.appendChild(content);
  wrap.appendChild(b);
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
}
function addFileLink({name, blobUrl, from, you=false}) {
  const wrap = document.createElement("div");
  wrap.className = "msg" + (you ? " you" : "");
  const b = document.createElement("div");
  b.className = "bubble";
  if (!you) b.style.background = colorFromId(from);
  const who = document.createElement("span");
  who.className = "from";
  who.textContent = you ? "شما" : from.slice(0,6);
  b.appendChild(who);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = name;
  a.className = "link";
  a.textContent = `📄 دریافت فایل: ${name}`;
  b.appendChild(a);
  wrap.appendChild(b);
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
}
function setStatus(t){ statusBar.textContent = t; }

// Copy invite (همین لینک)
copyInvite.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    setStatus("لینک کپی شد.");
  } catch { setStatus("خطا در کپی لینک"); }
});

// --- WebRTC objects
const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
let dc; // DataChannel
let isOfferer = false;

// Firestore refs
const roomRef = doc(db, "rooms", ROOM_ID);
const offersCol = collection(db, "rooms", ROOM_ID, "offers");
const answersCol = collection(db, "rooms", ROOM_ID, "answers");
const candidatesCol = collection(db, "rooms", ROOM_ID, "candidates");

// Data channel handlers
pc.ondatachannel = (e) => {
  if (!dc) attachDataChannel(e.channel);
};
function attachDataChannel(channel) {
  dc = channel;
  dc.binaryType = "arraybuffer";
  dc.onopen = () => { setStatus("اتصال برقرار شد."); enableInputs(true); };
  dc.onclose = () => { setStatus("اتصال قطع شد."); enableInputs(false); };
  dc.onmessage = onData;
}

// Disable inputs until open
enableInputs(false);
function enableInputs(ok){
  input.disabled = !ok;
  sendBtn.disabled = !ok;
  fileBtn.style.opacity = ok ? "1" : ".6";
}

// File receiving state
let incomingFile = null, incomingReceived = 0;

function onData(evt) {
  const data = evt.data;
  try {
    const obj = JSON.parse(data);
    if (obj.type === "txt") {
      addMsgBubble({text: obj.text, from: obj.from, you:false});
      return;
    }
    if (obj.type === "file-meta") {
      incomingFile = { name: obj.name, size: obj.size, mime: obj.mime, from: obj.from, chunks: [] };
      incomingReceived = 0;
      setStatus(`دریافت فایل: ${incomingFile.name}`);
      return;
    }
    if (obj.type === "file-end") {
      const blob = new Blob(incomingFile.chunks, { type: incomingFile.mime || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      addFileLink({name: incomingFile.name, blobUrl: url, from: incomingFile.from, you:false});
      setStatus("فایل دریافت شد.");
      incomingFile = null; incomingReceived = 0;
      return;
    }
  } catch (_) { /* not JSON */ }

  if (data instanceof ArrayBuffer) {
    if (!incomingFile) return;
    incomingFile.chunks.push(new Uint8Array(data));
    incomingReceived += data.byteLength;
    setStatus(`دریافت ${Math.round(incomingReceived/1024)} KB از ${Math.round(incomingFile.size/1024)} KB`);
    return;
  }
}

// Chat form
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = (input.value || "").trim();
  if (!msg) return;
  if (!dc || dc.readyState !== "open") { setStatus("اتصال برقرار نیست."); return; }
  dc.send(JSON.stringify({ type:"txt", text: msg, from: me() }));
  addMsgBubble({text: msg, from: me(), you:true});
  input.value = "";
});

// File choose + send
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileName.textContent = file ? file.name : "";
  if (!file) return;
  if (!dc || dc.readyState !== "open") { setStatus("اتصال برقرار نیست."); return; }
  // متادیتا
  dc.send(JSON.stringify({ type: "file-meta", name: file.name, size: file.size, mime: file.type, from: me() }));
  const reader = file.stream().getReader();
  let sent = 0;
  setStatus(`ارسال: 0 KB / ${Math.round(file.size/1024)} KB`);
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    await waitForBufferLow(dc);
    dc.send(value.buffer);
    sent += value.byteLength;
    setStatus(`ارسال: ${Math.round(sent/1024)} KB / ${Math.round(file.size/1024)} KB`);
  }
  dc.send(JSON.stringify({ type: "file-end" }));
  addFileLink({name: file.name, blobUrl: URL.createObjectURL(file), from: me(), you:true});
  setStatus("فایل ارسال شد.");
  fileInput.value = "";
  fileName.textContent = "";
});

function waitForBufferLow(channel) {
  return new Promise(res => {
    if (channel.bufferedAmount < 1e6) return res();
    const iv = setInterval(() => {
      if (channel.bufferedAmount < 1e6) { clearInterval(iv); res(); }
    }, 50);
  });
}

// ICE candidates -> Firestore
pc.onicecandidate = async (e) => {
  if (e.candidate) {
    await addDoc(candidatesCol, { candidate: e.candidate.toJSON(), from: isOfferer ? "offerer" : "answerer", t: serverTimestamp() });
  }
};

// Start flow
setStatus("درحال اتصال…");
await ensureRoom();
await joinRoom();

async function ensureRoom() {
  const exists = await getDoc(roomRef);
  if (!exists.exists()) {
    await setDoc(roomRef, { createdAt: serverTimestamp() });
  }
}

async function joinRoom() {
  const offSnap = await getDocs(offersCol);
  isOfferer = offSnap.empty;

  if (isOfferer) {
    const channel = pc.createDataChannel("chat");
    attachDataChannel(channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await addDoc(offersCol, { sdp: offer.sdp, type: offer.type, t: serverTimestamp() });

    // Listen for a single answer
    onSnapshot(query(answersCol, orderBy("t","asc")), async (snap) => {
      for (const ch of snap.docChanges()) {
        const a = ch.doc.data();
        if (a && a.type === "answer" && pc.signalingState !== "stable") {
          await pc.setRemoteDescription({ type: "answer", sdp: a.sdp });
          setStatus("طرف مقابل وصل شد.");
        }
      }
    });
  } else {
    // answerer
    onSnapshot(query(offersCol, orderBy("t","asc")), async (snap) => {
      const first = snap.docs[0]?.data();
      if (!first) return;
      if (pc.signalingState === "have-local-offer" || pc.signalingState === "stable" && dc) return;
      if (first.type === "offer") {
        await pc.setRemoteDescription({ type: "offer", sdp: first.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await addDoc(answersCol, { sdp: answer.sdp, type: "answer", t: serverTimestamp() });
        setStatus("پاسخ ارسال شد؛ منتظر اتصال…");
      }
    });
  }

  // دریافت همه کاندیدها
  onSnapshot(query(candidatesCol, orderBy("t","asc")), async (snap) => {
    for (const ch of snap.docChanges()) {
      const c = ch.doc.data();
      if (!c?.candidate) continue;
      try { await pc.addIceCandidate(c.candidate); } catch {}
    }
  });
}
