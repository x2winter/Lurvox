function generateRandomID(length = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';

  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
  const TABLE_NAME = 'lurvox_api';

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({
      status: 'error',
      message: 'Supabase environment variables missing'
    });
  }

  const supabaseHeaders = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`
  };

  // ==========================================
  // POST: รับ Source Code -> Obfuscate -> เซฟลง Supabase
  // ==========================================
  if (req.method === 'POST') {
    try {
      const { source, settings } = req.body || {};

      if (!source || typeof source !== 'string') {
        return res.status(400).json({
          status: 'error',
          message: 'Missing Lua source code'
        });
      }

      // ส่ง Source Code ต้นฉบับไป Obfuscate
      const obfResponse = await fetch(
        'https://goofyscator.lua.cz/obfuscate',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            source,
            settings: settings || {
              encryptStrings: true,
              proxifyLocals: true,
              proxifyFunctions: true,
              antiTamper: true,
              controlFlowFlattening: true,
              isLuauRuntime: true,
              loaderVMDepth: 0
            }
          })
        }
      );

      const obfText = await obfResponse.text();
      let obfData;

      try {
        obfData = JSON.parse(obfText);
      } catch {
        throw new Error(`Obfuscator returned invalid response: ${obfText.substring(0, 300)}`);
      }

      if (!obfResponse.ok || obfData.status !== 'success' || !obfData.result) {
        throw new Error(obfData.message || obfData.error || 'Obfuscation failed');
      }

      let id;
      let saved = false;
      let lastError = '';

      // สุ่ม ID ความยาว 32 ตัวอักษร
      for (let attempt = 0; attempt < 5; attempt++) {
        id = generateRandomID(32);

        const dbResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/${TABLE_NAME}`,
          {
            method: 'POST',
            headers: {
              ...supabaseHeaders,
              Prefer: 'return=representation'
            },
            body: JSON.stringify({
              id,
              code: obfData.result,
              source, // เก็บต้นฉบับไว้ใน Database เท่านั้น
              created_at: Date.now()
            })
          }
        );

        const responseText = await dbResponse.text();

        if (dbResponse.ok) {
          saved = true;
          break;
        }

        lastError = `HTTP ${dbResponse.status}: ${responseText}`;
      }

      if (!saved) {
        throw new Error(`Failed to save to Supabase: ${lastError}`);
      }

      const baseUrl = `https://${req.headers.host}`;
      const rawUrl = `${baseUrl}/loader/script/${id}`;
      const loadstring = `loadstring(game:HttpGet("${rawUrl}"))()`;

      return res.status(200).json({
        status: 'success',
        id,
        rawUrl,
        loadstring
      });

    } catch (error) {
      console.error('POST API ERROR:', error);
      return res.status(500).json({
        status: 'error',
        message: error.message || 'Internal server error'
      });
    }
  }

  // ==========================================
  // GET: ดึงเฉพาะ Obfuscated Code (ปิดช่องโหว่ source=true)
  // ==========================================
  if (req.method === 'GET') {
    try {
      const id = req.query.id || req.query.scriptId;

      if (!id) {
        return res.status(400).send("warn('Missing Project ID')");
      }

      const safeId = encodeURIComponent(id);

      // ดึงเฉพาะคอลัมน์ code ออกมาจาก Database เท่านั้น
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/${TABLE_NAME}?id=eq.${safeId}&select=code`,
        {
          method: 'GET',
          headers: supabaseHeaders
        }
      );

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(`Supabase HTTP ${response.status}: ${responseText}`);
      }

      let rows = JSON.parse(responseText);
      const data = rows[0];

      if (!data || !data.code) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(404).send("warn('Script not found or removed')");
      }

      // ส่งคืนเฉพาะโค้ดที่ Obfuscate แล้วเสมอ
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(data.code);

    } catch (error) {
      console.error('GET API ERROR:', error);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(500).send("warn('Internal server error')");
    }
  }

  return res.status(405).json({
    status: 'error',
    message: 'Method Not Allowed'
  });
}
