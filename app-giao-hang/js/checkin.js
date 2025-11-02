/* ========================= checkin.js (FINAL + ZOOM) =========================
 * - Chụp → đính text (KH/HD + thời gian) → gửi ảnh (có/không GPS)
 * - Thêm ma_nv/ten_nv từ localStorage
 * - Toast to giữa màn (tự inject CSS nếu thiếu)
 * - Gửi xong: luôn thu form; nếu có GPS thì đóng trang/app
 * - Zoom như cam thường: zoom thật (applyConstraints) nếu có, fallback zoom ảo
 *   + Pinch-to-zoom, chuột cuộn, nút +/-; ảnh chụp đúng như khi xem
 * ============================================================================ */

/* ========= CẤU HÌNH ========= */
const WEBHOOK_URL = "https://dhsybbqoe.datadex.vn/webhook/hoadon";
const TARGET_W = 900, TARGET_H = 1600;

/* ========= LẤY THAM SỐ ========= */
const q = new URLSearchParams(location.search);
const ma_kh = (q.get("ma_kh") || "").trim();
const ma_hd = (q.get("ma_hd") || "").trim();

/* ========= DOM ========= */
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const btnStart = document.getElementById("btnStart");
const btnShot = document.getElementById("btnShot");
const btnSound = document.getElementById("btnSound");
const toastEl = document.getElementById("toast");
const snapAudio = document.getElementById("snapSound");
const sheet = document.getElementById("sheet");
const btnSendWithGPS = document.getElementById("btnSendWithGPS");
const btnSendNoGPS = document.getElementById("btnSendNoGPS");

// Zoom controls (có thể không có trong HTML tuỳ bạn đã thêm chưa)
const btnZoomIn  = document.getElementById('btnZoomIn');
const btnZoomOut = document.getElementById('btnZoomOut');
const zoomInfo   = document.getElementById('zoomInfo');

let stream = null;

/* ========= TOAST TO GIỮA MÀN HÌNH ========= */
(function ensureToastStyles(){
  if (document.getElementById("__toast_style")) return;
  const css = `
  #toast{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(.92);
    min-width:min(92vw,540px);max-width:92vw;text-align:center;font:600 clamp(18px,2.6vw,24px)/1.35 system-ui,Segoe UI,Roboto,Arial;
    color:#fff;background:rgba(20,20,20,.92);border:2px solid rgba(255,255,255,.12);border-radius:16px;
    box-shadow:0 12px 36px rgba(0,0,0,.4),0 0 0 1px rgba(255,255,255,.05) inset;padding:18px 20px;z-index:999999;
    opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;backdrop-filter:blur(4px)}
  #toast.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
  #toast.ok{background:rgba(16,120,16,.92)} #toast.err{background:rgba(170,20,20,.94)} #toast.info{background:rgba(20,20,20,.92)}
  #toast .icon{display:inline-block;font-size:1.2em;margin-right:8px;transform:translateY(1px)}
  `;
  const s = document.createElement("style");
  s.id="__toast_style"; s.textContent = css; document.head.appendChild(s);
})();

function toast(msg, type = "info", ms = 1600) {
  const el = toastEl || document.getElementById("toast");
  if (!el) { alert(msg); return; }
  el.className = ""; el.classList.add(type);
  const icon = type === "ok" ? "✅" : (type === "err" ? "⚠️" : "ℹ️");
  el.innerHTML = `<span class="icon">${icon}</span>${msg}`;
  clearTimeout(toast._t1); clearTimeout(toast._t2);
  // reflow
  void el.offsetHeight;
  el.classList.add("show");
  try { navigator.vibrate?.(type === "err" ? 40 : 20); } catch {}
  toast._t1 = setTimeout(() => {
    el.classList.remove("show");
    toast._t2 = setTimeout(() => { el.innerHTML = ""; }, 220);
  }, ms);
}

/* ========= BOTTOM SHEET ========= */
function openSheet(){ sheet?.classList.add("on"); }
function closeSheet(){ sheet?.classList.remove("on"); }

