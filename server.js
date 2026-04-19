const express = require('express');
const https = require('https');
const axios = require('axios');
const cheerio = require('cheerio');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');

// Carrega variáveis de ambiente
try {
  require('dotenv').config();
} catch (e) {
  console.log('Aviso: dotenv não carregado.');
}

const app = express();
const PORT = process.env.PORT || 3000;
const CAMPAIGN_ID = process.env.CAMPAIGN_ID || '133622';

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const axiosInstance = axios.create({
  baseURL: 'https://ajudaja.com.br',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Origin': 'https://ajudaja.com.br',
    'X-Requested-With': 'XMLHttpRequest',
  },
  withCredentials: true,
});

axiosInstance.interceptors.response.use(response => {
  const setCookieHeader = response.headers['set-cookie'];
  if (setCookieHeader) {
    const cookies = setCookieHeader.map(cookie => cookie.split(';')[0]).join('; ');
    response.config.headers['Cookie'] = cookies;
  }
  return response;
}, error => Promise.reject(error));

/**
 * Gera um Gmail com alta variabilidade de formato e nome abreviado
 */
function generateHighlyVariableGmailFromCpf(cpf) {
  const firstNames = ['gabriel', 'lucas', 'mateus', 'felipe', 'rafael', 'bruno', 'thiago', 'vinicius', 'rodrigo', 'andre', 'julia', 'fernanda', 'beatriz', 'larissa', 'camila', 'amanda', 'leticia', 'mariana', 'carolina', 'isabela'];
  const lastNames = ['silva', 'santos', 'oliveira', 'souza', 'rodrigues', 'ferreira', 'alves', 'pereira', 'lima', 'gomes', 'costa', 'ribeiro', 'martins', 'carvalho', 'almeida', 'lopes', 'soares', 'fernandes', 'vieira', 'barbosa'];

  const cleanCpf = (cpf || Math.random().toString()).replace(/\D/g, '');
  
  // Usamos um valor aleatório para a transação atual para garantir que o formato mude sempre
  const transId = Math.floor(Math.random() * 1000);
  const seed = (parseInt(cleanCpf.substring(0, 8)) || 0) + transId;
  
  const firstName = firstNames[seed % firstNames.length].substring(0, 2);
  const lastName = lastNames[(seed >> 2) % lastNames.length];
  const suffixCpf = cleanCpf.substring(8, 11);
  const randomNum = Math.floor(Math.random() * 900 + 100); // 100-999
  const shortNum = Math.floor(Math.random() * 90 + 10); // 10-99

  // Lista expandida de formatos para evitar padrão repetitivo
  const formats = [
    `${firstName}.${lastName}${randomNum}`,
    `${lastName}${firstName}${suffixCpf}`,
    `${firstName}_${lastName}${shortNum}`,
    `${lastName}.${firstName}${randomNum}`,
    `${firstName}${lastName}${suffixCpf}${shortNum}`,
    `${lastName}_${firstName}${randomNum}`,
    `${firstName}${randomNum}${lastName}`,
    `${lastName}${shortNum}${firstName}`,
    `${firstName}.${lastName}.${suffixCpf}`,
    `${lastName}_${firstName}_${shortNum}`
  ];
  
  const selectedFormat = formats[seed % formats.length];
  return `${selectedFormat}@gmail.com`.toLowerCase();
}

app.post('/proxy/pix', async (req, res, next) => {
  try {
    console.log('--- Nova requisição PIX recebida ---');
    const { payer_name, payer_email, amount, payer_cpf } = req.body;

    if (!payer_name || !amount) {
      return res.status(400).json({ error: 'Nome e valor são obrigatórios.' });
    }

    const finalEmail = (!payer_email || payer_email === 'nao@informado.com') 
      ? generateHighlyVariableGmailFromCpf(payer_cpf)
      : payer_email;

    console.log('CPF:', payer_cpf, '| Email Gerado:', finalEmail);

    const postData = new URLSearchParams({
      campaign_id: CAMPAIGN_ID,
      payer_name: payer_name,
      payer_email: finalEmail,
      msg: '',
      amount: amount,
    }).toString();

    const ajudajaResponse = await axiosInstance.post('/ajudar/ajax_payment_pix.php', postData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': `https://ajudaja.com.br/ajudar/?x=${CAMPAIGN_ID}`,
      },
      timeout: 30000,
    });

    if (ajudajaResponse.status !== 200) {
      return res.status(502).json({ error: 'Erro no provedor', details: ajudajaResponse.data });
    }

    const ajudajaData = ajudajaResponse.data;
    if (ajudajaData.status !== 'ok' || !ajudajaData.url) {
      return res.status(400).json({ error: 'Provedor recusou PIX', details: ajudajaData });
    }

    const pixPageResponse = await axiosInstance.get(`/ajudar/${ajudajaData.url}`, {
      headers: { 'Referer': `https://ajudaja.com.br/ajudar/?x=${CAMPAIGN_ID}` },
      timeout: 30000,
    });

    const $ = cheerio.load(pixPageResponse.data);
    const pixCode = $('input[id^="qr_code_text_"]').val() || $('input[value^="0002"]').val();

    if (!pixCode) {
      return res.status(500).json({ error: 'Erro ao extrair PIX' });
    }

    res.status(200).json({ success: true, pixCode: pixCode });

  } catch (err) {
    console.error('Erro:', err.message);
    res.status(500).json({ error: 'Erro interno', message: err.message });
  }
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
