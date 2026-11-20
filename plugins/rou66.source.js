export const meta = {
  id: 'rou66.source',
  name: '肉視頻',
  version: '1.0.0',
  protocol: 1,
  kind: 'source',
  description: '肉視頻（rou66.net）：首页十二个分区、标签分类与搜索分页、單片/劇集详情；播放走 /api/hls/{id} 跳转到 HLS 清单，按地址里的 exp 声明有效期。',
  mature: true,
  linkDomains: ['rou66.net', 'www.rou66.net', 'spic3-101.vcwinford.cc'],
  timeouts: { read: 25, playback: 30 },
};

const SITE = 'https://rou66.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CATS = [
  '國產AV', '探花', '自拍流出', '日本', 'OnlyFans', 'AI短劇', '中出', '亂倫', '人妻', '口交',
  '巨乳', '後宮', '熟女', '大男主', '古風', '中文字幕', '單體作品', '大神精選', '網紅', '素人',
  '學生', '護士', '空姐', 'OL', '絲襪', '傳媒', '麻豆傳媒', '天美傳媒', '果凍傳媒', '星空無限傳媒',
  '大象傳媒', '杏吧傳媒', '愛豆傳媒', '抖陰', '澀會', '拍攝花絮', '早期東莞ISO桑拿系列', '中國', '寫真', '口爆',
];

const MEDIA_ID_RE = /^([vs])\/([a-z0-9]+)$/i;

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

// ISO8601 时长（PT258S / PT1H2M3S）转秒
function isoDuration(text) {
  const m = norm(text).match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/i);
  if (!m) return 0;
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const s = Number(m[3] || 0);
  const total = h * 3600 + min * 60 + s;
  return Number.isFinite(total) && total > 0 ? Math.round(total) : 0;
}

