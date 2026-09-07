import { randomBytes } from 'node:crypto';

function generateRandomID(length = 32) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(length);
  let result = '';

  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }

  return result;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function escapeLuaString(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function generateLuaKey(length = 16) {
  return generateRandomID(length);
}

function xorEncrypt(text, key) {
  const textBuffer = Buffer.from(String(text), 'utf8');
  const keyBuffer = Buffer.from(String(key), 'utf8');
  const result = Buffer.alloc(textBuffer.length);

  for (let i = 0; i < textBuffer.length; i++) {
    result[i] = textBuffer[i] ^ keyBuffer[i % keyBuffer.length];
  }

  return result.toString('base64');
}

function randomLuaName(prefix = 'v') {
  return `\( {prefix}_ \){generateRandomID(10)}`;
}

function generateLuaWrapper(source) {
  const key = generateLuaKey(16);
  const encryptedSource = xorEncrypt(source, key);

  const envName = randomLuaName('env');
  const keyName = randomLuaName('key');
  const dataName = randomLuaName('data');
  const decryptName = randomLuaName('decrypt');
  const fakeA = randomLuaName('helper');
  const fakeB = randomLuaName('alias');
  const runtimeCheck = randomLuaName('check');
  const dynamicExecutor = randomLuaName('exec');
  const payloadName = randomLuaName('payload');
  const sourceName = randomLuaName('source');
  const loaderName = randomLuaName('loader');

  return `local ${envName} = {}

local \( {keyName} = " \){escapeLuaString(key)}"
local \( {dataName} = " \){encryptedSource}"

local _char = string.char
local _byte = string.byte
local _concat = table.concat
local _bxor = (bit32 or bit).bxor

local function ${fakeA}(value)
if 0 == 1 then
return nil
end

return value

end

local function ${fakeB}(value)
return value
end

local function ${decryptName}(encoded, xorKey)
local httpService = game:GetService("HttpService")
local raw = httpService:Base64Decode(encoded)
local result = {}

for index = 1, #raw do
    if 4 == 0 then
        while true do end
    end

    local dataByte = _byte(raw, index)
    local keyByte = _byte(xorKey, ((index - 1) % #xorKey) + 1)

    result[index] = _char(_bxor(dataByte, keyByte))
end

return _concat(result)

end

local function ${runtimeCheck}()
local stringAlias = string
local charAlias = stringAlias.char

if charAlias == nil then
    return false
end

if false then
    while true do end
end

return true

end

local function ${dynamicExecutor}(sourceCode)
local ${loaderName} = loadstring

if type(${loaderName}) \~= "function" then
    return nil
end

return ${loaderName}(sourceCode)

end

if 1 == 1 then
local runtimeIdentifier = math.random(100000, 999999999)

if runtimeIdentifier < 0 then
    while true do end
end

end

if ${runtimeCheck}() then
local ${payloadName} = \( {fakeB}( \){dataName})
local runtimeKey = \( {fakeA}( \){keyName})

local ${sourceName} = ${decryptName}(
    ${payloadName},
    runtimeKey
)

local executor = \( {dynamicExecutor}( \){sourceName})

if executor then
    return executor()
end

end
`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

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

      if (source.length > 1024 * 1024) {
        return res.status(413).json({
          status: 'error',
          message: 'Source code too large'
        });
      }

      const protectedSource = generateLuaWrapper(source);

      const obfResponse = await fetch(
        'https://goofyscator.lua.cz/obfuscate',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            source: protectedSource,
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
        throw new Error(
          `Obfuscator returned invalid response: ${obfText.substring(0, 300)}`
        );
      }

      if (!obfResponse.ok || obfData.status !== 'success' || !obfData.result) {
        throw new Error(
          obfData.message ||
          obfData.error ||
          'Obfuscation failed'
        );
      }

      let id;
      let saved = false;
      let lastError = '';

      for (let attempt = 0; attempt < 5; attempt++) {
        id = generateRandomID(32);

        const dbResponse = await fetch(
          `\( {SUPABASE_URL}/rest/v1/ \){TABLE_NAME}`,
          {
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
          }
        );

        const responseText = await dbResponse.text();

        if (dbResponse.ok) {
          saved = true;
          break;
        }

        lastError = `HTTP ${dbResponse.status}: ${responseText}`;
        await delay(500 * Math.pow(2, attempt));
      }

      if (!saved) {
        throw new Error(
          `Failed to save to Supabase: ${lastError}`
        );
      }

      const baseUrl = `https://${req.headers.host}`;
      const rawUrl = `\( {baseUrl}/loader/script/ \){id}`;
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

  if (req.method === 'GET') {
    try {
      const id = req.query.id || req.query.scriptId;

      if (
        !id ||
        typeof id !== 'string' ||
        !/^[a-zA-Z0-9]{32}$/.test(id)
      ) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(400).send(
          "warn('Invalid or missing Script ID')"
        );
      }

      const safeId = encodeURIComponent(id);

      const response = await fetch(
        `\( {SUPABASE_URL}/rest/v1/ \){TABLE_NAME}?id=eq.${safeId}&select=code`,
        {
          method: 'GET',
          headers: supabaseHeaders
        }
      );

      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          `Supabase HTTP ${response.status}: ${responseText}`
        );
      }

      const rows = JSON.parse(responseText);
      const data = rows[0];

      if (!data || !data.code) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(404).send(
          "warn('Script not found or removed')"
        );
      }

      const userAgent = (
        req.headers['user-agent'] || ''
      ).toLowerCase();

      const isRobloxExecutor =
        userAgent.includes('roblox') ||
        userAgent.includes('synapse') ||
        userAgent.includes('krnl') ||
        userAgent.includes('fluxus') ||
        userAgent.includes('scriptware') ||
        userAgent.includes('httpget');

      if (isRobloxExecutor) {
        res.setHeader(
          'Content-Type',
          'text/plain; charset=utf-8'
        );
        return res.status(200).send(data.code);
      }

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

