function generateRandomID(length = 12) {
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
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({
      status: 'error',
      message: 'Supabase environment variables missing'
    });
  }

  const supabaseHeaders = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`
  };

  if (req.method === 'POST') {
    try {
      const { source, settings } = req.body || {};

      if (!source) {
        return res.status(400).json({
          status: 'error',
          message: 'Missing Lua source code'
        });
      }

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
              loaderVMDepth: 3
            }
          })
        }
      );

      const obfData = await obfResponse.json();

      if (obfData.status !== 'success' || !obfData.result) {
        return res.status(400).json({
          status: 'error',
          message: obfData.message || 'Obfuscation failed'
        });
      }

      let id;
      let saved = false;

      for (let attempt = 0; attempt < 5; attempt++) {
        id = generateRandomID(12);

        const dbResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/src`,
          {
            method: 'POST',
            headers: {
              ...supabaseHeaders,
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              id,
              code: obfData.result,
              source,
              created_at: Date.now()
            })
          }
        );

        if (dbResponse.ok) {
          saved = true;
          break;
        }
      }

      if (!saved) {
        throw new Error('Failed to save to Supabase');
      }

      const rawUrl =
        `https://api.lurvox-security.com/loader/script/${id}?source=true`;

      const loadstring =
        `loadstring(game:HttpGet("${rawUrl}"))()`;

      return res.status(200).json({
        status: 'success',
        id,
        rawUrl,
        loadstring
      });

    } catch (error) {
      console.error('API Error:', error);

      return res.status(500).json({
        status: 'error',
        message: error.message
      });
    }
  }

  if (req.method === 'GET') {
    const { id, source } = req.query;

    if (!id) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(400).send(
        "warn('Missing Project ID')"
      );
    }

    const userAgent = req.headers['user-agent'] || '';
    const isRoblox = userAgent.includes('Roblox');

    if (source === 'true' && !isRoblox) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      return res.status(403).send(`
<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Loadstring</title>

<style>
*{box-sizing:border-box;margin:0;padding:0}
body{
  min-height:100vh;
  background:#191b30;
  color:white;
  font-family:Arial,sans-serif;
  display:flex;
  justify-content:center;
  align-items:center
}
.container{width:82%;max-width:350px}
.title{
  display:flex;
  justify-content:center;
  align-items:center;
  gap:6px;
  margin-bottom:14px
}
.title .icon{font-size:19px}
.title h1{font-size:21px;font-weight:700}
.code-box{
  position:relative;
  width:100%;
  height:100px;
  background:#0d101f;
  border:1px solid #22263c;
  border-radius:13px;
  padding:17px 13px;
  overflow:hidden
}
.code-scroll{
  width:100%;
  height:100%;
  overflow-x:auto;
  overflow-y:hidden;
  scrollbar-width:none
}
.code-scroll::-webkit-scrollbar{display:none}
pre{
  width:max-content;
  white-space:pre;
  font-family:Consolas,Monaco,monospace;
  font-size:11px;
  line-height:1.75;
  color:#d7d9e3
}
.variable{color:#d7d9e3}
.function{color:#55a5dc}
.string{color:#c99a86}
.copy-btn{
  position:absolute;
  top:7px;
  right:7px;
  padding:6px 10px;
  border:none;
  border-radius:9px;
  background:#282d52;
  color:#eee;
  font-size:11px;
  cursor:pointer;
  z-index:10
}
.copy-btn:active{transform:scale(.95)}
.info{
  text-align:center;
  margin-top:11px;
  color:#dedee5;
  font-size:11px;
  line-height:1.5
}
</style>
</head>

<body>

<div class="container">
  <div class="title">
    <span class="icon">📜</span>
    <h1>Loadstring</h1>
  </div>

  <div class="code-box">
    <button class="copy-btn" id="copyButton" onclick="copyCode()">
      Copy
    </button>

    <div class="code-scroll">
      <pre id="code"></pre>
    </div>
  </div>

  <div class="info">
    This code is protected by lurvox •<br>
    https://lurvox-security.com
  </div>
</div>

<script>
const currentUrl = window.location.href;

document.getElementById("code").innerHTML =
\`<span class="variable">script_key</span> = <span class="string">"KEY"</span>;
<span class="function">loadstring</span>(game:<span class="function">HttpGet</span>(<span class="string">"\${currentUrl}"</span>))()\`;

function copyCode() {
  const text =
\`script_key = "KEY";
loadstring(game:HttpGet("\${currentUrl}"))()\`;

  navigator.clipboard.writeText(text);

  const button = document.getElementById("copyButton");
  button.innerText = "Copied!";

  setTimeout(() => {
    button.innerText = "Copy";
  }, 1200);
}
</script>

</body>
</html>
      `);
    }

    try {
      const safeId = encodeURIComponent(id);

      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/src?id=eq.${safeId}&select=code,source`,
        {
          headers: supabaseHeaders
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch from Supabase');
      }

      const rows = await response.json();
      const data = rows[0];

      if (!data) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(404).send(
          "warn('Script not found or removed')"
        );
      }

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');

      if (source === 'true' && isRoblox) {
        if (data.source) {
          return res.status(200).send(data.source);
        }

        return res.status(404).send(
          "warn('Source code not found')"
        );
      }

      if (data.code) {
        return res.status(200).send(data.code);
      }

      return res.status(404).send(
        "warn('parameter missing')"
      );

    } catch (error) {
      console.error(error);

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');

      return res.status(500).send(
        "warn('Internal server error')"
      );
    }
  }

  return res.status(405).json({
    message: 'Method Not Allowed'
  });
  }
