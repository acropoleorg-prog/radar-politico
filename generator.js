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
Tom: ${toneGuide}

Notícia:
Título: ${item.title}
Fonte: ${item.source}
Resumo: ${item.summary || '(sem resumo disponível)'}
Tipo: ${item.type === 'video' ? 'Vídeo' : 'Notícia'}

Gere textos DISTINTOS para cada plataforma. Responda SOMENTE com JSON válido, sem markdown, sem blocos de código:

{
  "x": {
    "text": "Post para X/Twitter. Máximo 240 caracteres. Apresente o fato principal de forma direta e impactante. Sem emojis no início. No máximo 2 hashtags curtas no final. Não mencione o handle."
  },
  "instagram": {
    "caption": "Legenda para Instagram. Entre 100 e 220 palavras. Aborde os 2 ou 3 pontos mais relevantes da notícia em parágrafos curtos e diretos. Mais contextualizado que o Twitter. Use no máximo 2 emojis estratégicos. Termine com uma linha vazia e depois as hashtags separadas por espaço."
  },
  "editorial_note": "Uma frase sobre a relevância política desta notícia agora."
}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
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