.variable {
  color: #d7d9e3;
}

.function {
  color: #55a5dc;
}

.string {
  color: #c99a86;
}

.copy-btn {
  position: absolute;
  top: 7px;
  right: 7px;
  padding: 6px 10px;
  border: none;
  border-radius: 9px;
  background: #282d52;
  color: #eee;
  font-size: 11px;
  cursor: pointer;
  z-index: 10;
}

.copy-btn:disabled {
  opacity: .6;
  cursor: not-allowed;
}

.info {
  text-align: center;
  margin-top: 11px;
  color: #dedee5;
  font-size: 11px;
  line-height: 1.5;
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
    https://lurvox-security.vercel.app
  </div>
</div>
<script>
const currentUrl = window.location.href;

document.getElementById("code").innerHTML =
\`<span class="variable">-- // Lurvox_Security_Service</span>
<span class="function">loadstring</span>(game:<span class="function">HttpGet</span>(<span class="string">"\${currentUrl}"</span>))()\`;

let isCooldown = false;

function copyCode() {
  if (isCooldown) return;

  const text =
\`-- // Lurvox_Security_Service
loadstring(game:HttpGet("\${currentUrl}"))()\`;

  navigator.clipboard.writeText(text);

  const button = document.getElementById("copyButton");

  isCooldown = true;
  button.disabled = true;

  let timeLeft = 4;
  button.innerText = \`Wait \${timeLeft}s\`;

  const timer = setInterval(() => {
    timeLeft--;

    if (timeLeft > 0) {
      button.innerText = \`Wait \${timeLeft}s\`;
    } else {
      clearInterval(timer);
      isCooldown = false;
      button.disabled = false;
      button.innerText = "Copy";
    }
  }, 1000);
}
</script>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(htmlContent);

    } catch (error) {
      console.error('GET API ERROR:', error);

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(500).send(
        "warn('Internal server error')"
      );
    }
  }

  return res.status(405).json({
    status: 'error',
    message: 'Method Not Allowed'
  });
}
