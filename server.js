// server.js — API Express + agendamento
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const cron    = require('node-cron');

const { v4: uuidv4 }                          = require('uuid');
const { fetchAllSources, downloadVideo, checkYtDlp } = require('./worker');
const { generatePost, generateBatchPosts }    = require('./generator');

const app  = express();
const PORT = process.env.PORT || 3000;
const DOWNLOADS_DIR  = path.join(__dirname, 'downloads');
const DATA_FILE      = path.join(__dirname, 'data', 'items.json');
const XVIDEOS_FILE   = path.join(__dirname, 'data', 'xvideos.json');
const PASS           = process.env.DASHBOARD_PASSWORD || 'radar2024';

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(DOWNLOADS_DIR));

// Auth middleware simples
function auth(req, res, next) {
  const token = req.headers['x-radar-token'] || req.query.token;
  if (token !== PASS) return res.status(401).json({ error: 'Não autorizado' });
  next();
}

// ─── DATA STORE (JSON simples) ────────────────────────────────────────────────
function loadItems() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { return []; }
}

function saveItems(items) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2));
}

function mergeItems(existing, fresh) {
  const existingUrls = new Set(existing.map(i => i.url));
  const newItems = fresh.filter(i => !existingUrls.has(i.url));
  // Manter últimos 200 itens
  return [...newItems, ...existing].slice(0, 200);
}

// ─── ROTAS ────────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// GET /api/items — lista itens com filtros
app.get('/api/items', auth, (req, res) => {
  let items = loadItems();
  const { status, type, q } = req.query;

  if (status) items = items.filter(i => i.status === status);
  if (type)   items = items.filter(i => i.type === type);
  if (q)      items = items.filter(i => i.title.toLowerCase().includes(q.toLowerCase()));

  res.json({ total: items.length, items });
});

// POST /api/fetch — dispara busca manual
app.post('/api/fetch', auth, async (req, res) => {
  res.json({ ok: true, message: 'Busca iniciada em background' });

  try {
    const fresh = await fetchAllSources();
    const existing = loadItems();
    const merged = mergeItems(existing, fresh);
    saveItems(merged);
    console.log(`[API] Fetch concluído: ${fresh.length} novos, ${merged.length} total`);
  } catch (err) {
    console.error('[API] Erro no fetch:', err.message);
  }
});

