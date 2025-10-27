/* ========= CẤU HÌNH ========= */
const WEBHOOK_URL = "https://dhsybbqoe.datadex.vn/webhook/hoadon";
const TARGET_W = 900, TARGET_H = 1600;

/* ========= LẤY THAM SỐ ========= */
const q = new URLSearchParams(location.search);
const ma_kh = (q.get('ma_kh') || '').trim();
const ma_hd = (q.get('ma_hd') || '').trim();

/* ========= LẤY NHÂN VIÊN ========= */
// ✅ Đặt sau khi đã khai báo q
function getNV() {
  const _ma = (typeof ma_nv !== 'undefined' && ma_nv) ? ma_nv : null;
  const _ten = (typeof ten_nv !== 'undefined' && ten_nv) ? ten_nv : null;
  const ma = _ma || (q.get('ma_nv') || localStorage.getItem('ma_nv') || '').trim();
  const ten = _ten || (q.get('ten_nv') || localStorage.getItem('ten_nv') || '').trim();
  return { ma_nv: ma || '', ten_nv: ten || '' };
}


/* ========= DOM ========= */
const video=document.getElementById('video');
const canvas=document.getElementById('canvas');
const btnStart=document.getElementById('btnStart');
const btnShot=document.getElementById('btnShot');
const btnSound=document.getElementById('btnSound');
const toastEl=document.getElementById('toast');
const snapAudio=document.getElementById('snapSound');
const sheet=document.getElementById('sheet');
const btnSendWithGPS=document.getElementById('btnSendWithGPS');
const btnSendNoGPS=document.getElementById('btnSendNoGPS');
let stream=null;

/* ========= Toast ========= */
function toast(t,type='info',ms=2400){
  toastEl.textContent=t;
  toastEl.style.opacity='1';
  toastEl.style.transform='translate(-50%,10px)';
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>{
    toastEl.style.opacity='0';
    toastEl.style.transform='translate(-50%,-120%)';
  },ms);
}

/* ========= Bottom Sheet ========= */
function openSheet(){ sheet.classList.add('on'); }
function closeSheet(){ sheet.classList.remove('on'); }

/* ========= Âm thanh ========= */
let audioCtx = null, compressor = null;
const SHUTTER_GAIN = 0.9;
let soundEnabled = (localStorage.getItem('checkin_sound') ?? '1') === '1';

function renderSoundBtn(){
  if(soundEnabled){
    btnSound.classList.add('btn-on'); btnSound.textContent='🔊'; btnSound.title='Đang bật tiếng (bấm để tắt)';
  }else{
    btnSound.classList.remove('btn-on'); btnSound.textContent='🔇'; btnSound.title='Đang tắt tiếng (bấm để bật)';
  }
}
renderSoundBtn();

btnSound.onclick=()=>{
  soundEnabled=!soundEnabled;
  localStorage.setItem('checkin_sound', soundEnabled?'1':'0');
  renderSoundBtn();
  toast(soundEnabled?'Đã bật tiếng chụp':'Đã tắt tiếng chụp');
};

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
  if(audioCtx.state==='suspended') return audioCtx.resume();
  return Promise.resolve();
}

function noiseBurst(ctx,t0,dur=0.03){
  const len=Math.floor(ctx.sampleRate*dur);
  const buf=ctx.createBuffer(1,len,ctx.sampleRate);
  const data=buf.getChannelData(0);
  for(let i=0;i<len;i++)data[i]=(Math.random()*2-1)*0.6;
  const src=ctx.createBufferSource();src.buffer=buf;
  const g=ctx.createGain();
  g.gain.setValueAtTime(0,t0);
  g.gain.linearRampToValueAtTime(SHUTTER_GAIN,t0+0.005);
  g.gain.exponentialRampToValueAtTime(0.0008,t0+dur);
  const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.setValueAtTime(4500,t0);
  src.connect(lp);lp.connect(g);g.connect(compressor);
  src.start(t0);src.stop(t0+dur+0.01);
}

async function playShutter(){
  if(!soundEnabled)return;
  try{await ensureAudioCtx();}catch{}
  const ctx=audioCtx,now=ctx.currentTime;
  noiseBurst(ctx,now,0.035);
  const osc1=ctx.createOscillator(),g1=ctx.createGain();
  osc1.type='square';osc1.frequency.setValueAtTime(1400,now);
  g1.gain.setValueAtTime(0,now);
  g1.gain.linearRampToValueAtTime(SHUTTER_GAIN,now+0.01);
  g1.gain.exponentialRampToValueAtTime(0.001,now+0.09);
  osc1.connect(g1);g1.connect(compressor);
  osc1.start(now);osc1.stop(now+0.1);
  const t2=now+0.06;
  const osc2=ctx.createOscillator(),g2=ctx.createGain();
  osc2.type='square';osc2.frequency.setValueAtTime(950,t2);
  g2.gain.setValueAtTime(0,t2);
  g2.gain.linearRampToValueAtTime(SHUTTER_GAIN*0.7,t2+0.012);
  g2.gain.exponentialRampToValueAtTime(0.001,t2+0.08);
  osc2.connect(g2);g2.connect(compressor);
  osc2.start(t2);osc2.stop(t2+0.09);
  if(navigator.vibrate)navigator.vibrate(30);
  try{snapAudio.currentTime=0;await snapAudio.play();}catch{}
}

