const https = require('https');
const fs = require('fs');
const path = require('path');

function requestFollow(url, options = {}, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'OS-Media-App', ...options.headers } },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('Demasiadas redirecciones'));
          return resolve(requestFollow(res.headers.location, options, redirectsLeft - 1));
        }
        resolve(res);
      }
    );
    req.on('error', reject);
  });
}

async function fetchJson(url) {
  const res = await requestFollow(url);
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`HTTP ${res.statusCode} al consultar ${url}`);
  }
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function downloadToFile(url, destPath, onProgress) {
  const res = await requestFollow(url);
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`HTTP ${res.statusCode} al descargar ${url}`);
  }
  const total = parseInt(res.headers['content-length'] || '0', 10);
  let received = 0;

  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const tmpPath = `${destPath}.download`;
  const fileStream = fs.createWriteStream(tmpPath);

  await new Promise((resolve, reject) => {
    res.on('data', (chunk) => {
      received += chunk.length;
      if (onProgress && total) onProgress(received / total);
    });
    res.on('error', reject);
    fileStream.on('error', reject);
    fileStream.on('finish', resolve);
    res.pipe(fileStream);
  });

  await fs.promises.rename(tmpPath, destPath);
}

module.exports = { requestFollow, fetchJson, downloadToFile };