/* ========= ÂM THANH ========= */
let audioCtx = null, compressor = null;
const SHUTTER_GAIN = 0.9;
let soundEnabled = (localStorage.getItem("checkin_sound") ?? "1") === "1";

function renderSoundBtn(){
  if(!btnSound) return;
  if(soundEnabled){ btnSound.classList.add("btn-on"); btnSound.textContent="🔊"; btnSound.title="Đang bật tiếng (bấm để tắt)"; }
  else { btnSound.classList.remove("btn-on"); btnSound.textContent="🔇"; btnSound.title="Đang tắt tiếng (bấm để bật)"; }
}
renderSoundBtn();

btnSound && (btnSound.onclick = () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem("checkin_sound", soundEnabled ? "1" : "0");
  renderSoundBtn();
  toast(soundEnabled ? "Đã bật tiếng chụp" : "Đã tắt tiếng chụp", "info", 1500);
});

function ensureAudioCtx(){
  if(!audioCtx){
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, audioCtx.currentTime);
    compressor.knee.setValueAtTime(30, audioCtx.currentTime);
    compressor.ratio.setValueAtTime(12, audioCtx.currentTime);
    compressor.attack.setValueAtTime(0.002, audioCtx.currentTime);
    compressor.release.setValueAtTime(0.1, audioCtx.currentTime);
    compressor.connect(audioCtx.destination);
  }
  if(audioCtx.state === "suspended") return audioCtx.resume();
  return Promise.resolve();
}

function noiseBurst(ctx,t0,dur=0.03){
  const len=Math.floor(ctx.sampleRate*dur);
  const buf=ctx.createBuffer(1,len,ctx.sampleRate);
  const data=buf.getChannelData(0);
  for(let i=0;i<len;i++) data[i]=(Math.random()*2-1)*0.6;
  const src=ctx.createBufferSource(); src.buffer=buf;
  const g=ctx.createGain(); g.gain.setValueAtTime(0,t0);
  g.gain.linearRampToValueAtTime(SHUTTER_GAIN,t0+0.005);
  g.gain.exponentialRampToValueAtTime(0.0008,t0+dur);
  const lp=ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.setValueAtTime(4500,t0);
  src.connect(lp); lp.connect(g); g.connect(compressor);
  src.start(t0); src.stop(t0+dur+0.01);
}

async function playShutter(){
  if(!soundEnabled) return;
  try{ await ensureAudioCtx(); }catch{}
  const ctx = audioCtx, now = ctx.currentTime;
  noiseBurst(ctx, now, 0.035);
  const osc1=ctx.createOscillator(), g1=ctx.createGain();
  osc1.type="square"; osc1.frequency.setValueAtTime(1400,now);
  g1.gain.setValueAtTime(0,now);
  g1.gain.linearRampToValueAtTime(SHUTTER_GAIN,now+0.01);
  g1.gain.exponentialRampToValueAtTime(0.001,now+0.09);
  osc1.connect(g1); g1.connect(compressor); osc1.start(now); osc1.stop(now+0.1);
  const t2=now+0.06; const osc2=ctx.createOscillator(), g2=ctx.createGain();
  osc2.type="square"; osc2.frequency.setValueAtTime(950,t2);
  g2.gain.setValueAtTime(0,t2);
  g2.gain.linearRampToValueAtTime(SHUTTER_GAIN*0.7,t2+0.012);
  g2.gain.exponentialRampToValueAtTime(0.001,t2+0.08);
  osc2.connect(g2); g2.connect(compressor); osc2.start(t2); osc2.stop(t2+0.09);
  try{ snapAudio.currentTime=0; await snapAudio.play(); }catch{}
}