/* ========= Camera ========= */
async function startCam(){
  try{
    if(stream)stream.getTracks().forEach(t=>t.stop());
    const base={video:{width:{ideal:1080},height:{ideal:1920},facingMode:{ideal:'environment'}},audio:false};
    stream=await navigator.mediaDevices.getUserMedia(base);
    video.srcObject=stream;
    await new Promise(r=>video.onloadedmetadata=r);
    btnShot.disabled=false;
    toast('Đã bật camera','ok');
  }catch(e){
    btnShot.disabled=true;
    toast('Lỗi camera: '+(e.message||e),'err',4200);
  }
}
function stopCam(){
  if(stream){try{stream.getTracks().forEach(t=>t.stop());}catch{}stream=null;video.srcObject=null;}
}
function drawToCanvas(){
  const fw=video.videoWidth,fh=video.videoHeight;if(!fw||!fh)return;
  const ar=fw/fh,desired=TARGET_W/TARGET_H;let sx=0,sy=0,sw=fw,sh=fh;
  if(ar>desired){sw=fh*desired;sx=(fw-sw)/2;}else{sh=fw/desired;sy=(fh-sh)/2;}
  canvas.width=TARGET_W;canvas.height=TARGET_H;
  canvas.getContext('2d').drawImage(video,sx,sy,sw,sh,0,0,TARGET_W,TARGET_H);
}

/* ========= GPS ========= */
function getGPSOnce(){return new Promise(r=>{
  if(!('geolocation'in navigator))return r(null);
  navigator.geolocation.getCurrentPosition(
    p=>r({lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy}),
    _=>r(null),
    {enableHighAccuracy:true,timeout:10000,maximumAge:0}
  );
});}

/* ========= POST FORM ========= */
function postForm(url,f){
  let form=document.getElementById('hiddenForm');
  if(!form){form=document.createElement('form');form.id='hiddenForm';form.method='POST';form.target='sink';form.style.display='none';document.body.appendChild(form);}
  form.action=url;form.innerHTML='';
  for(const[k,v]of Object.entries(f)){const i=document.createElement('input');i.type='hidden';i.name=k;i.value=(v==null?'':v);form.appendChild(i);}
  form.submit();
}

/* ========= GỬI PAYLOAD ========= */
let lastImageDataUrl = null, lastImageMime = 'image/jpeg';

async function sendPayload(includeGPS) {
  if (!lastImageDataUrl) {
    toast('Chưa có ảnh để gửi', 'err');
    return;
  }

  // ✅ Dùng trực tiếp ma_nv, ten_nv toàn cục (đã có sẵn ở toàn app)
  const payload = {
    action: 'giaohangthanhcong',
    ma_kh,
    ma_hd,
    ma_nv,
    ten_nv,
    image_mime: lastImageMime,
    image_b64: lastImageDataUrl.split(',')[1]
  };

  if (includeGPS) {
    const gps = await getGPSOnce();
    if (gps) {
      payload.gps_json = JSON.stringify(gps);
      payload.lat = gps.lat;
      payload.lng = gps.lng;
      payload.acc = gps.acc;
      payload.latlng = `${gps.lat},${gps.lng}`;
      toast('Đã đính kèm vị trí', 'ok');
    } else {
      toast('Không lấy được vị trí — vẫn gửi ảnh', 'info', 3000);
    }
  }

  postForm(WEBHOOK_URL, payload);
  closeSheet();
  if (navigator.vibrate) navigator.vibrate(30);
}




/* ========= Events ========= */
btnStart.onclick=startCam;
btnShot.onclick=async()=>{
  if(!stream){toast('Chưa bật camera','err');return;}
  await playShutter();
  drawToCanvas();
  lastImageMime='image/jpeg';
  lastImageDataUrl=canvas.toDataURL(lastImageMime,0.85);
  openSheet();
};
btnSendWithGPS.onclick=()=>sendPayload(true);
btnSendNoGPS.onclick=()=>sendPayload(false);

(async()=>{
  try{
    const camPerm=await navigator.permissions.query({name:'camera'});
    if(camPerm.state==='granted')await startCam();
  }catch(e){}
})();
addEventListener('visibilitychange',()=>{if(document.hidden)stopCam();});
