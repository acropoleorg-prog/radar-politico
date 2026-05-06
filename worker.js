// worker.js
const Parser = require('rss-parser');
const axios  = require('axios');
const { exec } = require('child_process');
const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');

const parser = new Parser();

const X_PROFILES = [
  'GloboNews', 'CNNBrasil', 'folha', 'g1', 'Poder360',
  'AgBrasil', 'JovemPanNews', 'BandNewsTV', 'Metrópoles', 'veja',
];

// ─── FONTES RSS ────────────────────────────────────────────────────────────────
// dedicated: true = feed exclusivo de política, dispensa filtro por palavra-chave
const RSS_SOURCES = [
  { name: 'G1 Política',     url: 'https://g1.globo.com/rss/g1/politica/feed.xml',                    type: 'news', dedicated: true  },
  { name: 'Folha Poder',     url: 'https://feeds.folha.uol.com.br/poder/rss091.xml',                  type: 'news', dedicated: true  },
  { name: 'Poder360',        url: 'https://www.poder360.com.br/feed/',                                type: 'news', dedicated: true  },
  { name: 'Agência Brasil',  url: 'https://agenciabrasil.ebc.com.br/rss/politica/feed.xml',            type: 'news', dedicated: true  },
  { name: 'CNN Brasil',      url: 'https://www.cnnbrasil.com.br/politica/feed/',                      type: 'news', dedicated: true  },
  { name: 'Metrópoles',      url: 'https://www.metropoles.com/politica/feed',                         type: 'news', dedicated: true  },
  { name: 'Agência Senado',  url: 'https://www12.senado.leg.br/noticias/rss/ultimas',                 type: 'news', dedicated: true  },
  { name: 'Câmara Notícias', url: 'https://www.camara.leg.br/noticias/rss/',                         type: 'news', dedicated: true  },
  { name: 'O Globo',         url: 'https://oglobo.globo.com/rss.xml',                                type: 'news', dedicated: false },
  { name: 'Veja',            url: 'https://veja.abril.com.br/feed/',                                  type: 'news', dedicated: false },
  // YouTube — RSS nativo (não requer autenticação)
  { name: 'GloboNews',       url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCui_lbBVKkUqCOOlRMTuexQ', type: 'video' },
  { name: 'CNN Brasil YT',   url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCszbSSGPGAHGEZJkBndaB4g', type: 'video' },
  { name: 'Band News',       url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCBi2mrWuNuyYy4gbM6Hth8A', type: 'video' },
  { name: 'Jovem Pan News',  url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCHLYjMBEvpZq6K1BWiEQbOQ', type: 'video' },
  { name: 'Poder360 YT',     url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCXkPFuRFGGNbDnuW5kwFEaQ', type: 'video' },
  { name: 'UOL News',        url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCMcnBhFBixLQsRBjk61j7tg', type: 'video' },
  { name: 'Metrópoles YT',   url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCw5fO2SLGiUGFWXm7wW7BVw', type: 'video' },
];

// ─── PALAVRAS-CHAVE (filtro para feeds não-dedicados e YouTube) ───────────────
const KEYWORDS = [
  // Pessoas
  'lula', 'bolsonaro', 'lira', 'pacheco', 'haddad', 'moraes', 'barroso',
  'tarcísio', 'cid gomes', 'marçal', 'gleisi', 'alckmin',
  // Instituições
  'congresso', 'senado', 'câmara', 'stf', 'supremo', 'governo federal',
  'planalto', 'ministério', 'pgr', 'polícia federal', 'tcu', 'stj', 'agu',
  // Termos legislativos
  'partido', 'eleição', 'político', 'reforma', 'votação', 'aprovado', 'rejeitado',
  'impeachment', 'cpi', 'pec', 'projeto de lei', ' pl ', 'decreto', 'medida provisória',
  'emenda', 'constituição', 'veto', 'sanção', 'promulgação',
  // Termos orçamentários
  'orçamento', 'fiscal', 'déficit', 'superávit', 'arrecadação', 'privatização',
  // Cargos
  'deputado', 'senador', 'ministro', 'presidente', 'governador',
  'legislativo', 'executivo', 'judiciário', 'democracia',
];

function isRelevant(title, description = '') {
  const text = (title + ' ' + description).toLowerCase();
  return KEYWORDS.some(kw => text.includes(kw));
}

// ─── FETCH RSS ─────────────────────────────────────────────────────────────────
async function fetchSource(source) {
  try {
    const { data } = await axios.get(source.url, {
      timeout: 12000,
      responseEncoding: 'utf8',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RadarPolitico/1.0; +https://acropole.com)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'Accept-Charset': 'utf-8',
        'Cache-Control': 'no-cache',
      },
    });

    const feed   = await parser.parseString(data);
    const cutoff = Date.now() - 48 * 60 * 60 * 1000; // últimas 48h

    return feed.items
      .filter(item => {
        const pubDate = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
        if (pubDate <= cutoff) return false;
        // Feeds de política dedicados: confiar no curador, pular filtro por keyword
        if (source.dedicated) return true;
        return isRelevant(item.title || '', item.contentSnippet || '');
      })
      .slice(0, 8)
      .map(item => {
        const url = item.link || item.guid || '';
        return {
          id:            uuidv4(),
          source:        source.name,
          type:          source.type,
          title:         (item.title || 'Sem título').trim(),
          summary:       item.contentSnippet?.replace(/\s+/g, ' ').trim().slice(0, 400) || '',
          url,
          videoId:       source.type === 'video' ? extractYoutubeId(url) : null,
          thumbnail:     item.itunes?.image || extractYoutubeThumbnail(url) || null,
          publishedAt:   item.pubDate || new Date().toISOString(),
          status:        'pending',
          generatedPost: null,
          downloadedFile: null,
          createdAt:     new Date().toISOString(),
        };
      });
  } catch (err) {
    console.warn(`[RSS] Falha ao buscar ${source.name}: ${err.message}`);
    return [];
  }
}

function extractYoutubeId(url) {
  const m = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/);
  return m ? m[1] : null;
}

function extractYoutubeThumbnail(url) {
  const id = extractYoutubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}

// ─── FETCH ALL SOURCES ─────────────────────────────────────────────────────────
async function fetchAllSources() {
  console.log('[Worker] Buscando em', RSS_SOURCES.length, 'fontes...');
  const results = await Promise.allSettled(RSS_SOURCES.map(s => fetchSource(s)));

  const items = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  // Deduplicação por URL exata e por similaridade de título
  const seenUrls   = new Set();
  const seenTitles = new Set();
  const unique     = items.filter(item => {
    if (item.url && seenUrls.has(item.url)) return false;
    const titleKey = item.title.toLowerCase().replace(/[^\w\s]/g, '').slice(0, 80);
    if (seenTitles.has(titleKey)) return false;
    if (item.url) seenUrls.add(item.url);
    seenTitles.add(titleKey);
    return true;
  });

  console.log(`[Worker] ${unique.length} itens únicos (${items.length} brutos)`);
  return unique;
}

// ─── DOWNLOAD VÍDEO ────────────────────────────────────────────────────────────
function downloadVideo(url, outputDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(outputDir, { recursive: true });
    const filename   = `video_${uuidv4()}.mp4`;
    const outputPath = path.join(outputDir, filename);

    const cmd = [
      'yt-dlp',
      '-f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best"',
      '--merge-output-format mp4',
      '--no-playlist',
      '--max-filesize 500m',
      `--output "${outputPath}"`,
      `"${url}"`,
    ].join(' ');

    console.log(`[Download] Iniciando: ${url}`);
    exec(cmd, { timeout: 300000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('[Download] Erro:', stderr);
        reject(new Error(stderr || error.message));
        return;
      }
      const files = fs.readdirSync(outputDir)
        .filter(f => f.startsWith('video_') && f.endsWith('.mp4'))
        .map(f => ({ name: f, time: fs.statSync(path.join(outputDir, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time);

      const finalFile = files[0]?.name || filename;
      console.log(`[Download] Concluído: ${finalFile}`);
      resolve(finalFile);
    });
  });
}

// ─── CHECK YT-DLP ──────────────────────────────────────────────────────────────
function checkYtDlp() {
  return new Promise(resolve => {
    exec('yt-dlp --version', (err, stdout) => {
      if (err) { console.warn('[Worker] yt-dlp não encontrado.'); resolve(false); }
      else      { console.log('[Worker] yt-dlp:', stdout.trim());  resolve(true);  }
    });
  });
}

module.exports = { fetchAllSources, downloadVideo, checkYtDlp, X_PROFILES };
