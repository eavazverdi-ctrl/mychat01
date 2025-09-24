// ===== تنظیمات ثابت =====
const ROOM_ID = "global-room-1"; // شناسه اتاق ثابت
const CHUNK_SIZE = 64 * 1024;    // 64KB برای ارسال فایل تکه‌تکه
const STUN_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

// --- Firebase config را از فایل محلی بخوان (config.js) ---
import { FIREBASE_CONFIG } from "./config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, onSnapshot, collection, addDoc, deleteDoc, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { signInAnonymously, getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);
await signInAnonymously(auth);

// UI refs
const log = document.getElementById("log");
const form = document.getElementById("chatForm");
const input = document.getElementById("text");
const copyInvite = document.getElementById("copyInvite");
const fileInput = document.getElementById("fileInput");
const sendFileBtn = document.getElementById("sendFileBtn");
const fileStatus = document.getElementById("fileStatus");

// Helpers
const addSys = (t) => {
  const d = document.createElement("div");
  d.className = "sys";
  d.textContent = t;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
};
const addMsg = (txt, you=false) => {
  const wrap = document.createElement("div");
  wrap.className = "msg" + (you ? " you" : "");
  const b = document.createElement("div");
  b.className = "bubble";
  b.textContent = txt;
  wrap.appendChild(b);
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
};
const addFileLink = (name, blobUrl, you=false) => {
  const wrap = document.createElement("div");
  wrap.className = "msg" + (you ? " you" : "");
  const b = document.createElement("div");
  b.className = "bubble";
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = name;
  a.className = "link";
  a.textContent = `📄 دریافت فایل: ${name}`;
  b.appendChild(a);
  wrap.appendChild(b);
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
};

// Copy invite (همین لینک)
copyInvite.addEventListener("click", async () => {
  await navigator.clipboard.writeText(location.href);
  addSys("لینک کپی شد.");
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

// Create DataChannel when we are offerer
pc.ondatachannel = (e) => {
  if (!dc) attachDataChannel(e.channel);
};
function attachDataChannel(channel) {
  dc = channel;
  dc.onopen = () => addSys("کانال داده برقرار شد.");
  dc.onclose = () => addSys("کانال داده بسته شد.");
  dc.onmessage = onData;
}

function onData(evt) {
  // پیام‌ها: یا متن ساده، یا JSON شروع/تکه فایل
  const data = evt.data;
  // تلاش برای JSON
  try {
    const obj = JSON.parse(data);
    if (obj.type === "file-meta") {
      incomingFile = { name: obj.name, size: obj.size, mime: obj.mime, chunks: [] };
      incomingReceived = 0;
      fileStatus.textContent = `درحال دریافت: ${incomingFile.name} (${Math.round(incomingFile.size/1024)} KB)`;
      return;
    }
    if (obj.type === "file-end") {
      const blob = new Blob(incomingFile.chunks, { type: incomingFile.mime || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      addFileLink(incomingFile.name, url, false);
      fileStatus.textContent = "";
      incomingFile = null; incomingReceived = 0;
      return;
    }
  } catch (_) { /* not JSON */ }

  if (data instanceof ArrayBuffer) {
    if (!incomingFile) return;
    incomingFile.chunks.push(new Uint8Array(data));
    incomingReceived += data.byteLength;
    fileStatus.textContent = `دریافت ${Math.round(incomingReceived/1024)} KB از ${Math.round(incomingFile.size/1024)} KB`;
    return;
  }

  // متن معمولی
  addMsg(String(data), false);
}

// File sending
let incomingFile = null, incomingReceived = 0;

sendFileBtn.addEventListener("click", async () => {
  if (!dc || dc.readyState !== "open") return addSys("اتصال برقرار نیست.");
  const file = fileInput.files?.[0];
  if (!file) return addSys("ابتدا فایل را انتخاب کنید.");

  // متادیتا
  dc.send(JSON.stringify({ type: "file-meta", name: file.name, size: file.size, mime: file.type }));
  const reader = file.stream().getReader();
  let sent = 0;
  fileStatus.textContent = `ارسال: 0 KB / ${Math.round(file.size/1024)} KB`;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    // ممکن است DataChannel بافر داشته باشد؛ صبر تا پایین بیاید
    await waitForBufferLow(dc);
    dc.send(value.buffer);
    sent += value.byteLength;
    fileStatus.textContent = `ارسال: ${Math.round(sent/1024)} KB / ${Math.round(file.size/1024)} KB`;
  }
  dc.send(JSON.stringify({ type: "file-end" }));
  addSys("ارسال فایل تمام شد.");
  addFileLink(file.name, URL.createObjectURL(file), true);
});

function waitForBufferLow(channel) {
  return new Promise(res => {
    if (channel.bufferedAmount < 1e6) return res(); // 1MB
    const iv = setInterval(() => {
      if (channel.bufferedAmount < 1e6) { clearInterval(iv); res(); }
    }, 50);
  });
}

// Chat form
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = (input.value || "").trim();
  if (!msg) return;
  if (!dc || dc.readyState !== "open") { addSys("اتصال برقرار نیست."); return; }
  dc.send(msg);
  addMsg(msg, true);
  input.value = "";
});

// ICE candidates -> Firestore
pc.onicecandidate = async (e) => {
  if (e.candidate) {
    await addDoc(candidatesCol, { candidate: e.candidate.toJSON(), from: isOfferer ? "offerer" : "answerer" });
  }
};

// Auto-join/create fixed room
await ensureRoom();
await joinRoom();

// --- Signaling logic ---
async function ensureRoom() {
  const exists = await getDoc(roomRef);
  if (!exists.exists()) {
    await setDoc(roomRef, { createdAt: Date.now() });
  }
}

async function joinRoom() {
  // تشخیص نقش: اگر offer وجود ندارد، offerer می‌شویم
  const offSnap = await getDocs(offersCol);
  isOfferer = offSnap.empty;

  if (isOfferer) {
    const channel = pc.createDataChannel("chat");
    attachDataChannel(channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const offerRef = await addDoc(offersCol, { sdp: offer.sdp, type: offer.type, t: Date.now() });

    // گوش‌دادن به پاسخ‌ها
    onSnapshot(answersCol, async (snap) => {
      for (const ch of snap.docChanges()) {
        const a = ch.doc.data();
        if (a && a.type === "answer" && pc.signalingState !== "stable") {
          await pc.setRemoteDescription({ type: "answer", sdp: a.sdp });
          addSys("طرف مقابل وصل شد.");
        }
      }
    });
  } else {
    // answerer
    const q = query(offersCol);
    onSnapshot(q, async (snap) => {
      const first = snap.docs[0]?.data();
      if (first && pc.signalingState === "stable") return;
      if (first && first.type === "offer") {
        await pc.setRemoteDescription({ type: "offer", sdp: first.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await addDoc(answersCol, { sdp: answer.sdp, type: "answer", t: Date.now() });
        addSys("پاسخ ارسال شد؛ منتظر اتصال…");
      }
    });
  }

  // دریافت کاندیدها
  onSnapshot(candidatesCol, async (snap) => {
    for (const ch of snap.docChanges()) {
      const c = ch.doc.data();
      if (!c?.candidate) continue;
      try { await pc.addIceCandidate(c.candidate); } catch {}
    }
  });

  addSys(isOfferer ? "منتظر نفر بعدی برای اتصال…" : "درحال اتصال…");
}
