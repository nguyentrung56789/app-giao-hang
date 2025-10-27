
// web_dong_hang/api/getConfig.js
// Hoàn chỉnh: trả cả Supabase và Map cấu hình, có kiểm tra CORS
export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  // ==== 1. Đọc Supabase ENV ====


  // ==== 2. Đọc Map ENV ====
  const mapUrl  = process.env.link_map_apps_script || "";
  const mapSheet = process.env.sheet_id_map || "";

  // ==== 3. Kiểm tra hợp lệ ====
  if (!url || !anon) {
    return res.status(500).json({ error: "Thiếu Supabase ENV", url: !!url, anon: !!anon });
  }


  // ==== 4. Trả kết quả chung ====
  return res.status(200).json({
    url,
    anon,
   
  });
}

