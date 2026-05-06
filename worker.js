// worker.js — Busca RSS, scraping e downloads de vídeo
const Parser = require('rss-parser');
const axios = require('axios');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const parser = new Parser();

// Perfis relevantes do X para monitoramento manual
const X_PROFILES = [
  'GloboNews', 'CNNBrasil', 'folha', 'g1', 'Poder360',
  'AgBrasil', 'JovemPanNews', 'BandNewsTV', 'UOLNoticias', 'OAntagonista',
];

// ─── FONTES RSS ────────────────────────────────────────────────────────────────
const RSS_SOURCES = [
  // Portais gerais
  { name: 'G1 Política',     url: 'https://g1.globo.com/rss/g1/politica/feed.xml',           type: 'news' },
  { name: 'Folha Poder',     url: 'https://feeds.folha.uol.com.br/poder/rss091.xml',          type: 'news' },
  { name: 'UOL Política',    url: 'https://rss.uol.com.br/feed/noticias.xml',                 type: 'news' },
  { name: 'O Globo Política',url: 'https://oglobo.globo.com/rss.xml?secao=politica',           type: 'news' },
  { name: 'Poder360',        url: 'https://www.poder360.com.br/feed/',                        type: 'news' },
  { name: 'Agência Brasil',  url: 'https://agenciabrasil.ebc.com.br/rss/politica/feed.xml',   type: 'news' },
  { name: 'Metrópoles',      url: 'https://www.metropoles.com/politica/feed',                 type: 'news' },
  { name: 'CNN Brasil',      url: 'https://www.cnnbrasil.com.br/politica/feed/',              type: 'news' },
  { name: 'Correio Braziliense', url: 'https://www.correiobraziliense.com.br/rss/politica.xml', type: 'news' },
  { name: 'Veja',            url: 'https://veja.abril.com.br/feed/',                          type: 'news' },
  // YouTube — canais de política BR (RSS nativo do YouTube)
  { name: 'GloboNews',       url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCui_lbBVKkUqCOOlRMTuexQ', type: 'video' },
  { name: 'CNN Brasil YT',   url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCszbSSGPGAHGEZJkBndaB4g', type: 'video' },
  { name: 'Band News',       url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCBi2mrWuNuyYy4gbM6Hth8A', type: 'video' },
  { name: 'Jovem Pan News',  url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCHLYjMBEvpZq6K1BWiEQbOQ', type: 'video' },
  { name: 'Poder360 YT',     url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCXkPFuRFGGNbDnuW5kwFEaQ', type: 'video' },
  { name: 'UOL News',        url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCMcnBhFBixLQsRBjk61j7tg', type: 'video' },
  { name: 'Metrópoles YT',   url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCw5fO2SLGiUGFWXm7wW7BVw', type: 'video' },
  { name: 'O Antagonista',   url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCDUl8bV7vbVt1rJfUGOoBKA', type: 'video' },
];

// Palavras-chave para filtrar relevância política
const KEYWORDS = [
  'lula', 'congresso', 'senado', 'câmara', 'stf', 'ministério', 'governo federal',
  'partido', 'eleição', 'político', 'reforma', 'votação', 'aprovado', 'rejeitado',
  'impeachment', 'cpi', 'pec', 'deputado', 'senador', 'ministro', 'presidente',
  'bolsonaro', 'lira', 'pacheco', 'haddad', 'orçamento', 'fiscal', 'legislativo',
  'executivo', 'judiciário', 'democracia', 'constituição', 'emenda', 'projeto de lei'
];

function isRelevant(title, description = '') {
  const text = (title + ' ' + description).toLowerCase();
  return KEYWORDS.some(kw => text.includes(kw));
}

// ─── FETCH RSS ─────────────────────────────────────────────────────────────────
async function fetchSource(source) {
  try {
    const { data } = await axios.get(source.url, {
      timeout: 10000,
      responseEncoding: 'utf8',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RadarPolitico/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Charset': 'utf-8',
      },
    });
    const feed = await parser.parseString(data);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // últimas 24h

    return feed.items
      .filter(item => {
        const pubDate = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
        return pubDate > cutoff && isRelevant(item.title || '', item.contentSnippet || '');
      })
      .slice(0, 5)
      .map(item => ({
        id: uuidv4(),
        source: source.name,
        type: source.type,
        title: item.title || 'Sem título',
        summary: item.contentSnippet?.slice(0, 300) || '',
        url: item.link || item.guid || '',
        videoId: source.type === 'video' ? extractYoutubeId(item.link || '') : null,
        thumbnail: item.itunes?.image || extractYoutubeThumbnail(item.link || '') || null,
        publishedAt: item.pubDate || new Date().toISOString(),
        status: 'pending', // pending | approved | rejected
        generatedPost: null,
        downloadedFile: null,
        createdAt: new Date().toISOString()
      }));
  } catch (err) {
    console.warn(`[RSS] Falha ao buscar ${source.name}: ${err.message}`);
    return [];
  }
}

function extractYoutubeId(url) {
  const match = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/);
  return match ? match[1] : null;
}

function extractYoutubeThumbnail(url) {
  const id = extractYoutubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}

// ─── FETCH ALL SOURCES ─────────────────────────────────────────────────────────
async function fetchAllSources() {
  console.log('[Worker] Iniciando busca em', RSS_SOURCES.length, 'fontes...');
  const results = await Promise.allSettled(RSS_SOURCES.map(s => fetchSource(s)));
  const items = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  // Deduplicate by title similarity
  const seen = new Set();
  const unique = items.filter(item => {
    const key = item.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[Worker] ${unique.length} itens únicos encontrados`);
  return unique;
}

// ─── DOWNLOAD VÍDEO ────────────────────────────────────────────────────────────
function downloadVideo(url, outputDir) {
  return new Promise((resolve, reject) => {
    const filename = `video_${uuidv4()}.mp4`;
    const outputPath = path.join(outputDir, filename);

    // yt-dlp com qualidade máxima até 1080p, formato mp4
    const cmd = [
      'yt-dlp',
      '-f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best"',
      '--merge-output-format mp4',
      '--no-playlist',
      '--max-filesize 500m',
      `--output "${outputPath}"`,
      `"${url}"`
    ].join(' ');

    console.log(`[Download] Iniciando: ${url}`);
    exec(cmd, { timeout: 300000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('[Download] Erro:', stderr);
        reject(new Error(stderr || error.message));
      } else {
        // yt-dlp pode gerar nome diferente, buscar arquivo mais recente
        const files = fs.readdirSync(outputDir)
          .filter(f => f.startsWith('video_') && f.endsWith('.mp4'))
          .map(f => ({ name: f, time: fs.statSync(path.join(outputDir, f)).mtimeMs }))
          .sort((a, b) => b.time - a.time);

        const finalFile = files[0]?.name || filename;
        console.log(`[Download] Concluído: ${finalFile}`);
        resolve(finalFile);
      }
    });
  });
}

// ─── CHECK YT-DLP ──────────────────────────────────────────────────────────────
function checkYtDlp() {
  return new Promise(resolve => {
    exec('yt-dlp --version', (err, stdout) => {
      if (err) {
        console.warn('[Worker] yt-dlp não encontrado. Downloads desabilitados.');
        resolve(false);
      } else {
        console.log('[Worker] yt-dlp disponível:', stdout.trim());
        resolve(true);
      }
    });
  });
}

module.exports = { fetchAllSources, downloadVideo, checkYtDlp, X_PROFILES };