/* ========= CAMERA ========= */
async function startCam(){
  try{
    if(stream) stream.getTracks().forEach(t=>t.stop());
    const base = { video:{ width:{ideal:1080}, height:{ideal:1920}, facingMode:{ideal:"environment"} }, audio:false };
    try{
      stream = await navigator.mediaDevices.getUserMedia(base);
    }catch(e){
      if(e.name === "NotAllowedError") throw new Error("Bạn đã chặn quyền camera. Vào Cài đặt trình duyệt để bật lại.");
      if(e.name === "NotFoundError")  throw new Error("Không tìm thấy thiết bị camera.");
      if(String(e.message).includes("Device in use")){
        toast("Camera đang bận — thử lại...","info",2000);
        await new Promise(r=>setTimeout(r,1000));
        stream = await navigator.mediaDevices.getUserMedia(base);
      }else{ throw e; }
    }
    video.srcObject = stream;
    await new Promise(r=>video.onloadedmetadata=r);

    // Đồng bộ khả năng zoom & set về 1x lúc đầu
    await syncZoomCaps();
    await setZoom(0,5);

    btnShot && (btnShot.disabled = false);
    toast("Đã bật camera","ok",1200);
  }catch(e){
    btnShot && (btnShot.disabled = true);
    toast("Không mở được camera: " + (e.message||e), "err", 4000);
  }
}

function stopCam(){
  if(stream){ try{ stream.getTracks().forEach(t=>t.stop()); }catch{} }
  stream = null; video.srcObject = null;
}

/* ========= ZOOM ========= */
let ZOOM = 0.5, MIN_ZOOM = 0.5, MAX_ZOOM = 6, ZOOM_STEP = 0.2;


function getVideoTrack(){
  try { return stream?.getVideoTracks?.()[0] || null; } catch { return null; }
}

function hasRealZoom(){
  const t = getVideoTrack();
  const caps = t?.getCapabilities?.();
  return !!(caps && 'zoom' in caps);
}

function renderZoomInfo(){
  if(zoomInfo){ zoomInfo.textContent = `${ZOOM.toFixed(1)}×`; }
}

async function applyRealZoom(level){
  const t = getVideoTrack();
  if(!t) return false;
  try{
    await t.applyConstraints({ advanced: [{ zoom: level }] });
    return true;
  }catch(e){
    console.warn('[ZOOM] applyConstraints failed, fallback CSS', e);
    return false;
  }
}

// Zoom ảo bằng CSS
function applyCssZoom(level){
  video.style.transformOrigin = 'center center';
  video.style.transform = `scale(${level})`;
}

// Setter zoom chung
async function setZoom(level){
  level = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level));
  ZOOM = level;
  let ok = false;
  if(hasRealZoom()){
    ok = await applyRealZoom(level);
  }
  if(!ok){
    applyCssZoom(level);
  }
  renderZoomInfo();
}

async function syncZoomCaps(){
  try{
    const t = getVideoTrack();
    const caps = t?.getCapabilities?.();
    if(caps?.zoom){
      MIN_ZOOM = Math.max(1, caps.zoom.min || 1);
      MAX_ZOOM = Math.max(MIN_ZOOM, caps.zoom.max || 6);
      if(ZOOM<MIN_ZOOM || ZOOM>MAX_ZOOM) await setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, ZOOM)));
    }
  }catch{}
}

// Nút bấm +/-
btnZoomIn  && (btnZoomIn.onclick  = () => setZoom(ZOOM + ZOOM_STEP));
btnZoomOut && (btnZoomOut.onclick = () => setZoom(ZOOM - ZOOM_STEP));

// Pinch-to-zoom (2 ngón)
let _pinchStartDist = 0, _pinchStartZoom = 1;
function _dist(a,b){ const dx=a.clientX-b.clientX, dy=a.clientY-b.clientY; return Math.hypot(dx,dy); }
video.addEventListener('touchstart', e=>{
  if(e.touches.length===2){
    _pinchStartDist = _dist(e.touches[0], e.touches[1]);
    _pinchStartZoom = ZOOM;
  }
},{passive:true});
video.addEventListener('touchmove', e=>{
  if(e.touches.length===2 && _pinchStartDist>0){
    const d = _dist(e.touches[0], e.touches[1]);
    const ratio = d / _pinchStartDist;
    setZoom(_pinchStartZoom * ratio);
    e.preventDefault();
  }
},{passive:false});
video.addEventListener('touchend', (event)=>{
  if(event.touches?.length<2){ _pinchStartDist=0; }
}, {passive:true});

