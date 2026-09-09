function generateRandomID(length = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  // POST: รับ Source Code -> ใส่ Loader Protection -> Obfuscate -> เซฟลง Supabase
  // ==========================================
  if (req.method === 'POST') {
    try {
      await delay(1000);

      const { source, settings } = req.body || {};  

      if (!source || typeof source !== 'string') {  
        return res.status(400).json({  
          status: 'error',  
          message: 'Missing Lua source code'  
        });  
      }  

      // รวม Protection Loader เข้ากับ User Source Code
      const combinedSource = `
local Protection = {}

local Original = {
    type = type,
    tostring = tostring,
    tonumber = tonumber,
    pcall = pcall,
    xpcall = xpcall,
    pairs = pairs,
    ipairs = ipairs,
    next = next,
    rawget = rawget,
    rawset = rawset,
    rawequal = rawequal,

    string_char = string.char,
    string_byte = string.byte,
    string_sub = string.sub,
    string_find = string.find,

    table_concat = table.concat,
    table_insert = table.insert,

    math_random = math.random,
}

local function Fail(reason)
    warn("[Protection] Failed:", reason or "Unknown")
    while true do
        task.wait(9e9)
    end
end

local function RuntimeCheck()
    return type(string) == "table"
        and type(table) == "table"
        and type(math) == "table"
        and game ~= nil
end

local function EnvironmentCheck()
    if not game then return false end
    if type(game.GetService) ~= "function" then return false end

    local success, players = pcall(function()
        return game:GetService("Players")
    end)

    return success and players ~= nil
end

local function AntiHook()
    local checks = {
        type == Original.type,
        tostring == Original.tostring,
        tonumber == Original.tonumber,
        pcall == Original.pcall,
        xpcall == Original.xpcall,
        pairs == Original.pairs,
        ipairs == Original.ipairs,
        next == Original.next,
        rawget == Original.rawget,
        rawset == Original.rawset,
        rawequal == Original.rawequal,

        string.char == Original.string_char,
        string.byte == Original.string_byte,
        string.sub == Original.string_sub,
        string.find == Original.string_find,

        table.concat == Original.table_concat,
        table.insert == Original.table_insert,

        math.random == Original.math_random,
    }

    for _, valid in ipairs(checks) do
        if not valid then
            return false
        end
    end

    return true
end

function Protection.Validate()
    if not RuntimeCheck() then
        return false, "RuntimeCheck"
    end
    if not EnvironmentCheck() then
        return false, "EnvironmentCheck"
    end
    if not AntiHook() then
        return false, "AntiHook"
    end

    return true
end

function Protection.StartMonitor()
    task.spawn(function()
        while true do
            task.wait(math.random(4, 8))

            local success, result, reason = pcall(function()
                return Protection.Validate()
            end)

            if not success or not result then
                Fail(reason or "Monitor failed")
                return
            end
        end
    end)
end

-- ตรวจสอบครั้งแรก
local ok, result, reason = pcall(function()
    return Protection.Validate()
end)

if not ok or not result then
    Fail(reason or "Initial validation failed")
end

Protection.StartMonitor()

-- ==========================================
-- USER SOURCE CODE GOES HERE
-- ==========================================
${source}

return Protection
`;

      const obfResponse = await fetch('https://goofyscator.lua.cz/obfuscate', {  
        method: 'POST',  
        headers: { 'Content-Type': 'application/json' },  
        body: JSON.stringify({  
          source: combinedSource,  
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
      });  

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

      for (let attempt = 0; attempt < 5; attempt++) {  
        id = generateRandomID(32);  

        const dbResponse = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE_NAME}`, {  
          method: 'POST',  
          headers: {  
            ...supabaseHeaders,  
            Prefer: 'return=representation'  
          },  
          body: JSON.stringify({  
            id,  
            code: obfData.result,  
            source,  
            created_at: Date.now()  
          })  
        });  

        const responseText = await dbResponse.text();  

        if (dbResponse.ok) {  
          saved = true;  
          break;  
        }  

        lastError = `HTTP ${dbResponse.status}: ${responseText}`;  
        await delay(500);  
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
  // GET: ตรวจสอบ User-Agent & แสดงผล HTML
  // ==========================================
  if (req.method === 'GET') {
    try {
      const id = req.query.id || req.query.scriptId;

      if (!id) {  
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');  
        return res.status(400).send("warn('Missing Script ID')");  
      }  

      const safeId = encodeURIComponent(id);  

      const response = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE_NAME}?id=eq.${safeId}&select=code`, {  
        method: 'GET',  
        headers: supabaseHeaders  
      });  

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

      const userAgent = (req.headers['user-agent'] || '').toLowerCase();  
      const isRobloxExecutor = userAgent.includes('roblox') || userAgent.includes('synapse') || userAgent.includes('krnl') || userAgent.includes('fluxus') || userAgent.includes('scriptware') || userAgent.includes('httpget');  

      // 1. เรียกจาก Executor -> ส่ง Plain Text Code
      if (isRobloxExecutor) {  
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');  
        return res.status(200).send(data.code);  
      }  

      // 2. เปิดผ่าน Browser -> ส่งหน้า UI HTML ใหม่
      const htmlContent = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Loadstring</title>
<style>
* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

body {
    min-height: 100vh;
    background: #191b30;
    color: white;
    font-family: Arial, sans-serif;
    display: flex;
    justify-content: center;
    align-items: center;
}

.container {
    width: 82%;
    max-width: 350px;
}

.title {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 6px;
    margin-bottom: 14px;
}

.title .icon {
    font-size: 19px;
}

.title h1 {
    font-size: 21px;
    font-weight: 700;
}

.code-box {
    position: relative;
    width: 100%;
    height: 100px;
    background: #0d101f;
    border: 1px solid #22263c;
    border-radius: 13px;
    padding: 17px 13px;
    overflow: hidden;
}

.code-scroll {
    width: 100%;
    height: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
}

.code-scroll::-webkit-scrollbar {
    display: none;
}

pre {
    width: max-content;
    white-space: pre;
    font-family: Consolas, Monaco, monospace;
    font-size: 11px;
    line-height: 1.75;
    color: #d7d9e3;
}

.variable { color: #d7d9e3; }
.function { color: #55a5dc; }
.string { color: #c99a86; }
.comment { color: #70a85b; }

.copy-btn {
    position: absolute;
    top: 7px;
    right: 7px;
    padding: 6px 10px;
    border: none;
    border-radius: 99px;
    background: #282d52;
    color: #eee;
    font-size: 11px;
    cursor: pointer;
    z-index: 10;
}

.copy-btn:active {
    transform: scale(.95);
}

.info {
    text-align: center;
    margin-top: 11px;
    color: #dedee5;
    font-size: 11px;
    line-height: 1.5;
}

.info-url {
    color: #dedee5;
}

@media(max-width:600px) {
    .container {
        width: 80%;
        max-width: 340px;
    }
    .title h1 {
        font-size: 20px;
    }
    .title .icon {
        font-size: 18px;
    }
    .code-box {
        height: 98px;
    }
    pre {
        font-size: 11px;
    }
    .info {
        font-size: 11px;
    }
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
        <button class="copy-btn" id="copyButton" onclick="copyCode()">Copy</button>
        <div class="code-scroll">
            <pre id="code"></pre>
        </div>
    </div>

    <div class="info">
        This code is protected by lurvox •<br>
        <span class="info-url">https://lurvox-security.vercel.app</span>
    </div>

</div>

<script>
const currentUrl = window.location.href;

const codeHTML =
'<span class="variable">-- // Lurvox_Security_Service</span><span class="string"></span>\\n' +
'<span class="function">loadstring</span>(game:<span class="function">HttpGet</span>(<span class="string">"' + currentUrl + '"</span>))()';

document.getElementById("code").innerHTML = codeHTML;

function copyCode() {
    const text = '-- // Lurvox_Security_Service\\nloadstring(game:HttpGet("' + currentUrl + '"))()';

    navigator.clipboard.writeText(text);

    const button = document.getElementById("copyButton");
    button.innerText = "Copied!";

    setTimeout(() => {
        button.innerText = "Copy";
    }, 1200);
}
</script>

</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');  
      return res.status(200).send(htmlContent);  

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
