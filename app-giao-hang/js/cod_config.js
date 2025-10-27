// cod_config.js

// 1) Khai báo CƠ SỞ dùng chung (cùng URL + KEY)
window.COD_BASE = {
"url": "https://cywtgdtsxajczljspwxe.supabase.co",
  "key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5d3RnZHRzeGFqY3psanNwd3hlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MzI1NjQsImV4cCI6MjA3MjMwODU2NH0.FZ6z6kfUWyf8l7WnA5J1wkrAy7KjpU6VT65EdyXCka8",
};

// 2) Khai báo theo app — CHỈ KHÁC table
window.COD_CONFIGS = {
  index: { table: "kv_nhan_vien" },   // index.html (login/menu)
  cod:   { table: "don_hang_kiot_cod" },   // Quan_ly_COD.html
  check: { table: "don_hang" }        // don_hang.html
};

// 3) Helper: lấy config cuối cùng cho 1 app
window.getConfig = (name) => {
  const base = window.COD_BASE || {};
  const per  = (window.COD_CONFIGS || {})[name] || {};
  return { ...base, ...per }; // trộn: {url, key, table}
};