// Wheel zoom (desktop)
video.addEventListener('wheel', e=>{
  const delta = e.deltaY>0 ? -ZOOM_STEP : ZOOM_STEP;
  setZoom(ZOOM + delta);
  e.preventDefault();
}, {passive:false});

addEventListener('DOMContentLoaded', renderZoomInfo);

/* ========= VẼ ẢNH LÊN CANVAS (CÓ TÍNH ZOOM) ========= */
function drawToCanvas(){
  const fw = video.videoWidth, fh = video.videoHeight; if(!fw || !fh) return;
  const ar = fw/fh, desired = TARGET_W/TARGET_H;
  let sx=0,sy=0,sw=fw,sh=fh;

  // Cắt theo tỷ lệ đích (cover)
  if(ar > desired){ sw = fh*desired; sx = (fw - sw)/2; }
  else { sh = fw/desired; sy = (fh - sh)/2; }

  // Nếu là zoom ảo (không hỗ trợ zoom thật), crop thêm theo ZOOM để ảnh đúng như preview
  if(!hasRealZoom() && ZOOM>1){
    const zw = sw / ZOOM;
    const zh = sh / ZOOM;
    sx = sx + (sw - zw)/2;
    sy = sy + (sh - zh)/2;
    sw = zw;
    sh = zh;
  }

  canvas.width = TARGET_W; canvas.height = TARGET_H;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, sx,sy,sw,sh, 0,0,TARGET_W,TARGET_H);

  // ===== Overlay text (KH/HD + thời gian) =====
  const pad = 20, boxH = 90;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, TARGET_H - boxH - pad, TARGET_W, boxH + pad);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 28px system-ui,Segoe UI,Roboto,Arial";
  const ts = new Date().toLocaleString("vi-VN");
  const line1 = `KH: ${ma_kh || "—"}   HD: ${ma_hd || "—"}`;
  const line2 = `Thời gian: ${ts}`;
  ctx.fillText(line1, pad, TARGET_H - boxH + 32);
  ctx.font = "normal 24px system-ui,Segoe UI,Roboto,Arial";
  ctx.fillText(line2, pad, TARGET_H - pad - 8);
}

/* ========= GPS ========= */
function getGPSOnce(){
  return new Promise(r=>{
    if(!("geolocation" in navigator)){ console.warn("[GPS] no geolocation"); return r(null); }
    navigator.geolocation.getCurrentPosition(
      p => {
        const { latitude:lat, longitude:lng, accuracy:acc } = p.coords;
        console.log("[GPS] ok:", {lat,lng,acc});
        r({lat,lng,acc});
      },
      e => { console.warn("[GPS] fail:", e); r(null); },
      { enableHighAccuracy:true, timeout:10000, maximumAge:0 }
    );
  });
}

/* ========= ĐÓNG ỨNG DỤNG ========= */
function closeApp(){
  try{ stopCam(); }catch{}
  setTimeout(()=>{
    try{ window.close(); }catch{}
    try{
      if(!document.referrer) location.replace("about:blank"); else history.back();
    }catch{ location.replace("about:blank"); }
  }, 700);
}

/* ========= NHÂN VIÊN (từ cache đăng nhập) ========= */
function getNhanVien(){
  const keys = ["nv","nhan_vien","user_nv","COD_NV","app_nv"];
  for(const k of keys){
    try{
      const raw = localStorage.getItem(k); if(!raw) continue;
      const v = JSON.parse(raw);
      const ma_nv  = v?.ma_nv  ?? v?.maNhanVien ?? v?.ma ?? v?.code ?? v?.id ?? v?.mnv;
      const ten_nv = v?.ten_nv ?? v?.ten       ?? v?.name ?? v?.fullname ?? v?.hoten;
      if(ma_nv || ten_nv) return { ma_nv, ten_nv, rawKey:k };
    }catch{}
  }
  return null;
}

