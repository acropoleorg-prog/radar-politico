// server.js
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const cron    = require('node-cron');

const { fetchAllSources } = require('./worker');

const app       = express();
const PORT      = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'items.json');
const PASS      = process.env.DASHBOARD_PASSWORD || 'radar2024';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = req.headers['x-radar-token'] || req.query.token;
  if (token !== PASS) return res.status(401).json({ error: 'Não autorizado' });
  next();
}

// ─── DATA ─────────────────────────────────────────────────────────────────────
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
  const seen = new Set(existing.map(i => i.url));
  const novo = fresh.filter(i => i.url && !seen.has(i.url));
  return [...novo, ...existing].slice(0, 300);
}

// ─── ROTAS ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/api/items', auth, (req, res) => {
  let items = loadItems();
  const { status, q } = req.query;
  if (status) items = items.filter(i => i.status === status);
  if (q)      items = items.filter(i => i.title.toLowerCase().includes(q.toLowerCase()));
  res.json({ total: items.length, items });
});

app.post('/api/fetch', auth, async (req, res) => {
  res.json({ ok: true, message: 'Busca iniciada' });
  try {
    const fresh = await fetchAllSources();
    saveItems(mergeItems(loadItems(), fresh));
    console.log(`[API] Fetch: ${fresh.length} novos itens`);
  } catch (err) {
    console.error('[API] Erro no fetch:', err.message);
  }
});

app.patch('/api/items/:id', auth, (req, res) => {
  const items = loadItems();
  const item  = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item não encontrado' });
  if (req.body.status) item.status = req.body.status;
  saveItems(items);
  res.json({ ok: true, item });
});

app.delete('/api/items/:id', auth, (req, res) => {
  saveItems(loadItems().filter(i => i.id !== req.params.id));
  res.json({ ok: true });
});

app.get('/api/stats', auth, (req, res) => {
  const items = loadItems();
  res.json({
    total:    items.length,
    pending:  items.filter(i => i.status === 'pending').length,
    approved: items.filter(i => i.status === 'approved').length,
    rejected: items.filter(i => i.status === 'rejected').length,
  });
});

// ─── CRON ─────────────────────────────────────────────────────────────────────
cron.schedule('0 */2 * * *', async () => {
  console.log('[Cron] Busca automática');
  try {
    const fresh = await fetchAllSources();
    saveItems(mergeItems(loadItems(), fresh));
    console.log(`[Cron] ${fresh.length} novos itens`);
  } catch (err) {
    console.error('[Cron] Erro:', err.message);
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\nRadar Político · porta ${PORT}`);
  try {
    const fresh = await fetchAllSources();
    saveItems(mergeItems([], fresh));
    console.log(`[Boot] ${fresh.length} itens carregados\n`);
  } catch (err) {
    console.error('[Boot] Erro:', err.message);
  }
});
