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
      const { source, settings } = req.body || {};

      if (!source || typeof source !== 'string') {
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

      const obfText = await obfResponse.text();

      let obfData;

      try {
        obfData = JSON.parse(obfText);
      } catch {
        throw new Error(
          `Obfuscator returned invalid response: ${obfText.substring(0, 300)}`
        );
      }

      if (!obfResponse.ok) {
        throw new Error(
          obfData.message ||
          obfData.error ||
          'Obfuscator request failed'
        );
      }

      if (obfData.status !== 'success' || !obfData.result) {
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
        id = generateRandomID(12);

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

        console.error(
          'SUPABASE SAVE ERROR:',
          lastError
        );
      }

      if (!saved) {
        throw new Error(
          `Failed to save to Supabase: ${lastError}`
        );
      }

      const baseUrl =
        process.env.API_BASE_URL ||
        `https://${req.headers.host}`;

      const rawUrl =
        `${baseUrl}/api/obfuscate?id=${encodeURIComponent(id)}`;

      const loadstring =
        `loadstring(game:HttpGet("${rawUrl}"))()`;

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
      const { id, source } = req.query;

      if (!id) {
        return res.status(400).send(
          "warn('Missing Project ID')"
        );
      }

      const safeId = encodeURIComponent(id);

      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/${TABLE_NAME}?id=eq.${safeId}&select=code,source`,
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

      let rows;

      try {
        rows = JSON.parse(responseText);
      } catch {
        throw new Error('Invalid response from Supabase');
      }

      const data = rows[0];

      if (!data) {
        res.setHeader(
          'Content-Type',
          'text/plain; charset=utf-8'
        );

        return res.status(404).send(
          "warn('Script not found or removed')"
        );
      }

      res.setHeader(
        'Content-Type',
        'text/plain; charset=utf-8'
      );

      if (source === 'true') {
        if (!data.source) {
          return res.status(404).send(
            "warn('Source code not found')"
          );
        }

        return res.status(200).send(data.source);
      }

      if (!data.code) {
        return res.status(404).send(
          "warn('Obfuscated code not found')"
        );
      }

      return res.status(200).send(data.code);

    } catch (error) {
      console.error('GET API ERROR:', error);

      res.setHeader(
        'Content-Type',
        'text/plain; charset=utf-8'
      );

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
