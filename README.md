# 🗺️ Radar Político — Pipeline Editorial

Sistema de monitoramento de política brasileira com geração automática de posts para X e Instagram.

## O que faz

1. **Busca** notícias e vídeos de política BR em 17 fontes (G1, Folha, UOL, Poder360, GloboNews, CNN Brasil, Jovem Pan, etc.) via RSS
2. **Filtra** por relevância usando palavras-chave políticas
3. **Gera legendas** para X/Twitter e Instagram usando Claude (tom configurável)
4. **Baixa vídeos** do YouTube e outras fontes via yt-dlp
5. **Dashboard** para você aprovar, editar e organizar antes de postar

## Deploy no Railway

### 1. Crie o repositório
```bash
git init
git add .
git commit -m "feat: radar politico inicial"
```

### 2. Suba para o GitHub e conecte ao Railway
- No Railway: New Project → Deploy from GitHub repo
- Selecione o repositório

### 3. Configure as variáveis de ambiente no Railway
No painel do projeto → Variables, adicione:

| Variável | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (sua chave da Anthropic) |
| `DASHBOARD_PASSWORD` | Uma senha forte |
| `BRAND_NAME` | `Acrópole` |
| `BRAND_HANDLE_X` | `@acropole` |
| `BRAND_HANDLE_IG` | `@acropole` |
| `POST_TONE` | `opinativo` (ou `informativo` / `urgente`) |

### 4. O Railway detecta automaticamente o nixpacks.toml
- Instala `yt-dlp` e `ffmpeg` automaticamente
- Roda `npm install` e `node server.js`

### 5. Acesse o dashboard
`https://seu-projeto.railway.app` → use a senha configurada

---

## Uso do dashboard

### Fluxo básico
1. Clique **↺ Buscar** → sistema busca nas 17 fontes e filtra por relevância
2. Clique **✦ Gerar posts** → Claude gera legendas para X e Instagram de todos os itens pendentes
3. Revise e edite as legendas diretamente no card (campos editáveis)
4. **↓ Baixar vídeo** nos cards de vídeo que quiser postar
5. **✓ Aprovar** os que quiser usar / **✕ Rejeitar** os que não interessam
6. Copie a legenda aprovada e poste manualmente no X e Instagram

### Filtros disponíveis
- Por status: Todos / Pendente / Aprovado / Rejeitado
- Por tipo: Todos / Notícias / Vídeos
- Busca textual por título ou fonte

### Agendamento automático
O sistema busca novas fontes automaticamente a cada 2 horas.

---

## Arquitetura

```
server.js      — API Express + agendamento cron
worker.js      — RSS fetcher + yt-dlp wrapper (17 fontes)
generator.js   — Geração de posts via Claude API
public/        — Dashboard HTML/CSS/JS
data/          — items.json (banco de dados local)
downloads/     — Vídeos baixados
nixpacks.toml  — Instala yt-dlp + ffmpeg no Railway
```

## Fontes monitoradas

**Notícias:** G1 Política, Folha Poder, UOL Política, O Globo Política, Poder360, Agência Brasil, Metrópoles, CNN Brasil, Correio Braziliense, Veja

**Vídeos (YouTube):** GloboNews, CNN Brasil, Band News, Jovem Pan News, Poder360, UOL News, Metrópoles, O Antagonista

---

## Personalização

### Adicionar novas fontes RSS
Em `worker.js`, adicione ao array `RSS_SOURCES`:
```js
{ name: 'Nome', url: 'https://fonte.com/feed.xml', type: 'news' }
```

### Adicionar canal do YouTube
```js
{ name: 'Canal', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=ID_DO_CANAL', type: 'video' }
```
O `channel_id` está na URL do canal no YouTube.

### Mudar tom dos posts
No Railway, altere a variável `POST_TONE` para:
- `informativo` — factual, jornalístico
- `opinativo` — analítico, assertivo, voz editorial
- `urgente` — breaking news, impacto imediato

---

## Dependências
- Node.js 18+
- yt-dlp + ffmpeg (instalados automaticamente via nixpacks.toml)
- Claude API (Anthropic)
