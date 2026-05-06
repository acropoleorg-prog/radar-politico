// generator.js
const Anthropic = require('@anthropic-ai/sdk');
const axios     = require('axios');
const cheerio   = require('cheerio');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BRAND_NAME = process.env.BRAND_NAME        || 'Acrópole';
const HANDLE_X   = process.env.BRAND_HANDLE_X    || '@acropole';
const TONE       = process.env.POST_TONE         || 'informativo';

const TONE_INSTRUCTIONS = {
  informativo: 'Direto, factual, jornalístico. Apresenta os fatos sem julgamento explícito.',
  opinativo:   'Analítico e assertivo. Toma partido quando o fato exige. Voz de autoridade editorial.',
  urgente:     'Tom de breaking news. Urgência, impacto imediato. Verbos no presente.',
};

// ── Busca e extrai texto principal do artigo ──────────────────────────────────
async function fetchArticleContent(url) {
  if (!url) return '';
  try {
    const { data } = await axios.get(url, {
      timeout: 8000,
      responseEncoding: 'utf8',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RadarPolitico/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Charset': 'utf-8',
      },
      maxContentLength: 2 * 1024 * 1024,
    });

    const $ = cheerio.load(data);
    $('script, style, nav, header, footer, aside, [class*="banner"], [class*="cookie"], [class*="ad-"]').remove();

    let text = '';
    for (const sel of ['article', '[class*="article-body"]', '[class*="article-content"]', '[class*="post-content"]', 'main']) {
      const el = $(sel).first();
      if (el.length) {
        text = el.find('p')
          .map((_, p) => $(p).text().trim())
          .get()
          .filter(t => t.length > 40)
          .join('\n');
        if (text.length > 300) break;
      }
    }

    if (text.length < 300) {
      text = $('p')
        .map((_, p) => $(p).text().trim())
        .get()
        .filter(t => t.length > 40)
        .join('\n');
    }

    return text.slice(0, 3500);
  } catch (err) {
    console.warn('[Generator] Não foi possível buscar artigo:', err.message);
    return '';
  }
}

// ── Gera post para X ──────────────────────────────────────────────────────────
async function generatePost(item) {
  const toneGuide      = TONE_INSTRUCTIONS[TONE] || TONE_INSTRUCTIONS.informativo;
  const articleContent = item.type !== 'video' ? await fetchArticleContent(item.url) : '';

  const contentBlock = articleContent
    ? `Conteúdo completo da matéria:\n${articleContent}`
    : `Resumo: ${item.summary || '(sem resumo disponível)'}`;

  const prompt = `Você é editor de redes sociais do portal ${BRAND_NAME}, especializado em política brasileira.
Tom: ${toneGuide}

Notícia:
Título: ${item.title}
Fonte: ${item.source}
${contentBlock}

Crie um post para X/Twitter seguindo estas regras:
- Máximo 280 caracteres no total (incluindo handle e hashtags)
- Apresente o fato principal de forma direta e impactante
- Inclua o handle ${HANDLE_X} no final
- 2 ou 3 hashtags curtas e relevantes no final
- Sem emojis

Responda SOMENTE com JSON válido, sem markdown:
{"text": "post completo aqui", "editorial_note": "uma frase sobre a relevância política desta notícia"}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw   = response.content[0].text;
    const clean = raw.replace(/```json|```/g, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON não encontrado na resposta');

    return JSON.parse(match[0]);
  } catch (err) {
    console.error('[Generator] Erro ao gerar post:', err.message);
    return {
      text: `${item.title.slice(0, 220)} ${HANDLE_X} #política #brasil`,
      editorial_note: 'Geração automática (fallback)',
    };
  }
}

// ── Batch com concorrência limitada ───────────────────────────────────────────
async function generateBatchPosts(items) {
  const results     = [];
  const CONCURRENCY = 3;

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch        = items.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(batch.map(item => generatePost(item)));
    batchResults.forEach((r, idx) => {
      results.push({
        id:    batch[idx].id,
        post:  r.status === 'fulfilled' ? r.value : null,
        error: r.status === 'rejected'  ? r.reason.message : null,
      });
    });
    if (i + CONCURRENCY < items.length) await new Promise(r => setTimeout(r, 500));
  }
  return results;
}

module.exports = { generatePost, generateBatchPosts };
