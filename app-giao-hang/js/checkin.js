// ========================= checkin.js (FINAL) =========================
// - Fix "zoom to": object-fit: contain (CSS) + reset camera zoom=1.0 nếu có
// - Ưu tiên camera sau, aspectRatio theo màn hình, width/height ideal
// - Chụp ảnh đúng tỉ lệ video, scale theo devicePixelRatio để nét
// - Hỏi gửi kèm GPS (tùy chọn), upload ảnh qua endpoint cấu hình
// - Âm thanh chụp: mở khóa audio sau tương tác đầu tiên
// - Sau khi gửi thành công: thông báo & quay lại trang trước (hoặc postMessage)

(function(){
  const $ = s => document.querySelector(s);

  const video = $('#video');
  const canvas = $('#canvas');
  const snapSound = $('#snapSound');

  const btnStart = $('#btnStart');
  const btnShot  = $('#btnShot');
  const btnSound = $('#btnSound');

  const sheet = $('#sheet');
  const toast = $('#toast');

  const btnSendWithGPS = $('#btnSendWithGPS');
  const btnSendNoGPS   = $('#btnSendNoGPS');

  const infoTag = $('#infoTag');

  let stream = null;
  let soundOn = true;
  let audioUnlocked = false;

  // ===== Cấu hình upload linh hoạt =====
  // Ưu tiên window.CHECKIN_CONFIG.uploadUrl, sau đó /api/upload_checkin
  function getUploadUrl(){
    return (window.CHECKIN_CONFIG && window.CHECKIN_CONFIG.uploadUrl) || '/api/upload_checkin';
  }

  // Đọc query: ?ma_kh=...&ma_hd=... (đính kèm khi upload)
  function getQueryParams(){
    const q = new URLSearchParams(location.search);
    return {
      ma_kh: q.get('ma_kh') || '',
      ma_hd: q.get('ma_hd') || '',
    };
  }

  // Toast nhỏ
  let toastTimer = null;
  function showToast(msg, ms=2200){
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>toast.classList.remove('show'), ms);
  }

  // Mở khóa audio (iOS/Android yêu cầu thao tác người dùng)
  function unlockAudio(){
    if (audioUnlocked) return;
    // play/pause nhanh để browser cho phép phát âm
    const p = snapSound.play();
    if (p && typeof p.then === 'function'){
      p.then(()=>{ snapSound.pause(); snapSound.currentTime = 0; audioUnlocked = true; })
       .catch(()=>{ /* ignore */ });
    } else {
      audioUnlocked = true;
    }
  }

  // Chọn constraint hợp với màn hình để giảm crop
  function videoConstraints(){
    // Ưu tiên 16:9, hoặc theo tỉ lệ màn hiện tại
    const ratio = (screen.width > screen.height) ? 16/9 : 9/16;
    return {
      facingMode: { ideal: 'environment' },
      aspectRatio: { ideal: ratio },
      width:  { ideal: 1280 },
      height: { ideal: 720 },
      // Tùy máy có thể hỗ trợ thêm:
      // advanced: [{ focusMode: 'continuous' }]
    };
  }

  async function startCamera(){
    try{
      unlockAudio();
      stopCamera(); // dọn trước
      stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(),
        audio: false
      });
      video.srcObject = stream;

      // Reset zoom về min (thường = 1.0) nếu máy có hỗ trợ
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : null;
      if (caps && 'zoom' in caps){
        const minZoom = (caps.zoom && typeof caps.zoom.min === 'number') ? caps.zoom.min : 1;
        await track.applyConstraints({ advanced: [{ zoom: minZoom }] });
      }

      btnShot.disabled = false;
      showToast('✅ Đã bật camera');
      // Hiển thị thông tin bối cảnh (ẩn mặc định)
      // infoTag.style.display = 'block';
      // infoTag.textContent = `${track.label || 'Camera'} • ${video.videoWidth}x${video.videoHeight}`;
    }catch(err){
      console.error(err);
      showToast('Không thể bật camera: ' + (err && err.message ? err.message : err));
    }
  }

  function stopCamera(){
    try{
      if (video) video.pause?.();
      if (stream){
        stream.getTracks().forEach(t=>t.stop());
        stream = null;
      }
    }catch{}
  }

  // Chụp ảnh vào canvas đúng tỉ lệ, scale theo DPR cho nét
  function drawFrameToCanvas(){
    const vw = video.videoWidth  || 1280;
    const vh = video.videoHeight || 720;

    // Canvas hiển thị vẫn object-fit: contain (CSS), nhưng xuất ảnh theo kích thước thực của video
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    canvas.width  = vw * dpr;
    canvas.height = vh * dpr;

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.drawImage(video, 0, 0, vw, vh);
    ctx.restore();
  }

  async function toJpegBlob(quality = 0.9){
    await new Promise(r => requestAnimationFrame(r));
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
  }

  async function sendPhoto(withGPS){
    sheet.classList.remove('show');
    showToast('Đang gửi…');

    let gps = null;
    if (withGPS && 'geolocation' in navigator){
      try{
        const pos = await new Promise((res, rej)=>{
          navigator.geolocation.getCurrentPosition(res, rej, {
            enableHighAccuracy: true,
            timeout: 6000,
            maximumAge: 0
          });
        });
        gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
      }catch(e){
        showToast('Không lấy được vị trí (tiếp tục gửi ảnh).', 1800);
      }
    }

    const blob = await toJpegBlob(0.92);
    if (!blob){ showToast('Không tạo được ảnh.'); return; }

    const form = new FormData();
    form.append('file', blob, `checkin_${Date.now()}.jpg`);
    const qp = getQueryParams();
    if (qp.ma_kh) form.append('ma_kh', qp.ma_kh);
    if (qp.ma_hd) form.append('ma_hd', qp.ma_hd);
    form.append('time', new Date().toISOString());
    if (gps) form.append('gps', JSON.stringify(gps));

    try{
      const res = await fetch(getUploadUrl(), {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('✅ Đã gửi thành công!');

      // Báo về trang mẹ (nếu mở dạng overlay) hoặc quay lại
      try{
        if (window.parent && window.parent !== window){
          window.parent.postMessage({ type: 'checkin:done', ma_kh: qp.ma_kh, ma_hd: qp.ma_hd }, '*');
        }
      }catch{}
      setTimeout(()=>{ history.back(); }, 900);
    }catch(err){
      console.error(err);
      showToast('Gửi thất bại: ' + (err && err.message ? err.message : err));
    }
  }

  // ====== Sự kiện ======
  btnStart.addEventListener('click', startCamera);

  btnShot.addEventListener('click', async ()=>{
    if (!stream){ showToast('Chưa bật camera'); return; }
    if (soundOn){
      try{ await snapSound.play(); }catch{}
    }
    drawFrameToCanvas();
    sheet.classList.add('show');
  });

  btnSound.addEventListener('click', ()=>{
    soundOn = !soundOn;
    btnSound.textContent = soundOn ? '🔊' : '🔈';
  });

  btnSendWithGPS.addEventListener('click', ()=>sendPhoto(true));
  btnSendNoGPS  .addEventListener('click', ()=>sendPhoto(false));

  // Mở camera ngay nếu người dùng cho phép từ trước
  document.addEventListener('visibilitychange', ()=>{
    if (document.visibilityState === 'visible' && !stream){
      // Không tự auto-bật để tránh khó chịu; nếu muốn auto thì gọi startCamera() ở đây.
    }
  });

  // Đảm bảo dọn stream khi rời trang
  window.addEventListener('beforeunload', stopCamera);
})();
