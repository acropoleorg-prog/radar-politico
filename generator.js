// generator.js — Gera legendas para X e Instagram usando Claude
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BRAND_NAME = process.env.BRAND_NAME || 'Acrópole';
const HANDLE_X   = process.env.BRAND_HANDLE_X || '@acropole';
const HANDLE_IG  = process.env.BRAND_HANDLE_IG || '@acropole';
const TONE       = process.env.POST_TONE || 'informativo';

const TONE_INSTRUCTIONS = {
  informativo: 'Direto, factual, jornalístico. Apresenta os fatos sem julgamento explícito.',
  opinativo:   'Analítico e assertivo. Toma partido quando o fato exige. Voz de autoridade editorial.',
  urgente:     'Tom de breaking news. Urgência, impacto imediato. Verbos no presente.'
};

async function generatePost(item) {
  const toneGuide = TONE_INSTRUCTIONS[TONE] || TONE_INSTRUCTIONS.informativo;

  const prompt = `Você é editor de redes sociais do portal ${BRAND_NAME}, especializado em política brasileira.

Tom editorial: ${toneGuide}

Item para transformar em post:
- Título: ${item.title}
- Fonte: ${item.source}
- Resumo: ${item.summary || '(sem resumo disponível)'}
- URL: ${item.url}
- Tipo: ${item.type === 'video' ? 'Vídeo' : 'Notícia'}

Gere posts otimizados para duas plataformas. Responda SOMENTE com JSON válido, sem markdown:

{
  "x": {
    "text": "post para X/Twitter, máximo 280 caracteres, inclua hashtags relevantes no final, inclua o handle ${HANDLE_X} se couber",
    "hashtags": ["lista", "de", "hashtags", "sem", "cerquilha"]
  },
  "instagram": {
    "caption": "legenda para Instagram, pode ser mais longa (até 2200 chars), use quebras de linha, emojis estratégicos, CTAs como 'Link na bio', hashtags no final separadas por linha",
    "hashtags": ["lista", "de", "hashtags", "sem", "cerquilha"]
  },
  "editorial_note": "1 frase sobre por que esse conteúdo é relevante agora para o cenário político brasileiro"
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON não encontrado na resposta');

    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('[Generator] Erro ao gerar post:', err.message);
    return {
      x: { text: `📰 ${item.title.slice(0, 220)} | ${HANDLE_X}`, hashtags: ['política', 'brasil'] },
      instagram: { caption: `${item.title}\n\nFonte: ${item.source}\n\n#política #brasil`, hashtags: ['política', 'brasil'] },
      editorial_note: 'Geração automática (fallback)'
    };
  }
}

async function generateBatchPosts(items) {
  // Processa em paralelo mas com limite de concorrência
  const results = [];
  const CONCURRENCY = 3;

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(batch.map(item => generatePost(item)));
    batchResults.forEach((r, idx) => {
      results.push({
        id: batch[idx].id,
        post: r.status === 'fulfilled' ? r.value : null,
        error: r.status === 'rejected' ? r.reason.message : null
      });
    });
    // Small delay to respect rate limits
    if (i + CONCURRENCY < items.length) await new Promise(r => setTimeout(r, 500));
  }
  return results;
}

module.exports = { generatePost, generateBatchPosts };