/* ========= GỬI PAYLOAD (fetch JSON) ========= */
let lastImageDataUrl = null, lastImageMime = "image/jpeg";

async function sendPayload(includeGPS){
  if(!lastImageDataUrl){ toast("Chưa có ảnh để gửi","err",1800); return; }

  const nv = getNhanVien();
  const payload = {
    action: "giaohangthanhcong",
    ma_kh, ma_hd,
    image_mime: lastImageMime,
    image_b64: lastImageDataUrl.split(",")[1],
    ts: new Date().toISOString(),
    source: "browser-checkin",
    ...(nv?.ma_nv  ? { ma_nv: nv.ma_nv }  : {}),
    ...(nv?.ten_nv ? { ten_nv: nv.ten_nv } : {})
  };

  // Khóa nút tránh double click
  if (btnSendWithGPS) btnSendWithGPS.disabled = true;
  if (btnSendNoGPS)   btnSendNoGPS.disabled   = true;

  let hadGPS = false;
  if(includeGPS){
    const gps = await Promise.race([
      getGPSOnce(),
      new Promise(r => setTimeout(()=>r(null), 6000)) // timeout 6s
    ]);
    if(gps){ Object.assign(payload, gps); hadGPS = true; }
  }

  try{
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });

    if(!res.ok){
      toast(`Gửi thất bại: HTTP ${res.status}`, "err", 3200);
      if (btnSendWithGPS) btnSendWithGPS.disabled = false;
      if (btnSendNoGPS)   btnSendNoGPS.disabled   = false;
      return;
    }

    // ✅ Thành công → thông báo to + thu form
    const okMsg = hadGPS ? "✅ Gửi thành công (kèm vị trí)" : "✅ Gửi ảnh thành công";
    toast(okMsg, "ok", 1400);
    closeSheet?.();
    navigator.vibrate?.(15);

    if(hadGPS){
      setTimeout(closeApp, 900); // đóng trang/app khi có GPS
    }else{
      // không GPS: mở lại nút để có thể gửi tiếp
      if (btnSendWithGPS) btnSendWithGPS.disabled = false;
      if (btnSendNoGPS)   btnSendNoGPS.disabled   = false;
    }

  }catch(e){
    console.warn("[SEND] network error", e);
    toast("Lỗi mạng khi gửi", "err", 3000);
    if (btnSendWithGPS) btnSendWithGPS.disabled = false;
    if (btnSendNoGPS)   btnSendNoGPS.disabled   = false;
  }
}

/* ========= EVENTS ========= */
btnStart && (btnStart.onclick = startCam);

btnShot && (btnShot.onclick = async () => {
  if(!stream){ toast("Chưa bật camera","err",1500); return; }
  await playShutter();
  drawToCanvas();
  lastImageMime = "image/jpeg";
  lastImageDataUrl = canvas.toDataURL(lastImageMime, 0.85);
  openSheet();
  // đảm bảo bấm được
  if (btnSendWithGPS) btnSendWithGPS.disabled = false;
  if (btnSendNoGPS)   btnSendNoGPS.disabled   = false;
  btnSendWithGPS?.focus?.();
});

btnSendWithGPS && (btnSendWithGPS.onclick = () => {
  sendPayload(true);
});
btnSendNoGPS && (btnSendNoGPS.onclick = () => {
  sendPayload(false);
});

/* ========= AUTO PERMISSION & LIFECYCLE ========= */
(async()=>{
  try{
    const camPerm = navigator.permissions && await navigator.permissions.query({ name:"camera" });
    if(!camPerm || camPerm.state === "granted") await startCam();
  }catch{}
})();
addEventListener("visibilitychange", ()=>{ if(document.hidden) stopCam(); });

/* ========= CẢNH BÁO THIẾU THAM SỐ ========= */
(function guardParams(){
  if(!ma_kh && !ma_hd) toast("Thiếu tham số ma_kh / ma_hd trên URL","err",3500);
})();