export default hg => {
  async function fetchText(path, ctx, ttl) {
    const url = path.startsWith('http') ? path : `${SITE}${path}`;
    const res = await hg.http.fetch({
      url,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        Referer: `${SITE}/home`,
      },
      retry: 1,
      signal: ctx.signal,
      ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 3600 } } : {}),
    });
    if (res.status === 404) throw new hg.PluginError('NOT_FOUND', '这个作品不存在或已下架');
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return norm(res.data);
  }

  async function fetchDoc(path, ctx, ttl) {
    const doc = hg.html.parse(await fetchText(path, ctx, ttl));
    if (!doc.select('a').length) throw new hg.PluginError('UPSTREAM_CHANGED', '页面结构异常，稍后重试');
    return doc;
  }

  function coverOf(raw) {
    const url = norm(raw);
    if (!/^https?:\/\//i.test(url)) return '';
    return url.replace(/^http:\/\//i, 'https://');
  }

  function itemFromCard(anchor) {
    const href = norm(anchor.attr('href'));
    const m = href.match(/^\/([vs])\/([a-z0-9]+)$/i);
    if (!m) return null;
    const img = anchor.first('img');
    const head = anchor.first('h3') || anchor.first('h2');
    const title = trim(head && head.text()) || trim(img && img.attr('alt')) || trim(anchor.attr('title'));
    if (!title) return null;
    const item = { id: `${m[1]}/${m[2]}`, title, type: m[1] === 'v' ? 'movie' : 'series' };
    const cover = coverOf(img && (img.attr('src') || img.attr('data-src')));
    if (cover) item.cover = cover;
    return item;
  }

  function cardsOf(root) {
    const out = [];
    const seen = new Set();
    for (const anchor of root.select('a')) {
      const item = itemFromCard(anchor);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }

  function jsonLd(html) {
    const m = norm(html).match(/"@type":"VideoObject"([\s\S]{0,1200}?)\}\s*<\/script>/);
    const text = m ? m[1] : '';
    if (!text) return {};
    const pick = key => {
      const hit = text.match(new RegExp(`"${key}"\\s*:\\s*(?:"([^"]*)"|\\[\\s*"([^"]*)"|([\\d.]+))`));
      if (!hit) return '';
      return hit[1] || hit[2] || hit[3] || '';
    };
    return {
      name: pick('name'),
      description: pick('description'),
      thumb: pick('thumbnailUrl'),
      duration: pick('duration'),
    };
  }

  function expOf(url) {
    const m = norm(url).match(/[?&]exp=(\d{9,13})/);
    if (!m) return 0;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 1600000000 ? n * 1000 : 0;
  }

  async function fetchPlaylist(url, ctx) {
    let res;
    try {
      res = await hg.http.fetch({
        url,
        headers: { 'User-Agent': UA, Referer: `${SITE}/home` },
        retry: 1,
        signal: ctx.signal,
        maxBytes: 2 * 1024 * 1024,
      });
    } catch (error) {
      if (error && error.code === 'NETWORK') return { retry: true };
      throw error;
    }
    return { res };
  }

  return {
    home: {
      async getSections(params, ctx) {
        const doc = await fetchDoc('/home', ctx, 900);
        const sections = [];
        const seen = new Set();
        for (const block of doc.select('section')) {
          const head = block.first('h2');
          const title = trim(head && head.text());
          if (!title || seen.has(title)) continue;
          const items = cardsOf(block);
          if (items.length < 2) continue;
          seen.add(title);
          sections.push({ id: `s${sections.length}`, title, layout: 'grid', items });
        }
        if (!sections.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页结构已变化');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories() {
        return CATS.map((name, i) => ({ id: String(i + 1), label: name }));
      },

      async list(params, ctx) {
        const idx = Number(params.categoryId) - 1;
        if (!Number.isInteger(idx) || idx < 0 || idx >= CATS.length) {
          throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        }
        const page = pageNo(params.cursor);
        const tag = encodeURIComponent(CATS[idx]);
        const doc = await fetchDoc(`/t/${tag}${page > 1 ? `?page=${page}` : ''}`, ctx, 300);
        const items = cardsOf(doc);
        const out = { items };
        if (items.length >= 20) out.next = String(page + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params.query);
        if (!query) return { items: [], next: null };
        const page = pageNo(params.cursor);
        const doc = await fetchDoc(
          `/search?q=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ''}`,
          ctx,
          120,
        );
        const items = cardsOf(doc);
        const out = { items };
        if (items.length >= 20) out.next = String(page + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const mediaId = trim(params.id);
        const parsed = mediaId.match(MEDIA_ID_RE);
        if (!parsed) throw new hg.PluginError('INVALID_ARGUMENT', '作品 ID 不合法');
        const kind = parsed[1].toLowerCase();
        const id = parsed[2];

        const html = await fetchText(`/${kind}/${id}`, ctx, 120);
        const doc = hg.html.parse(html);
        const ld = jsonLd(html);

        let title = trim(ld.name);
        if (!title) {
          const head = doc.first('h1') || doc.first('h2');
          title = trim(head && head.text());
        }
        if (!title) {
          const tag = doc.first('title');
          title = trim(tag && tag.text()).split(/\s+-\s+/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = { id: mediaId, title, type: kind === 's' ? 'series' : 'movie', playlists: [] };

        const cover = coverOf(ld.thumb) || coverOf(norm((doc.first('img') || { attr: () => '' }).attr('src')));
        if (cover) detail.cover = cover;

        const description = trim(ld.description);
        if (description) detail.description = description.slice(0, 5000);

        const duration = isoDuration(ld.duration);
        if (duration) detail.durationSec = duration;

        const tags = [];
        for (const anchor of doc.select('a')) {
          const href = norm(anchor.attr('href'));
          const m = href.match(/^\/t\/([^"?]+)/);
          if (!m) continue;
          const text = trim(anchor.text());
          if (text && text.length <= 16 && tags.indexOf(text) < 0) tags.push(text);
        }
        if (tags.length) detail.tags = tags.slice(0, 12);

        if (kind === 'v') {
          detail.playlists.push({
            id: 'main',
            label: '正片',
            kind: 'main',
            episodes: [{ id, index: 1, label: '正片' }],
          });
          detail.episodeCount = 1;
          detail.totalEpisodes = 1;
        } else {
          const episodes = [];
          const seen = new Set();
          for (const anchor of doc.select('a')) {
            const href = norm(anchor.attr('href'));
            const m = href.match(/^\/v\/([a-z0-9]+)$/i);
            if (!m || seen.has(m[1])) continue;
            seen.add(m[1]);
            const head = anchor.first('h3');
            const label = trim(head && head.text()) || `第${episodes.length + 1}集`;
            episodes.push({ id: m[1], index: episodes.length + 1, label: label.slice(0, 80) });
          }
          if (!episodes.length) throw new hg.PluginError('CONTENT_LOCKED', '这个劇集还没有可播放的分集');
          detail.playlists.push({ id: 'main', label: '正片', kind: 'main', episodes });
          detail.episodeCount = episodes.length;
          detail.totalEpisodes = episodes.length;
        }
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const episodeId = trim(params.episodeId);
        if (!/^[a-z0-9]+$/i.test(episodeId)) throw new hg.PluginError('INVALID_ARGUMENT', '分集 ID 不合法');

        const entry = `${SITE}/api/hls/${episodeId}`;
        let lastStatus = 0;
        // 该站的 CDN 池会随机给出坏节点（502），每次重进 /api/hls 都会换一台，多试几次
        for (let attempt = 0; attempt < 5; attempt++) {
          // 站点会按客户端「粘」在同一台 CDN 节点上；带一个随机查询参数才会重新分配节点
          const probeUrl = attempt === 0 ? entry : `${entry}${entry.indexOf('?') >= 0 ? '&' : '?'}r=${attempt}${Math.floor(Math.random() * 1000)}`;
          const { res } = await fetchPlaylist(probeUrl, ctx);
          if (!res) continue;
          if (!res.ok) {
            lastStatus = res.status;
            // 该站的 CDN 节点会偶发 502，重试一次通常就好
            continue;
          }
          const finalUrl = res.url || entry;
          const body = norm(res.data);
          if (body.indexOf('#EXTM3U') !== 0) {
            lastStatus = res.status;
            continue;
          }
          const info = {
            streams: [{
              url: finalUrl,
              kind: 'media',
              format: 'hls',
              headers: { Referer: `${SITE}/home` },
            }],
          };
          const expiresAt = expOf(finalUrl) || expOf(entry);
          if (expiresAt) info.expiresAt = expiresAt;
          return info;
        }
        if (lastStatus >= 500) {
          throw new hg.PluginError('RATE_LIMITED', 'CDN 节点暂时不可用，稍等再点一次', { retryAfterSec: 20 });
        }
        throw new hg.PluginError(
          'CONTENT_LOCKED',
          lastStatus ? `取流失败（${lastStatus}），换一集或稍后再试` : '取流失败，稍后重试',
        );
      },

      async matchUrl(params) {
        const m = norm(params.url).match(/^https?:\/\/(?:www\.)?rou66\.net\/([vs])\/([a-z0-9]+)/i);
        if (!m) return null;
        return { mediaId: `${m[1]}/${m[2]}` };
      },
    },
  };
};
