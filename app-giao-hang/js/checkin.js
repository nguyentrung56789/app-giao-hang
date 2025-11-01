// ========================= checkin.js (FINAL • JSON webhook + Big toast + Close on GPS) =========================
// - Video đúng khung: object-fit: contain (làm bằng CSS); track zoom reset về min nếu máy hỗ trợ
// - Ưu tiên camera sau; aspectRatio bám theo màn hình để đỡ crop
// - Chụp frame gốc, scale theo devicePixelRatio -> ảnh nét
// - Upload theo SCHEMA /webhook/hoadon: { action:"checkin", ma_kh, ma_hd, image_mime, image_b64, (lat,lng,acc)? }
// - Thông báo to ở giữa màn hình (JS điều khiển trực tiếp, không cần CSS riêng)
// - Nếu gửi KÈM GPS thành công: đóng trang/app (window.close hoặc history.back)

(function () {
  const $ = (s) => document.querySelector(s);

  // ---- DOM
  const video   = $("#video");
  const canvas  = $("#canvas");
  const snapAud = $("#snapSound");

  const btnStart = $("#btnStart");
  const btnShot  = $("#btnShot");
  const btnSound = $("#btnSound");

  const sheet = $("#sheet");
  const toast = $("#toast");

  const btnSendWithGPS = $("#btnSendWithGPS");
  const btnSendNoGPS   = $("#btnSendNoGPS");

  const infoTag = $("#infoTag"); // có thể ẩn/hiện nếu muốn

  // ---- State
  let stream = null;
  let soundOn = true;
  let audioUnlocked = false;

    // ================= ĐÓNG ỨNG DỤNG HOÀN TOÀN =================
  function closeApp(){
    try { window.close(); } catch {}
    try { if (navigator.app && navigator.app.exitApp) navigator.app.exitApp(); } catch {}
    try { if (window.matchMedia('(display-mode: standalone)').matches) location.replace('about:blank'); } catch {}
    try {
      if (document.referrer) history.back();
      else location.replace('about:blank');
    } catch {
      location.replace('about:blank');
    }
  }


  // ================= CẤU HÌNH =================
  function getUploadUrl() {
    // Ép dùng đúng webhook JSON của bạn
    return "https://dhsybbqoe.datadex.vn/webhook/hoadon";
  }
  function getQP() {
    const q = new URLSearchParams(location.search);
    return { ma_kh: q.get("ma_kh") || "", ma_hd: q.get("ma_hd") || "" };
  }

  // ================= TOAST TO Ở GIỮA =================
  let toastTimer = null;
  function showToastCenter(msg, kind = "info", ms = 2200) {
    // Style lớn, đặt giữa màn hình
    Object.assign(toast.style, {
      position: "fixed",
      left: "50%",
      top: "50%",
      transform: "translate(-50%,-50%)",
      zIndex: "9999",
      maxWidth: "90vw",
      background: kind === "err" ? "#111" : "#0b1220",
      color: "#fff",
      padding: "14px 18px",
      borderRadius: "14px",
      fontWeight: "800",
      fontSize: "18px",
      textAlign: "center",
      boxShadow: "0 12px 36px rgba(0,0,0,.45)",
      border: "1px solid rgba(255,255,255,.15)",
      opacity: "1",
      pointerEvents: "none",
    });
    toast.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.opacity = "0";
    }, ms);
  }
  const showToast = (m, t = "info", ms = 2200) => showToastCenter(m, t, ms);

  // ================= AUDIO (mở khóa & click) =================
  function unlockAudioOnce() {
    if (audioUnlocked) return;
    const p = snapAud.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        snapAud.pause();
        snapAud.currentTime = 0;
        audioUnlocked = true;
      }).catch(() => {});
    } else {
      audioUnlocked = true;
    }
  }
  ["pointerdown", "touchstart", "click"].forEach((ev) => {
    document.addEventListener(ev, unlockAudioOnce, { once: true, passive: true });
  });

  // ================= CAMERA =================
  function videoConstraints() {
    // Bám theo tỉ lệ màn hình: dọc -> 9/16, ngang -> 16/9
    const ratio = screen.width > screen.height ? 16 / 9 : 9 / 16;
    return {
      facingMode: { ideal: "environment" },
      aspectRatio: { ideal: ratio },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    };
  }

  async function startCamera() {
    try {
      unlockAudioOnce();
      stopCamera();
      stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(),
        audio: false,
      });
      video.srcObject = stream;

      // Reset zoom về min nếu có
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities?.() || {};
      if ("zoom" in caps) {
        const minZoom = typeof caps.zoom.min === "number" ? caps.zoom.min : 1;
        try {
          await track.applyConstraints({ advanced: [{ zoom: minZoom }] });
        } catch {}
      }

      btnShot.disabled = false;
      showToast("✅ Đã bật camera", "ok", 1200);

      // // Nếu muốn xem label camera + kích thước:
      // infoTag.style.display = "block";
      // infoTag.textContent = (track.label || "Camera") + " • waiting video size…";
      // setTimeout(() => {
      //   infoTag.textContent = (track.label || "Camera") + ` • ${video.videoWidth}x${video.videoHeight}`;
      // }, 600);
    } catch (err) {
      console.error(err);
      btnShot.disabled = true;
      showToast("Không mở được camera: " + (err?.message || err), "err", 3600);
    }
  }

  function stopCamera() {
    try {
      if (video) video.pause?.();
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
    } catch {}
  }

  // ================= CAPTURE FRAME =================
  function drawFrameToCanvas() {
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

    canvas.width = vw * dpr;
    canvas.height = vh * dpr;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.drawImage(video, 0, 0, vw, vh);
    ctx.restore();
  }

  // Lấy base64 JPEG từ canvas
  async function canvasToBase64Jpeg(quality = 0.92) {
    await new Promise((r) => requestAnimationFrame(r));
    // Dùng toBlob -> ArrayBuffer -> base64 để tương thích rộng
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob) return null;
    const arr = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  // ================= GPS (một lần) =================
  async function getGPSOnce(timeoutMs = 8000) {
    if (!("geolocation" in navigator)) return null;
    try {
      const pos = await new Promise((res, rej) => {
        navigator.geolocation.getCurrentPosition(res, rej, {
          enableHighAccuracy: true,
          timeout: timeoutMs,
          maximumAge: 0,
        });
      });
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        acc: pos.coords.accuracy,
      };
    } catch {
      return null;
    }
  }

  // ================= GỬI ẢNH (JSON Webhook) =================
  async function sendPhoto(withGPS) {
    // Ẩn sheet chọn phương thức nếu có
    if (sheet) sheet.classList.remove("show");

    showToast("Đang tạo ảnh…", "info", 1200);
    drawFrameToCanvas();
    const image_b64 = await canvasToBase64Jpeg(0.92);
    if (!image_b64) {
      showToast("Không tạo được ảnh.", "err", 2400);
      return;
    }

    let gps = null;
  if (withGPS && gps) {
    showToast("✅ Đã gửi & đính kèm vị trí", "ok", 1100);
    setTimeout(closeApp, 900);
  }


    const { ma_kh, ma_hd } = getQP();
    const payload = {
      action: "giaohangthanhcong",
      ma_kh,
      ma_hd,
      image_mime: "image/jpeg",
      image_b64,
      ...(gps ? { lat: gps.lat, lng: gps.lng, acc: gps.acc } : {}),
    };

    try {
      showToast("Đang gửi…", "info", 1200);
      const res = await fetch(getUploadUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        showToast(`Gửi thất bại: HTTP ${res.status}`, "err", 3200);
        return;
      }

      if (withGPS && gps) {
        showToast("✅ Đã gửi & đính kèm vị trí", "ok", 1100);
        setTimeout(closeApp, 900);
      } else {
        showToast("✅ Đã gửi ảnh", "ok", 1500);
      }


      // Nếu đang nhúng trong iframe overlay: báo về parent
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: "checkin:done", ma_kh, ma_hd }, "*");
        }
      } catch {}
    } catch (err) {
      console.error(err);
      showToast("Lỗi mạng khi gửi", "err", 3000);
    }
  }

  // ================= SỰ KIỆN =================
  btnStart?.addEventListener("click", startCamera);

  btnShot?.addEventListener("click", async () => {
    if (!stream) {
      showToast("Chưa bật camera", "err", 1800);
      return;
    }
    if (soundOn) {
      try {
        await snapAud.play();
      } catch {}
    }
    // Hiện bottom sheet (nếu có) hoặc gửi luôn tùy UI của bạn
    if (sheet) {
      sheet.classList.add("show");
    } else {
      // nếu không có sheet chọn chế độ, mặc định hỏi kèm GPS
      const useGPS = confirm("Gửi kèm vị trí?");
      sendPhoto(useGPS);
    }
  });

  btnSound?.addEventListener("click", () => {
    soundOn = !soundOn;
    btnSound.textContent = soundOn ? "🔊" : "🔈";
    showToast(soundOn ? "Đã bật tiếng chụp" : "Đã tắt tiếng chụp", "info", 1200);
  });

  btnSendWithGPS?.addEventListener("click", () => sendPhoto(true));
  btnSendNoGPS?.addEventListener("click", () => sendPhoto(false));

  // Dọn camera khi rời trang
  window.addEventListener("beforeunload", stopCamera);

  // Nếu người dùng đã cấp quyền từ trước, bạn có thể auto-bật tại đây (đang để thủ công để tránh khó chịu)
  // startCamera();
})();
