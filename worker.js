// worker.js
const Parser = require('rss-parser');
const axios  = require('axios');
const { v4: uuidv4 } = require('uuid');

const parser = new Parser();

// ─── FONTES RSS ────────────────────────────────────────────────────────────────
// dedicated: true = feed exclusivo de política, dispensa filtro por palavra-chave
const RSS_SOURCES = [
  { name: 'G1 Política',     url: 'https://g1.globo.com/rss/g1/politica/feed.xml',                  dedicated: true  },
  { name: 'Folha Poder',     url: 'https://feeds.folha.uol.com.br/poder/rss091.xml',                dedicated: true  },
  { name: 'Poder360',        url: 'https://www.poder360.com.br/feed/',                              dedicated: true  },
  { name: 'Agência Brasil',  url: 'https://agenciabrasil.ebc.com.br/rss/politica/feed.xml',          dedicated: true  },
  { name: 'CNN Brasil',      url: 'https://www.cnnbrasil.com.br/politica/feed/',                    dedicated: true  },
  { name: 'Metrópoles',      url: 'https://www.metropoles.com/politica/feed',                       dedicated: true  },
  { name: 'Agência Senado',  url: 'https://www12.senado.leg.br/noticias/rss/ultimas',               dedicated: true  },
  { name: 'Câmara Notícias', url: 'https://www.camara.leg.br/noticias/rss/',                       dedicated: true  },
  { name: 'O Globo',         url: 'https://oglobo.globo.com/rss.xml',                              dedicated: false },
  { name: 'Veja',            url: 'https://veja.abril.com.br/feed/',                                dedicated: false },
];

// ─── FILTRO POR PALAVRA-CHAVE (apenas feeds não-dedicados) ────────────────────
const KEYWORDS = [
  'lula', 'bolsonaro', 'lira', 'pacheco', 'haddad', 'moraes', 'barroso',
  'tarcísio', 'gleisi', 'alckmin', 'congresso', 'senado', 'câmara', 'stf',
  'supremo', 'governo federal', 'planalto', 'ministério', 'pgr', 'tcu', 'stj',
  'partido', 'eleição', 'votação', 'aprovado', 'rejeitado', 'impeachment',
  'cpi', 'pec', 'projeto de lei', ' pl ', 'decreto', 'medida provisória',
  'emenda', 'constituição', 'veto', 'sanção', 'orçamento', 'déficit',
  'deputado', 'senador', 'ministro', 'presidente', 'governador',
  'legislativo', 'executivo', 'judiciário',
];

function isRelevant(title, description = '') {
  const text = (title + ' ' + description).toLowerCase();
  return KEYWORDS.some(kw => text.includes(kw));
}

// ─── CORREÇÃO DE ENCODING ──────────────────────────────────────────────────────
// Corrige o caso mais comum: bytes UTF-8 lidos como Latin-1 (ex: "Ã§" → "ç")
// Se ainda restar caracteres estranhos, normaliza para o equivalente ASCII mais próximo
function sanitizeText(str) {
  if (!str) return '';
  let s = str;

  // Detecta double-encoding pela assinatura "Ã" + byte de continuação UTF-8
  if (/Ã[\x80-\xBF]|Â[\x80-\xBF]/.test(s)) {
    try {
      const attempt = Buffer.from(s, 'latin1').toString('utf8');
      if (!attempt.includes('�')) s = attempt;
    } catch {}
  }

  // Remove caracteres de substituição e limpa espaços
  s = s.replace(/�/g, '').replace(/\s+/g, ' ').trim();

  // Fallback: normaliza acentos para equivalente ASCII se ainda houver lixo
  // (ex: caractere que não é Unicode válido após a correção acima)
  if (/[^\x00-\x7FÀ-ɏḀ-ỿ]/.test(s)) {
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
  }

  return s;
}

// ─── FETCH RSS ─────────────────────────────────────────────────────────────────
async function fetchSource(source) {
  try {
    const { data } = await axios.get(source.url, {
      timeout: 12000,
      responseEncoding: 'utf8',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RadarPolitico/1.0)',
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
        if (source.dedicated) return true;
        return isRelevant(item.title || '', item.contentSnippet || '');
      })
      .slice(0, 8)
      .map(item => ({
        id:          uuidv4(),
        source:      sanitizeText(source.name),
        title:       sanitizeText(item.title || 'Sem título'),
        summary:     sanitizeText(item.contentSnippet?.replace(/\s+/g, ' ').trim().slice(0, 400) || ''),
        url:         item.link || item.guid || '',
        publishedAt: item.pubDate || new Date().toISOString(),
        status:      'pending',
        createdAt:   new Date().toISOString(),
      }));
  } catch (err) {
    console.warn(`[RSS] Falha: ${source.name} — ${err.message}`);
    return [];
  }
}

// ─── FETCH ALL ─────────────────────────────────────────────────────────────────
async function fetchAllSources() {
  console.log('[Worker] Buscando em', RSS_SOURCES.length, 'fontes...');
  const results = await Promise.allSettled(RSS_SOURCES.map(s => fetchSource(s)));

  const items = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

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

module.exports = { fetchAllSources };
