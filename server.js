const http = require('http');
const https = require('https');
const url = require('url');
const querystring = require('querystring');
const fs = require('fs');
const path = require('path');

// No Render, a porta é definida pela variável de ambiente PORT
const PORT = process.env.PORT || 3000;

// MIME types
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    if (postData) req.write(postData);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Proxy endpoint for PIX generation
  if (pathname === '/proxy/pix' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const params = JSON.parse(body);
        const postData = querystring.stringify({
          campaign_id: params.campaign_id,
          payer_name: params.payer_name,
          payer_email: params.payer_email || 'nao@informado.com',
          msg: '',
          amount: params.amount,
        });

        // Step 1: Submit to ajudaja to get the PIX URL
        const ajudajaResponse = await makeRequest({
          hostname: 'ajudaja.com.br',
          path: '/ajudar/ajax_payment_pix.php',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
            'Referer': `https://ajudaja.com.br/ajudar/?x=${params.campaign_id}`,
            'X-Requested-With': 'XMLHttpRequest',
            'User-Agent': 'Mozilla/5.0 (compatible)',
          },
        }, postData);

        let ajudajaData;
        try {
          ajudajaData = JSON.parse(ajudajaResponse.body);
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid response from ajudaja', raw: ajudajaResponse.body }));
          return;
        }

        if (ajudajaData.status !== 'ok') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'ajudaja returned error', data: ajudajaData }));
          return;
        }

        // Step 2: Fetch the PIX code page
        const pixPageUrl = `https://ajudaja.com.br/ajudar/${ajudajaData.url}`;
        const pixPageResponse = await makeRequest({
          hostname: 'ajudaja.com.br',
          path: `/ajudar/${ajudajaData.url}`,
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible)',
            'Referer': `https://ajudaja.com.br/ajudar/?x=${params.campaign_id}`,
          },
        });

        // Extract PIX code from the page
        const pixHtml = pixPageResponse.body;
        const match = pixHtml.match(/id="qr_code_text_[^"]*"\s+name="[^"]*"\s+value="([^"]+)"/);
        
        if (!match) {
          const match2 = pixHtml.match(/value="(0002[^"]+)"/);
          if (!match2) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Could not extract PIX code', url: pixPageUrl }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, pixCode: match2[1], pixUrl: pixPageUrl }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, pixCode: match[1], pixUrl: pixPageUrl }));

      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Serve static files
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);
  const contentType = mimeTypes[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        fs.readFile(path.join(__dirname, 'index.html'), (err2, data2) => {
          if (err2) {
            res.writeHead(404);
            res.end('Not found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data2);
          }
        });
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Checkout server running on port ${PORT}`);
});