// POST /api/generate/:id — gera post para um item específico
app.post('/api/generate/:id', auth, async (req, res) => {
  const items = loadItems();
  const item = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado' });

  try {
    const post = await generatePost(item);
    item.generatedPost = post;
    saveItems(items);
    res.json({ ok: true, post });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/generate-batch — gera posts para todos os pending sem post
app.post('/api/generate-batch', auth, async (req, res) => {
  const items = loadItems();
  const targets = items.filter(i => i.status === 'pending' && !i.generatedPost).slice(0, 20);

  if (targets.length === 0) return res.json({ ok: true, message: 'Nenhum item pendente sem post', count: 0 });

  res.json({ ok: true, message: `Gerando posts para ${targets.length} itens em background`, count: targets.length });

  try {
    const results = await generateBatchPosts(targets);
    const updatedItems = loadItems(); // reload to avoid race
    results.forEach(r => {
      const item = updatedItems.find(i => i.id === r.id);
      if (item && r.post) item.generatedPost = r.post;
    });
    saveItems(updatedItems);
    console.log(`[API] Batch gerado: ${results.length} posts`);
  } catch (err) {
    console.error('[API] Erro no batch:', err.message);
  }
});

// POST /api/download/:id — baixa vídeo
app.post('/api/download/:id', auth, async (req, res) => {
  const ytDlpOk = await checkYtDlp();
  if (!ytDlpOk) return res.status(503).json({ error: 'yt-dlp não instalado no servidor' });

  const items = loadItems();
  const item = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado' });
  if (item.type !== 'video') return res.status(400).json({ error: 'Este item não é um vídeo' });
  if (!item.url) return res.status(400).json({ error: 'URL não disponível' });

  res.json({ ok: true, message: 'Download iniciado em background' });

  try {
    const filename = await downloadVideo(item.url, DOWNLOADS_DIR);
    item.downloadedFile = filename;
    saveItems(items);
    console.log(`[API] Download concluído: ${filename}`);
  } catch (err) {
    console.error('[API] Erro no download:', err.message);
  }
});

// PATCH /api/items/:id — atualiza status ou post editado
app.patch('/api/items/:id', auth, (req, res) => {
  const items = loadItems();
  const item = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado' });

  const { status, generatedPost } = req.body;
  if (status) item.status = status;
  if (generatedPost) item.generatedPost = generatedPost;

  saveItems(items);
  res.json({ ok: true, item });
});

// DELETE /api/items/:id
app.delete('/api/items/:id', auth, (req, res) => {
  let items = loadItems();
  items = items.filter(i => i.id !== req.params.id);
  saveItems(items);
  res.json({ ok: true });
});

// GET /api/stats
app.get('/api/stats', auth, (req, res) => {
  const items = loadItems();
  res.json({
    total: items.length,
    pending: items.filter(i => i.status === 'pending').length,
    approved: items.filter(i => i.status === 'approved').length,
    rejected: items.filter(i => i.status === 'rejected').length,
    news: items.filter(i => i.type === 'news').length,
    videos: items.filter(i => i.type === 'video').length,
    withPost: items.filter(i => i.generatedPost).length,
    withDownload: items.filter(i => i.downloadedFile).length,
  });
});

// ─── X VÍDEOS (manual) ───────────────────────────────────────────────────────
function loadXVideos() {
  try {
    if (!fs.existsSync(XVIDEOS_FILE)) return [];
    return JSON.parse(fs.readFileSync(XVIDEOS_FILE, 'utf8'));
  } catch { return []; }
}

function saveXVideos(videos) {
  fs.mkdirSync(path.dirname(XVIDEOS_FILE), { recursive: true });
  fs.writeFileSync(XVIDEOS_FILE, JSON.stringify(videos, null, 2));
}

app.get('/api/xvideos', auth, (req, res) => {
  res.json({ videos: loadXVideos() });
});

app.post('/api/xvideos', auth, (req, res) => {
  const { url, note } = req.body;
  if (!url) return res.status(400).json({ error: 'URL obrigatória' });
  const videos = loadXVideos();
  videos.unshift({ id: uuidv4(), url, note: note || '', addedAt: new Date().toISOString() });
  saveXVideos(videos);
  res.json({ ok: true, videos });
});

app.delete('/api/xvideos/:id', auth, (req, res) => {
  const videos = loadXVideos().filter(v => v.id !== req.params.id);
  saveXVideos(videos);
  res.json({ ok: true });
});

// ─── AGENDAMENTO ──────────────────────────────────────────────────────────────
// Busca automática a cada 2 horas
cron.schedule('0 */2 * * *', async () => {
  console.log('[Cron] Busca automática iniciada');
  try {
    const fresh = await fetchAllSources();
    const existing = loadItems();
    const merged = mergeItems(existing, fresh);
    saveItems(merged);
    console.log(`[Cron] ${fresh.length} novos itens adicionados`);
  } catch (err) {
    console.error('[Cron] Erro:', err.message);
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🗺️  Radar Político rodando na porta ${PORT}`);
  console.log(`   Dashboard: http://localhost:${PORT}`);
  console.log(`   Token: ${PASS}\n`);

  // Busca inicial ao subir
  try {
    console.log('[Boot] Rodando busca inicial...');
    const fresh = await fetchAllSources();
    const merged = mergeItems([], fresh);
    saveItems(merged);
    console.log(`[Boot] ${merged.length} itens carregados\n`);
  } catch (err) {
    console.error('[Boot] Erro na busca inicial:', err.message);
  }
});
