export const meta = {
  id: 'xojav.source',
  name: 'XOJAV',
  version: '1.0.1',
  protocol: 1,
  kind: 'source',
  description: 'XOJAV（xojav.cc）：首页推荐 + 四个热门分区，48 个分类分页，站内搜索分页，详情与 HLS 直链（cdnline 拼相对路径，带 Referer 取流）。',
  mature: true,
  linkDomains: ['xojav.cc', 'www.xojav.cc', 'fgds54gg.sxtmo.com'],
  timeouts: { read: 20, playback: 30 },
};

const SITE = 'https://xojav.cc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const TAG_LIMIT = 48;
const SECTION_TAGS = 4;
const CAT_CACHE_KEY = 'xojav.cats.v1';
const CATE_RE = /^\/category\/(cate\d+)\/?$/;

const HREF_VIDEO_RE = /^\/video\/(\d+)\/$/;
const MEDIA_ID_RE = /^\d+$/;

const norm = s => (typeof s === 'string' ? s : '');
const trim = s => norm(s).replace(/\s+/g, ' ').trim();
const pageNo = cursor => {
  const n = Number(cursor);
  return Number.isInteger(n) && n > 0 ? n : 1;
};

export default hg => {
  async function fetchText(path, ctx, ttl) {
    const url = path.startsWith('http') ? path : `${SITE}${path}`;
    const res = await hg.http.fetch({
      url,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        Referer: `${SITE}/`,
      },
      retry: 1,
      signal: ctx.signal,
      ...(ttl ? { cache: { ttlSec: ttl, staleIfErrorSec: 3600 } } : {}),
    });
    if (res.status === 404) throw new hg.PluginError('NOT_FOUND', '这个视频不存在或已下架');
    if (!res.ok) throw new hg.PluginError('UPSTREAM_ERROR', `站点返回 ${res.status}`);
    return norm(res.data);
  }

  async function fetchDoc(path, ctx, ttl) {
    const doc = hg.html.parse(await fetchText(path, ctx, ttl));
    if (!doc.select('a').length) throw new hg.PluginError('UPSTREAM_CHANGED', '页面结构异常，稍后重试');
    return doc;
  }

  async function loadCats(ctx) {
    const cached = await hg.storage.get(CAT_CACHE_KEY);
    if (cached && typeof cached === 'object' && Array.isArray(cached.list) && cached.list.length && Date.now() - (cached.at || 0) < 6 * 3600 * 1000) {
      return cached.list;
    }
    const doc = await fetchDoc('/', ctx, 1800);
    const list = [];
    const seen = new Set();
    for (const anchor of doc.select('a')) {
      const m = norm(anchor.attr('href')).match(CATE_RE);
      if (!m || seen.has(m[1])) continue;
      const label = trim(anchor.text());
      if (!label || label.length > 14) continue;
      seen.add(m[1]);
      list.push({ id: m[1], label });
      if (list.length >= TAG_LIMIT) break;
    }
    if (!list.length) throw new hg.PluginError('UPSTREAM_CHANGED', '分类列表读不出来');
    await hg.storage.set(CAT_CACHE_KEY, { at: Date.now(), list });
    return list;
  }

  function coverOf(raw) {
    const url = norm(raw);
    if (!/^https?:\/\//i.test(url)) return '';
    return url.replace(/^http:\/\//i, 'https://');
  }

  function cardsOf(root) {
    const out = [];
    const seen = new Set();
    for (const anchor of root.select('a')) {
      const m = norm(anchor.attr('href')).match(HREF_VIDEO_RE);
      if (!m || seen.has(m[1])) continue;
      const img = anchor.first('img');
      const title = trim(anchor.attr('title')) || trim(img && img.attr('alt'));
      if (!title) continue;
      seen.add(m[1]);
      const item = { id: m[1], title, type: 'movie' };
      const cover = coverOf(img && (img.attr('data-original') || img.attr('data-src') || img.attr('src')));
      if (cover && !/loading\.jpg/i.test(cover)) item.cover = cover;
      out.push(item);
    }
    return out;
  }

  async function probeMedia(url, ctx) {
    try {
      const res = await hg.http.fetch({
        url,
        headers: { 'User-Agent': UA, Referer: `${SITE}/` },
        signal: ctx.signal,
        timeoutMs: 8000,
        maxBytes: 2 * 1024 * 1024,
      });
      return { res };
    } catch (error) {
      return { res: null, error };
    }
  }

  return {
    home: {
      async getSections(params, ctx) {
        const sections = [];
        const home = await fetchDoc('/', ctx, 900).catch(error => {
          if (error && (error.code === 'CANCELLED' || error.code === 'RATE_LIMITED' || error.code === 'UPSTREAM_CHANGED')) throw error;
          return null;
        });
        if (home) {
          const items = cardsOf(home);
          if (items.length) sections.push({ id: 'home', title: '推荐视频', layout: 'grid', items });
        }
        const cats = await loadCats(ctx).catch(() => []);
        for (const cat of cats.slice(0, SECTION_TAGS)) {
          const doc = await fetchDoc(`/category/${cat.id}/`, ctx, 900).catch(() => null);
          if (!doc) continue;
          const items = cardsOf(doc);
          if (items.length) sections.push({ id: cat.id, title: cat.label, layout: 'grid', items });
        }
        if (!sections.length) throw new hg.PluginError('UPSTREAM_CHANGED', '首页结构已变化');
        return { items: sections, next: null };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const list = await loadCats(ctx);
        return list.map(cat => ({ id: cat.id, label: cat.label }));
      },

      async list(params, ctx) {
        const slug = trim(params.categoryId);
        if (!/^cate\d+$/.test(slug)) throw new hg.PluginError('INVALID_ARGUMENT', '分类 ID 不合法');
        const page = pageNo(params.cursor);
        const base = `/category/${slug}/`;
        const doc = await fetchDoc(page === 1 ? base : `${base}${page}/`, ctx, 300);
        const items = cardsOf(doc);
        const out = { items };
        if (items.length >= 8) out.next = String(page + 1);
        return out;
      },
    },

    search: {
      async search(params, ctx) {
        const query = trim(params.query);
        if (!query) return { items: [], next: null };
        const page = pageNo(params.cursor);
        // 表单里的 ?s= 是坏的，实际路径式 /search/{词}/{页}/ 才有效
        const base = `/search/${encodeURIComponent(query)}/`;
        const doc = await fetchDoc(page === 1 ? base : `${base}${page}/`, ctx, 120);
        const items = cardsOf(doc);
        const out = { items };
        if (items.length >= 8) out.next = String(page + 1);
        return out;
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = trim(params.id);
        if (!MEDIA_ID_RE.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '视频 ID 不合法');
        const doc = await fetchDoc(`/video/${id}/`, ctx, 120);

        const h1 = doc.first('h1');
        let title = trim(h1 && h1.text());
        if (!title) {
          const og = doc.first('meta[property="og:title"]');
          title = trim(og && og.attr('content')).replace(/\s+-\s+xojav$/i, '');
        }
        if (!title) {
          const tag = doc.first('title');
          title = trim(tag && tag.text()).split(/\s+\|\s+/)[0];
        }
        if (!title) throw new hg.PluginError('UPSTREAM_CHANGED', '详情结构已变化');

        const detail = { id, title, type: 'movie', playlists: [] };

        const ogImage = doc.first('meta[property="og:image"]');
        const cover = coverOf(ogImage && ogImage.attr('content'));
        if (cover) detail.cover = cover;

        const desc = doc.first('meta[name="description"]');
        const description = trim(desc && desc.attr('content'));
        if (description) detail.description = description.slice(0, 5000);

        const tags = [];
        for (const anchor of doc.select('a')) {
          const href = norm(anchor.attr('href'));
          if (!/^\/category\/cate\d+\/$/.test(href)) continue;
          const text = trim(anchor.attr('title')) || trim(anchor.text());
          if (text && text.length <= 12 && tags.indexOf(text) < 0) tags.push(text);
        }
        if (tags.length) detail.tags = tags.slice(0, 12);

        detail.playlists.push({
          id: 'main',
          label: '正片',
          kind: 'main',
          episodes: [{ id, index: 1, label: '正片' }],
        });
        detail.episodeCount = 1;
        detail.totalEpisodes = 1;
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = trim(params.episodeId) || trim(params.mediaId);
        if (!MEDIA_ID_RE.test(id)) throw new hg.PluginError('INVALID_ARGUMENT', '视频 ID 不合法');

        const html = await fetchText(`/video/${id}/`, ctx, 0);
        const holder = hg.html.parse(html).first('#article-videos');
        if (!holder) throw new hg.PluginError('UPSTREAM_CHANGED', '播放器节点不存在');

        const rel = norm(holder.attr('data-url'));
        const cdn = norm(holder.attr('data-cdnline'));
        if (!rel) throw new hg.PluginError('CONTENT_LOCKED', '这个视频没有播放地址');

        const urls = [];
        if (/^https?:\/\//i.test(rel)) urls.push(rel);
        else if (cdn) urls.push(`${cdn.replace(/\/+$/, '')}${rel.startsWith('/') ? '' : '/'}${rel}`);
        if (cdn && urls.length && !urls.includes(`${cdn.replace(/\/+$/, '')}${rel}`)) {
          urls.push(`${cdn.replace(/\/+$/, '')}${rel.startsWith('/') ? '' : '/'}${rel}`);
        }
        if (!urls.length) throw new hg.PluginError('CONTENT_LOCKED', '播放地址拼不出来，换一部试试');

        let lastStatus = 0;
        for (const url of urls) {
          for (let round = 0; round < 3; round += 1) {
            const sep = url.indexOf('?') === -1 ? '?' : '&';
            const target = round === 0 ? url : `${url}${sep}r=${Math.floor(Math.random() * 900000) + 100000}`;
            const probe = await probeMedia(target, ctx);
            if (!probe.res) continue;
            const body = norm(probe.res.data);
            if (!probe.res.ok || body.indexOf('#EXTM3U') !== 0) {
              lastStatus = probe.res.status;
              continue;
            }
            const info = {
              streams: [{
                url: probe.res.url || target,
                kind: 'media',
                format: 'hls',
                headers: { Referer: `${SITE}/` },
              }],
            };
            let total = 0;
            const re = /#EXTINF:\s*([\d.]+)/g;
            let m;
            while ((m = re.exec(body))) total += Number(m[1]) || 0;
            if (total > 1) info.durationSec = Math.round(total);
            return info;
          }
        }
        throw new hg.PluginError(
          'CONTENT_LOCKED',
          lastStatus ? `取流失败（${lastStatus}），换一部或稍后再试` : '取流失败，稍后再试',
        );
      },

      async matchUrl(params) {
        const m = norm(params.url).match(/^https?:\/\/(?:www\.)?xojav\.cc\/video\/(\d+)\/?/i);
        if (!m) return null;
        return { mediaId: m[1] };
      },
    },
  };
};
