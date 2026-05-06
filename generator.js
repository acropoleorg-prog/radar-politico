// generator.js
const Anthropic = require('@anthropic-ai/sdk');
const axios     = require('axios');
const cheerio   = require('cheerio');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BRAND_NAME = process.env.BRAND_NAME     || 'Acrópole';
const HANDLE_X   = process.env.BRAND_HANDLE_X || '@acropole';
const TONE       = process.env.POST_TONE      || 'informativo';

const TONE_INSTRUCTIONS = {
  informativo: 'Jornalístico e preciso. Apresente os fatos com dados concretos, sem julgamento explícito.',
  opinativo:   'Analítico e assertivo. Quando o fato exigir, tome partido. Voz de autoridade editorial.',
  urgente:     'Breaking news. Verbos no presente, sensação de urgência, impacto imediato.',
};

// ── Extração do artigo completo ───────────────────────────────────────────────
async function fetchArticleContent(url) {
  if (!url) return '';
  try {
    const { data } = await axios.get(url, {
      timeout: 10000,
      responseEncoding: 'utf8',
      headers: {
        // User-agent de browser real — evita bloqueio de sites que rejeitam bots
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',
      },
      maxContentLength: 4 * 1024 * 1024,
    });

    const $ = cheerio.load(data);

    // Remove ruído antes de extrair texto
    $(
      'script, style, nav, header, footer, aside, figure, figcaption, noscript, ' +
      '[class*="ad-"], [class*="banner"], [class*="cookie"], [class*="newsletter"], ' +
      '[class*="related"], [class*="leia-mais"], [class*="veja-mais"], ' +
      '[class*="share"], [class*="social"], [class*="comentarios"], ' +
      '[id*="cookie"], [id*="newsletter"], [id*="comments"]'
    ).remove();

    // Seletores priorizados por especificidade (sites de news brasileiros)
    const SELECTORS = [
      '.content-text__body',           // G1
      '.article-body__content',         // G1 alt
      '[class*="article-body"]',        // genérico
      '[class*="article-content"]',     // genérico
      '.c-news__body',                  // Folha de SP
      '[class*="ARTICLE_BODY"]',        // Globo React
      '[data-testid="article-body"]',   // React genérico
      '[class*="post-content"]',        // WordPress / Poder360
      '[class*="entry-content"]',       // WordPress padrão
      '[class*="materia-body"]',        // portais BR antigos
      '[class*="conteudo-materia"]',    // idem
      '[class*="news-body"]',           // CNN Brasil
      'article',                        // HTML5 semântico
      '[role="main"]',                  // acessibilidade
      'main',                           // fallback final
    ];

    let paragraphs = [];

    for (const sel of SELECTORS) {
      const el = $(sel).first();
      if (!el.length) continue;

      const ps = el.find('p')
        .map((_, p) => $(p).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter(t =>
          t.length > 60 &&
          !/^(leia (também|mais)|veja (também|mais)|saiba mais|publicidade|foto:|crédito:)/i.test(t)
        );

      if (ps.length >= 3) { paragraphs = ps; break; }
    }

    // Fallback: varrer todos os <p> da página
    if (paragraphs.length < 3) {
      paragraphs = $('p')
        .map((_, p) => $(p).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter(t => t.length > 60);
    }

    if (!paragraphs.length) return '';

    // Retorna até 15 parágrafos, ~4000 chars — suficiente para o modelo entender a matéria
    return paragraphs.slice(0, 15).join('\n\n').slice(0, 4000);

  } catch (err) {
    console.warn('[Generator] fetch artigo falhou:', err.message);
    return '';
  }
}

// ── Gera post para X ──────────────────────────────────────────────────────────
async function generatePost(item) {
  const toneGuide = TONE_INSTRUCTIONS[TONE] || TONE_INSTRUCTIONS.informativo;

  // Vídeos do YouTube não têm artigo para ler
  const articleContent = (item.type !== 'video' && item.url)
    ? await fetchArticleContent(item.url)
    : '';

  // Se o artigo tiver conteúdo real, usa ele. Caso contrário (paywall, erro), usa o resumo do RSS.
  const contentBlock = articleContent.length > 200
    ? `CONTEÚDO COMPLETO DA MATÉRIA:\n${articleContent}`
    : `RESUMO DISPONÍVEL (artigo inacessível): ${item.summary || 'sem resumo'}`;

  const prompt = `Você é um repórter-editor sênior da ${BRAND_NAME}, publicação de política brasileira reconhecida por clareza e precisão.

MATÉRIA:
Título: ${item.title}
Fonte: ${item.source}
${contentBlock}

─────────────────────────────────────
TAREFA: Escrever um post para X/Twitter.

DIRETRIZES DE CONTEÚDO:
• Vá além do título — identifique o ângulo mais noticioso, o dado que ancora o fato
• Use números concretos quando disponíveis: placar da votação, valor em R$, percentual, prazo
• Contextualize em uma palavra quando necessário: "pela 2ª vez", "1º desde 2021", "por 312×97"
• Prefira voz ativa: "O Senado aprovou" em vez de "foi aprovado pelo Senado"
• Tom: ${toneGuide}

FORMATO RÍGIDO:
• Máximo 280 caracteres no TOTAL (incluindo handle e hashtags — conte com cuidado)
• Handle obrigatório no final: ${HANDLE_X}
• Exatamente 2 hashtags específicas ao tema — NUNCA use #Política ou #Brasil como placeholder
• Proibido usar emojis

EXEMPLOS:
✓ BOM — "Câmara derruba veto de Lula e restaura reajuste de 9% para servidores do Judiciário por 327×118. Impacto estimado de R$ 4,5 bi ao ano. Senado deve votar na semana que vem. ${HANDLE_X} #ServidoresFederais #OrcamentoFederal"

✗ RUIM — "Uma importante votação aconteceu hoje na Câmara sobre salários de servidores. A decisão gera debate. ${HANDLE_X} #Política #Brasil"

─────────────────────────────────────
Responda SOMENTE com JSON válido, sem markdown:
{"text": "o post completo aqui", "editorial_note": "ângulo escolhido + dado-chave que ancora o post"}`;

  try {
    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 500,
      messages:   [{ role: 'user', content: prompt }],
    });

    const raw   = response.content[0].text.trim();
    const clean = raw.replace(/^```(?:json)?|```$/gm, '').trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON não encontrado na resposta do modelo');

    const parsed = JSON.parse(match[0]);

    // Garante que o post não ultrapasse 280 chars (segurança)
    if (parsed.text && parsed.text.length > 280) {
      console.warn(`[Generator] Post com ${parsed.text.length} chars — truncando`);
      parsed.text = parsed.text.slice(0, 277) + '…';
    }

    return parsed;

  } catch (err) {
    console.error('[Generator] Erro:', err.message);
    // Fallback mínimo: não gera texto vazio
    const fallbackTitle = item.title.slice(0, 200);
    return {
      text:           `${fallbackTitle} ${HANDLE_X} #política #brasil`,
      editorial_note: 'Geração automática (fallback — erro na API)',
    };
  }
}

// ── Batch com concorrência limitada ───────────────────────────────────────────
async function generateBatchPosts(items) {
  const results     = [];
  const CONCURRENCY = 2; // reduzido por causa do fetch de artigos (mais lento)

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
    if (i + CONCURRENCY < items.length) await new Promise(r => setTimeout(r, 800));
  }
  return results;
}

module.exports = { generatePost, generateBatchPosts };
