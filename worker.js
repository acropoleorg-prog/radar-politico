// worker.js
const Parser = require('rss-parser');
const axios  = require('axios');
const { v4: uuidv4 } = require('uuid');

const parser = new Parser();

// ─── FONTES RSS ────────────────────────────────────────────────────────────────
// dedicated: true = feed exclusivo de política, dispensa filtro por palavra-chave
const RSS_SOURCES = [
  // ── Grandes portais ────────────────────────────────────────────────────────
  { name: 'G1 Política',         url: 'https://g1.globo.com/rss/g1/politica/feed.xml',                    dedicated: true  },
  { name: 'Folha Poder',         url: 'https://feeds.folha.uol.com.br/poder/rss091.xml',                  dedicated: true  },
  { name: 'Estadao Politica',    url: 'https://www.estadao.com.br/politica/feed',                         dedicated: true  },
  { name: 'UOL Politica',        url: 'https://rss.uol.com.br/feed/noticias.xml',                         dedicated: false },
  { name: 'O Globo',             url: 'https://oglobo.globo.com/rss.xml',                                 dedicated: false },
  { name: 'Veja',                url: 'https://veja.abril.com.br/feed/',                                  dedicated: false },
  { name: 'Istoe',               url: 'https://istoe.com.br/feed/',                                       dedicated: false },
  // ── Especializados em politica ─────────────────────────────────────────────
  { name: 'Poder360',            url: 'https://www.poder360.com.br/feed/',                                dedicated: true  },
  { name: 'CNN Brasil',          url: 'https://www.cnnbrasil.com.br/politica/feed/',                      dedicated: true  },
  { name: 'Metropoles',          url: 'https://www.metropoles.com/politica/feed',                         dedicated: true  },
  { name: 'Congresso em Foco',   url: 'https://congressoemfoco.uol.com.br/feed/',                         dedicated: true  },
  { name: 'O Antagonista',       url: 'https://www.oantagonista.com/feed/',                               dedicated: true  },
  { name: 'Carta Capital',       url: 'https://www.cartacapital.com.br/feed/',                            dedicated: false },
  { name: 'Correio Braziliense', url: 'https://www.correiobraziliense.com.br/politica/index.rss',         dedicated: true  },
  { name: 'Jovem Pan',           url: 'https://jovempan.com.br/noticias/politica/feed',                   dedicated: true  },
  { name: 'The Intercept BR',    url: 'https://theintercept.com/brasil/feed/',                            dedicated: false },
  { name: 'Gazeta do Povo',      url: 'https://www.gazetadopovo.com.br/ultimas-noticias/feed.xml',        dedicated: false },
  // ── Fontes institucionais ──────────────────────────────────────────────────
  { name: 'Agencia Brasil',      url: 'https://agenciabrasil.ebc.com.br/rss/politica/feed.xml',           dedicated: true  },
  { name: 'Agencia Senado',      url: 'https://www12.senado.leg.br/noticias/rss/ultimas',                 dedicated: true  },
  { name: 'Camara Noticias',     url: 'https://www.camara.leg.br/noticias/rss/',                          dedicated: true  },
];

// ─── FILTRO POR PALAVRA-CHAVE (apenas feeds nao-dedicados) ────────────────────
const KEYWORDS = [
  'lula', 'bolsonaro', 'lira', 'pacheco', 'haddad', 'moraes', 'barroso',
  'tarcisio', 'gleisi', 'alckmin', 'congresso', 'senado', 'camara', 'stf',
  'supremo', 'governo federal', 'planalto', 'ministerio', 'pgr', 'tcu', 'stj',
  'partido', 'eleicao', 'votacao', 'aprovado', 'rejeitado', 'impeachment',
  'cpi', 'pec', 'projeto de lei', ' pl ', 'decreto', 'medida provisoria',
  'emenda', 'constituicao', 'veto', 'sancao', 'orcamento', 'deficit',
  'deputado', 'senador', 'ministro', 'presidente', 'governador',
  'legislativo', 'executivo', 'judiciario',
];

function isRelevant(title, description = '') {
  const text = toAscii(title + ' ' + description).toLowerCase();
  return KEYWORDS.some(kw => text.includes(kw));
}

// ─── ENCODING ─────────────────────────────────────────────────────────────────
// Converte texto para ASCII puro: acento vira letra base (c -> c, a -> a, etc.)
function toAscii(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // remove combining diacritics
    .replace(/[^\x00-\x7F]/g, '')      // remove qualquer nao-ASCII restante
    .replace(/\s+/g, ' ')
    .trim();
}

// Limpa texto mantendo acentos validos; converte para ASCII apenas se necessario
function sanitizeText(str) {
  if (!str) return '';
  const s = str.replace(/�/g, '').replace(/\s+/g, ' ').trim();
  // Se ainda houver caracteres corrompidos (sequencias tipo "Ã§"), converte tudo para ASCII
  if (/[\xC3\xC2][\x80-\xBF]/.test(s) || /Ã[^\s]/.test(s)) {
    return toAscii(s);
  }
  return s;
}

// ─── FETCH RSS ─────────────────────────────────────────────────────────────────
async function fetchSource(source) {
  try {
    const response = await axios.get(source.url, {
      timeout: 12000,
      responseType: 'arraybuffer',   // bytes brutos — decodificamos nos
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RadarPolitico/1.0)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'Cache-Control': 'no-cache',
      },
    });

    const buf = Buffer.from(response.data);

    // Tenta UTF-8; se aparecerem caracteres de substituicao, o feed e Latin-1
    let data = buf.toString('utf8');
    if (data.includes('�')) data = buf.toString('latin1');

    const feed   = await parser.parseString(data);
    const cutoff = Date.now() - 48 * 60 * 60 * 1000; // ultimas 48h

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
        source:      source.name,
        title:       sanitizeText(item.title || 'Sem titulo'),
        summary:     sanitizeText(item.contentSnippet?.replace(/\s+/g, ' ').trim().slice(0, 400) || ''),
        url:         item.link || item.guid || '',
        publishedAt: item.pubDate || new Date().toISOString(),
        status:      'pending',
        createdAt:   new Date().toISOString(),
      }));
  } catch (err) {
    console.warn(`[RSS] Falha: ${source.name} - ${err.message}`);
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
    const titleKey = toAscii(item.title).toLowerCase().replace(/[^\w\s]/g, '').slice(0, 80);
    if (seenTitles.has(titleKey)) return false;
    if (item.url) seenUrls.add(item.url);
    seenTitles.add(titleKey);
    return true;
  });

  console.log(`[Worker] ${unique.length} itens unicos (${items.length} brutos)`);
  return unique;
}

module.exports = { fetchAllSources };
