// برد "دکمه‌ای" با polling دوره‌ای از Firestore + Storage
const ROOM_ID = "global-room-1";
const POLL_MS = 3000; // هر ۳ ثانیه

import { FIREBASE_CONFIG } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, collection, addDoc, serverTimestamp, getDocs, orderBy, query, doc, setDoc, limit } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
await signInAnonymously(auth);

const board = document.getElementById("board");
const form = document.getElementById("chatForm");
const input = document.getElementById("text");
const copyInvite = document.getElementById("copyInvite");
const fileInput = document.getElementById("fileInput");

const uidPart = () => (auth.currentUser?.uid || "guest").slice(0,6);
const myKey = uidPart() + "-" + (Math.random().toString(36).slice(2,6));

// Firestore refs
const roomDoc = doc(db, "rooms", ROOM_ID);
await setDoc(roomDoc, { exists: true }, { merge: true });
const msgsCol = collection(db, "rooms", ROOM_ID, "messages");

// render helpers
const rendered = new Set();
function colorFromId(id) {
  let h = 0; for (let i=0;i<id.length;i++) h=(h*31+id.charCodeAt(i))%360;
  return `hsl(${h} 70% 35%)`;
}
function addTile({you, who, contentEl}) {
  const tile = document.createElement('div');
  tile.className = 'tile' + (you ? ' you' : '');
  if (!you) tile.style.background = colorFromId(who);
  const whoEl = document.createElement('div');
  whoEl.className = 'who';
  whoEl.textContent = you ? 'شما' : who;
  tile.appendChild(whoEl);
  tile.appendChild(contentEl);
  board.appendChild(tile);
  board.scrollTop = board.scrollHeight;
}
function renderText({text, uid, cid}){
  if (rendered.has(cid)) return; rendered.add(cid);
  const el = document.createElement('div'); el.className='txt'; el.textContent = text;
  addTile({you: uid.startsWith(auth.currentUser?.uid || ''), who: uid.slice(0,6), contentEl: el});
}
function renderFile({name, url, uid, cid}){
  if (rendered.has(cid)) return; rendered.add(cid);
  const a = document.createElement('a'); a.href=url; a.textContent = '📄 ' + name; a.className='filelink'; a.download = name;
  addTile({you: uid.startsWith(auth.currentUser?.uid || ''), who: uid.slice(0,6), contentEl: a});
}

// polling fetch
async function fetchLatest(){
  try{
    const q = query(msgsCol, orderBy('t','asc'));
    const snap = await getDocs(q);
    snap.forEach(d=>{
      const m = d.data();
      const cid = m.cid || d.id;
      if (m.type === 'txt') renderText({text:m.text, uid:m.uid, cid});
      if (m.type === 'file') renderFile({name:m.name, url:m.url, uid:m.uid, cid});
    });
  }catch(e){
    // silently ignore; usually Rules issue
  }
}
// start polling
await fetchLatest();
setInterval(fetchLatest, POLL_MS);

// send text (optimistic tile)
form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const text = (input.value||'').trim();
  if (!text) return;
  const cid = Date.now() + '-' + Math.random().toString(36).slice(2);
  renderText({text, uid: auth.currentUser?.uid || 'guest', cid});
  input.value='';
  try{
    await addDoc(msgsCol, {type:'txt', text, uid: auth.currentUser?.uid || 'guest', cid, t: serverTimestamp()});
  }catch(e){ /* ignore */ }
});

// choose & upload file (optimistic tile after upload)
fileInput.addEventListener('change', async ()=>{
  const file = fileInput.files?.[0];
  if (!file) return;
  const cid = Date.now() + '-' + Math.random().toString(36).slice(2);
  try{
    const path = `rooms/${ROOM_ID}/files/${cid}_${file.name}`;
    const task = uploadBytesResumable(ref(storage, path), file);
    task.on('state_changed', ()=>{}, ()=>{}, async ()=>{
      const url = await getDownloadURL(task.snapshot.ref);
      renderFile({name:file.name, url, uid: auth.currentUser?.uid || 'guest', cid});
      await addDoc(msgsCol, {type:'file', name:file.name, url, uid: auth.currentUser?.uid || 'guest', cid, t: serverTimestamp()});
      fileInput.value='';
    });
  }catch(e){ /* ignore */ }
});

copyInvite.addEventListener('click', async ()=>{
  try{ await navigator.clipboard.writeText(location.href); } catch {}
});
