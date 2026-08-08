const $ = id => document.getElementById(id);
const state = { snapshot: null, socket: null, searchTimer: null, searchResults: [], dragIndex: null, trackKey: null, queueKey: null, lyricsKey: null, relatedKey: null, activeLyric: -1, cooldowns: {}, openPanel: null, searchDebounce: 350, filterCooldown: 1500, buttonCooldown: 2000 };
const previewMode = new URLSearchParams(location.search).has('preview');
const format = ms => `${String(Math.floor(Math.max(0, ms) / 60000)).padStart(2, '0')}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, '0')}`;
const EFFECTS = ['nightcore', 'vaporwave', 'tremolo', 'vibrato', 'rotation', 'lowpass', 'echo', 'karaoke'];
const SERVICE_URL_RE = /(?:open\.spotify\.com\/|deezer\.com\/|dzr\.page\.link\/|music\.apple\.com\/|tidal\.com\/|soundcloud\.com\/|youtube\.com\/|youtu\.be\/|music\.youtube\.com\/)/i;
const DIRECT_URL_RE = /^https?:\/\/\S+$/i;
let lyricsAutoScroll = loadState('lyrics_auto_scroll', true);
const EFFECT_LABELS = { nightcore: 'NIGHTCORE', vaporwave: 'VAPORWAVE', tremolo: 'TREMOLO', vibrato: 'VIBRATO', rotation: 'ROTATION', lowpass: 'LOW-PASS', echo: 'ECHO', karaoke: 'KARAOKE' };
//
function renderEffects(filters) {
  const target = $('effects');
  if (!target) return;
  target.innerHTML = EFFECTS.map(name => {
    const active = filters?.[name];
    return `<button class="effect-chip${active ? ' active' : ''}" data-effect="${name}"${active ? ' data-active="1"' : ''}>${EFFECT_LABELS[name]}</button>`;
  }).join('');
}

const artwork = url => url ? (previewMode || url.startsWith('/artwork/') ? url : `/artwork?url=${encodeURIComponent(url)}`) : '';
const hexToRgb = hex => { const normalized = String(hex || '#8c6cff').replace('#', ''); const value = Number.parseInt(normalized.slice(0, 6), 16); return { r: value >> 16, g: value >> 8 & 255, b: value & 255 }; };
const rgba = (rgb, alpha) => `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
//
const STORAGE_PREFIX = 'lunar_activity_';
function loadState(key, fallback) { try { const v = localStorage.getItem(STORAGE_PREFIX + key); return v !== null ? JSON.parse(v) : fallback; } catch { return fallback; } }
function saveState(key, value) { try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch { } }
//
const COOLDOWN_MS = 2000;
function setCooldown(action) {
  state.cooldowns[action] = Date.now() + state.buttonCooldown;
  updateControlStates();
  const btn = $(`btn-${action}`) || document.querySelector(`[data-effect="${action}"]`);
  if (btn) { btn.classList.add('cooldown'); }
  const timer = setInterval(() => {
    const remaining = state.cooldowns[action] - Date.now();
    if (remaining <= 0) {
      clearInterval(timer);
      delete state.cooldowns[action];
      if (btn) btn.classList.remove('cooldown');
      updateControlStates();
    }
  }, 100);
}
function isOnCooldown(action) { return state.cooldowns[action] && Date.now() < state.cooldowns[action]; }
//
function applyTheme(palette) {
  if (!palette) return;
  const root = document.documentElement;
  const accent = hexToRgb(palette.accent);
  const secondary = hexToRgb(palette.secondary);
  const tertiary = hexToRgb(palette.tertiary);
  root.style.setProperty('--accent', `rgb(${accent.r},${accent.g},${accent.b})`);
  root.style.setProperty('--accent-rgb', `${accent.r},${accent.g},${accent.b}`);
  root.style.setProperty('--accent-soft', rgba(accent, 0.18));
  root.style.setProperty('--accent-faint', rgba(accent, 0.07));
  root.style.setProperty('--accent-secondary', `rgb(${secondary.r},${secondary.g},${secondary.b})`);
  root.style.setProperty('--accent-secondary-rgb', `${secondary.r},${secondary.g},${secondary.b}`);
  root.style.setProperty('--accent-tertiary', `rgb(${tertiary.r},${tertiary.g},${tertiary.b})`);
  root.style.setProperty('--accent-tertiary-rgb', `${tertiary.r},${tertiary.g},${tertiary.b}`);

  const lum = (0.299 * accent.r + 0.587 * accent.g + 0.114 * accent.b) / 255;
  const contrast = lum < 0.5
    ? `rgb(${Math.min(255, accent.r + 140)},${Math.min(255, accent.g + 140)},${Math.min(255, accent.b + 140)})`
    : `rgb(${Math.min(255, accent.r + 60)},${Math.min(255, accent.g + 60)},${Math.min(255, accent.b + 60)})`;
  root.style.setProperty('--accent-contrast', contrast);

  root.style.setProperty('--accent-glow', `rgba(${accent.r},${accent.g},${accent.b},0.6)`);
  root.style.setProperty('--accent-glow-soft', `rgba(${accent.r},${accent.g},${accent.b},0.3)`);
  state.accent = accent;
  state.secondary = secondary;
  state.tertiary = tertiary;
}

function send(payload) { if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify(payload)); }
function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); setTimeout(() => $('toast').classList.remove('show'), 3500); }
function animate(element, className) { element.classList.remove(className); void element.offsetWidth; element.classList.add(className); }
function setConnection(message, status = 'connecting') { const target = $('connection'); if (!target) return; target.textContent = status === 'ready' ? 'CONNECTED' : 'CONNECTING…'; target.dataset.state = status; }
function normalizeDirectUrl(value) { return /^https?:\/\//i.test(value) ? value : `https://${value}`; }
function sourceFromUrl(value) {
  if (/spotify/i.test(value)) return 'spotify'; if (/deezer|dzr\.page/i.test(value)) return 'deezer';
  if (/apple\.com/i.test(value)) return 'applemusic'; if (/tidal/i.test(value)) return 'tidal';
  if (/soundcloud/i.test(value)) return 'soundcloud'; if (/music\.youtube\.com/i.test(value)) return 'youtubemusic';
  if (/youtube|youtu\.be/i.test(value)) return 'youtube'; return null;
}
function selectSearchSource(source, persist = false) {
  if (!source || !state.availableSources?.includes(source)) return;
  state.searchSource = source; if (persist) saveState('source', source);
  const option = document.querySelector(`.source-option[data-source="${source}"]`);
  if (!option) return;
  $('source-label').textContent = option.querySelector('span').textContent;
  $('source-icon').src = option.querySelector('img').src;
  document.querySelectorAll('.source-option').forEach(item => {
    const selected = item === option; item.classList.toggle('selected', selected); item.setAttribute('aria-selected', String(selected));
  });
}
function refreshTickers() {
  requestAnimationFrame(() => document.querySelectorAll('.ticker').forEach(ticker => {
    const text = ticker.querySelector('.ticker-text'); if (!text) return;
    ticker.classList.remove('is-overflowing'); text.style.removeProperty('--ticker-distance'); text.style.removeProperty('--ticker-duration');
    const overflow = text.scrollWidth - ticker.clientWidth;
    if (overflow > 2) {
      text.style.setProperty('--ticker-distance', `${Math.ceil(overflow)}px`);
      text.style.setProperty('--ticker-duration', `${Math.max(4, Math.min(14, overflow / 20))}s`);
      ticker.classList.add('is-overflowing');
    }
  }));
}

function setSearchSources(search) {
  if (!search?.sources?.length) return;
  const labels = { youtube: 'YouTube', youtubemusic: 'YouTube Music', soundcloud: 'SoundCloud', spotify: 'Spotify', deezer: 'Deezer', applemusic: 'Apple Music', tidal: 'Tidal', monochrome: 'Monochrome' };
  const icons = { spotify: 'emojis/spotify.webp', applemusic: 'emojis/apple_music.webp', deezer: 'emojis/deezer.webp', tidal: 'emojis/tidal.webp', soundcloud: 'emojis/soundcloud.webp', youtube: 'emojis/youtube.png', youtubemusic: 'emojis/youtube_music.png', monochrome: 'emojis/headphones.webp' };
  const icon = source => `/assets/${icons[source] || 'emojis/headphones.webp'}`;
  const savedSource = loadState('source', null);
  const initialSource = savedSource && search.sources.includes(savedSource) ? savedSource : search.defaultSource;
  state.searchSource = initialSource;
  state.availableSources = search.sources;
  $('source-label').textContent = labels[initialSource] || initialSource;
  $('source-icon').src = icon(initialSource);
  $('source-menu').innerHTML = search.sources.map(source => `<button type="button" class="source-option ${source === initialSource ? 'selected' : ''}" role="option" aria-selected="${source === initialSource}" data-source="${source}"><img src="${icon(source)}" alt=""><span>${labels[source] || source}</span><span class="source-check">✓</span></button>`).join('');
  $('source-toggle').disabled = false;
}

const withTimeout = (promise, ms, message) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
//
function getPlaybackPosition() {
  const player = state.snapshot?.player;
  if (!player) return 0;
  const now = Date.now();
  const speed = player.filters?.nightcore ? 1.15 : player.filters?.vaporwave ? 0.85 : 1.0;
  const pos = (player.position || 0) + (player.playing && !player.paused ? Math.max(0, now - (player.updatedAt || now)) * speed : 0);
  return Math.max(0, Math.floor(pos));
}

function updateControlStates() {
  const player = state.snapshot?.player;
  const hasCurrent = Boolean(player?.current);
  const canPrev = Boolean(player?.hasPrevious);
  const canNext = Boolean(player?.queueLength > 0);
  const canPlay = hasCurrent;
  const position = getPlaybackPosition();
  const canBack = hasCurrent && (position > 10000 || canPrev);

  $('btn-back').disabled = !canBack || isOnCooldown('back');
  $('btn-skip').disabled = !canNext || isOnCooldown('skip');

  const playBtn = $('btn-play');
  playBtn.disabled = !canPlay || isOnCooldown('pause') || isOnCooldown('resume');
  playBtn.classList.toggle('is-paused', Boolean(player?.paused));
}
//
let artImage = null;
let artBlurTile = null;
let artLoadUrl = null;
let artOffsetX = 0;
let artOffsetY = 0;
let artSpeed = 1;
let artWarpTime = 0;

let artOpacity = 0;
let artTargetOpacity = 0;
let artBaseOpacity = 0.18;

let artCrossfadeTile = null;
let artCrossfadeOpacity = 0;
let artFadingOut = false;
let artBlurPending = false;

function prepareBlurredTile() {
  if (!artImage) { artBlurTile = null; return; }
  const size = Math.max(window.innerWidth, window.innerHeight) * 0.75;
  const aspect = artImage.naturalWidth / artImage.naturalHeight;
  const tw = Math.ceil(aspect >= 1 ? size : size * aspect);
  const th = Math.ceil(aspect >= 1 ? size / aspect : size);

  const offscreen = document.createElement('canvas');
  offscreen.width = tw;
  offscreen.height = th;
  const octx = offscreen.getContext('2d');
  octx.filter = 'blur(12px)';
  octx.drawImage(artImage, 0, 0, tw, th);

  if (artBlurPending) {
    artBlurTile = offscreen;
    artBlurPending = false;
    artOffsetX = 0;
    artOffsetY = 0;
    artWarpTime = 0;
  } else {
    artBlurTile = offscreen;
  }
}

let artResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(artResizeTimer);
  artResizeTimer = setTimeout(() => {
    if (artImage) prepareBlurredTile();
  }, 300);
});

function loadArtwork(url, bpm) {
  if (url === artLoadUrl) return;
  artLoadUrl = url;

  if (artBlurTile && artOpacity > 0.01) {
    artCrossfadeTile = artBlurTile;
    artCrossfadeOpacity = 1;
    artFadingOut = true;
  } else {
    artCrossfadeTile = null;
    artCrossfadeOpacity = 0;
    artFadingOut = false;
  }

  artBlurTile = null;
  artBlurPending = false;

  if (!url) { artImage = null; return; }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    artImage = img;
    if (bpm && bpm > 0) {
      artSpeed = bpm / 100;
    } else {
      artSpeed = 0.4 + Math.random() * 1.2;
    }
    artBlurPending = true;
    prepareBlurredTile();
  };
  img.onerror = () => { artImage = null; artBlurTile = null; artBlurPending = false; };
  img.src = artwork(url);
}

function renderArtworkTiles(tile, w, h, opacity) {
  if (!tile || opacity <= 0.001) return;
  const tw = tile.width;
  const th = tile.height;
  const TILE_OVERLAP = 40;

  ctx.save();
  ctx.globalAlpha = opacity;

  ctx.fillStyle = '#07060e';
  ctx.fillRect(0, 0, w, h);

  artOffsetX += artSpeed;
  artOffsetY += artSpeed * 0.15;
  artWarpTime += 0.018;

  const warpAmp = 18 + Math.sin(artWarpTime * 0.3) * 6;
  const margin = warpAmp + 20;
  const cols = Math.ceil((w + margin * 2) / tw) + 2;
  const rows = Math.ceil((h + margin * 2) / th) + 2;
  const originX = -margin + (artOffsetX % tw);
  const originY = -margin + (artOffsetY % th);

  for (let row = -1; row < rows; row++) {
    for (let col = -1; col < cols; col++) {
      const seed = col * 3.7 + row * 7.1;
      const wx = Math.sin(artWarpTime + seed + artWarpTime * 0.2) * warpAmp;
      const wy = Math.cos(artWarpTime * 0.7 + seed * 0.8) * warpAmp * 0.7;
      const dx = Math.round(col * tw + originX + wx - TILE_OVERLAP);
      const dy = Math.round(row * th + originY + wy - TILE_OVERLAP);
      const dw = Math.round(tw + TILE_OVERLAP * 2);
      const dh = Math.round(th + TILE_OVERLAP * 2);
      ctx.drawImage(tile, 0, 0, tw, th, dx, dy, dw, dh);
    }
  }
  ctx.restore();
}

function drawArtworkBg(w, h, playing, hadTrack) {
  if (playing && hadTrack) {
    artTargetOpacity = artBaseOpacity + 0.08;
  } else if (hadTrack) {
    artTargetOpacity = 0;
  } else {
    artTargetOpacity = 0;
  }

  const fadeSpeed = playing && artTargetOpacity > 0 ? 0.035 : 0.025;
  artOpacity += (artTargetOpacity - artOpacity) * fadeSpeed;
  if (Math.abs(artOpacity - artTargetOpacity) < 0.001) artOpacity = artTargetOpacity;

  if (artFadingOut && artCrossfadeTile) {
    artCrossfadeOpacity -= 0.03;
    if (artCrossfadeOpacity <= 0) {
      artCrossfadeOpacity = 0;
      artFadingOut = false;
      artCrossfadeTile = null;
    } else {
      ctx.save();
      ctx.globalAlpha = artCrossfadeOpacity * artOpacity;
      const tw = artCrossfadeTile.width;
      const th = artCrossfadeTile.height;
      const TILE_OVERLAP = 30;
      const warpAmp = 18 + Math.sin(artWarpTime * 0.3) * 6;
      const margin = warpAmp + 20;
      const cols = Math.ceil((w + margin * 2) / tw) + 2;
      const rows = Math.ceil((h + margin * 2) / th) + 2;
      const originX = -margin + (artOffsetX % tw);
      const originY = -margin + (artOffsetY % th);
      for (let row = -1; row < rows; row++) {
        for (let col = -1; col < cols; col++) {
          const seed = col * 3.7 + row * 7.1;
          const wx = Math.sin(artWarpTime + seed + artWarpTime * 0.2) * warpAmp;
          const wy = Math.cos(artWarpTime * 0.7 + seed * 0.8) * warpAmp * 0.7;
          const x = Math.floor(col * tw + originX + wx);
          const y = Math.floor(row * th + originY + wy);
          ctx.drawImage(artCrossfadeTile, x - TILE_OVERLAP, y - TILE_OVERLAP, tw + TILE_OVERLAP * 2, th + TILE_OVERLAP * 2);
        }
      }
      ctx.restore();
    }
  }

  if (artBlurTile && artOpacity > 0.001) {
    renderArtworkTiles(artBlurTile, w, h, artOpacity);
  }
}
//
function render() {
  const data = state.snapshot;
  const player = data?.player;
  const current = player?.current;
  const trackKey = current ? `${current.encoded || ''}:${current.uri || ''}:${current.title}:${current.author}` : 'idle';
  const trackChanged = state.trackKey !== null && state.trackKey !== trackKey;
  state.trackKey = trackKey;

  if (trackChanged) {
    loadArtwork(current?.artworkUrl, current?.bpm);
  }

  if (state.socket?.readyState === WebSocket.OPEN && data) setConnection('CONNECTED', 'ready');

  const onBreak = Boolean(player?.onBreak);
  document.documentElement.classList.toggle('on-break', onBreak);

  $('queue-count').textContent = `${data?.queue?.length || 0} UP NEXT`;
  $('record').classList.toggle('paused', !player?.playing || player?.paused || onBreak);
  $('record').classList.toggle('is-playing', Boolean(player?.playing && !player?.paused && !onBreak));
  document.documentElement.classList.toggle('player-active', Boolean(player?.playing && !player?.paused && !onBreak));

  applyTheme(player?.palette);

  renderEffects(player?.filters);

  if (trackChanged) animate(document.querySelector('.now-playing'), 'track-transition');
  $('record-art').style.backgroundImage = current?.artworkUrl ? `url("${artwork(current.artworkUrl)}")` : '';

  if (onBreak) {
    const breakUntil = player?.breakUntil || 0;
    const remaining = Math.max(0, Math.ceil((breakUntil - Date.now()) / 1000));
    const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
    const seconds = String(remaining % 60).padStart(2, '0');
    $('track-title').textContent = 'Taking a short break';
    $('track-artist').textContent = 'The bot needs a moment to recover. Music will resume shortly.';
    $('track-source').textContent = 'BREAK';
    $('break-indicator').classList.add('visible');
    $('break-subtitle').textContent = `Resuming in ${minutes}:${seconds}`;
  } else {
    $('break-indicator').classList.remove('visible');
    $('track-title').textContent = current?.title || 'Nothing playing';
    $('track-artist').textContent = current?.author || 'Start a track from Discord or this Activity.';
    $('track-source').textContent = player?.paused ? 'PAUSED' : player?.playing ? 'NOW PLAYING' : 'WAITING FOR MUSIC';
  }

  const position = player?.position || 0, duration = current?.duration || 0;
  $('position').textContent = format(position);
  $('duration').textContent = format(duration);
  $('progress-fill').style.width = duration ? `${Math.min(100, position / duration * 100)}%` : '0%';
  //
  updateControlStates();
  //
  $('details').innerHTML = [
    current?.requester?.username && `<span class="chip requester">${current.requester.avatar ? `<img src="${escapeHtml(current.requester.avatar)}" alt="">` : ''}REQUESTED BY ${escapeHtml(current.requester.username)}</span>`
  ].filter(Boolean).join('');
  //
  const queue = data?.queue || [];
  const related = data?.relatedTracks || [];
  const queueKey = queue.map(track => `${track.encoded || track.uri || ''}:${track.title}:${track.index}`).join('|');
  const relatedKey = related.map(track => `${track.uri || ''}:${track.title}:${track.author}`).join('|');
  if (queueKey !== state.queueKey || relatedKey !== state.relatedKey) {
    state.queueKey = queueKey;
    state.relatedKey = relatedKey;
    const queueHtml = queue.map(track => `<div class="queue-item" draggable="true" data-index="${track.index}"><span class="queue-index">${String(track.index + 1).padStart(2, '0')}</span><span class="queue-art" style="background-image:url('${artwork(track.artworkUrl)}')"></span><span><div class="queue-title ticker"><span class="ticker-text">${escapeHtml(track.title)}</span></div><div class="queue-author ticker"><span class="ticker-text">${escapeHtml(track.author)}</span></div></span><button class="remove" data-remove="${track.index}" title="Remove">×</button></div>`).join('');

    if (related.length && relatedKey !== state.relatedKey) {
      related.forEach(t => { if (t.artworkUrl) { const i = new Image(); i.src = artwork(t.artworkUrl); } });
    }
    const relatedHtml = related.length > 0
      ? `<div class="related-divider"><span class="related-label">RELATED TRACKS</span></div>` +
      related.map((track, idx) => `<div class="queue-item related-item" data-related-index="${idx}"><span class="queue-art" style="background-image:url('${artwork(track.artworkUrl)}')"></span><span><div class="queue-title ticker"><span class="ticker-text">${escapeHtml(track.title)}</span></div><div class="queue-author ticker"><span class="ticker-text">${escapeHtml(track.author)}</span></div></span><button class="add-related" data-related-index="${idx}" title="Add to queue">+</button></div>`).join('')
      : '';
    $('queue').innerHTML = (queueHtml || '<p class="idle">Queue is clean.</p>') + relatedHtml;
    refreshTickers();
    animate($('queue'), 'content-transition');
  }
  //
  const lyrics = data?.lyrics || [];
  const active = lyrics.reduce((best, line, index) => line.time <= position ? index : best, -1);
  const lyricsKey = lyrics.map(line => `${line.time}:${line.text}`).join('|');
  if (lyricsKey !== state.lyricsKey) {
    state.lyricsKey = lyricsKey;
    $('lyrics').innerHTML = lyrics.length
      ? lyrics.map((line, index) => `<div class="lyric ${index === active ? 'active' : ''}" data-lyric="${index}">${escapeHtml(line.text)}</div>`).join('')
      : '<p class="idle">Lyrics appear here when available.</p>';
    animate($('lyrics'), 'content-transition');

    const savedLyrics = loadState('lyrics_open', null);
    if (savedLyrics === null) {
      const wasAuto = state.lyricsAutoState === true;
      if (lyrics.length === 0 && state.openPanel === 'lyrics') {
        closePanel('lyrics');
        state.lyricsAutoState = true;
      } else if (lyrics.length > 0 && state.openPanel !== 'lyrics' && wasAuto) {
        openPanel('lyrics');
        state.lyricsAutoState = true;
      }
    }
  } else if (active !== state.activeLyric) {
    document.querySelector(`[data-lyric="${state.activeLyric}"]`)?.classList.remove('active');
    const nextLyric = document.querySelector(`[data-lyric="${active}"]`);
    nextLyric?.classList.add('active');
    if (lyricsAutoScroll) nextLyric?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  state.activeLyric = active;
  updateRPC();
}

function escapeHtml(value = '') { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }

function showTopLoading() {
  const target = $('search-results');
  const wrap = document.querySelector('.search-wrap');
  state.searching = true;
  wrap.classList.add('searching');
  target.innerHTML = '<div class="search-result searching"><strong>Loading trending tracks…</strong></div>';
  target.classList.add('open');
}

function renderSearch(results, label) {
  const target = $('search-results');
  const wrap = document.querySelector('.search-wrap');
  const query = $('search')?.value.trim() || '';

  if (label !== 'Trending' && !query && results !== null) {
    state.searching = false;
    if (wrap) wrap.classList.remove('searching');
    if (target) {
      target.innerHTML = '';
      target.classList.remove('open');
    }
    return;
  }
  if (results === null) {
    state.searching = true;
    wrap.classList.add('searching');
    target.innerHTML = '<div class="search-result searching"><strong>Searching…</strong><small>Finding tracks from this source.</small></div>';
    target.classList.add('open');
    return;
  }
  const wasSearching = state.searching;
  state.searching = false;
  wrap.classList.remove('searching');
  state.searchResults = results;

  if (results.length === 0 && wasSearching) {
    const currentSource = state.searchSource || 'this';
    const labels = { youtube: 'YouTube', youtubemusic: 'YouTube Music', soundcloud: 'SoundCloud', spotify: 'Spotify', deezer: 'Deezer', applemusic: 'Apple Music', tidal: 'Tidal' };
    const otherSources = (state.availableSources || []).filter(s => s !== currentSource);
    const nextSource = otherSources[0];
    const nextLabel = labels[nextSource] || nextSource;
    target.innerHTML = `<div class="search-no-results"><strong>No matches found</strong><small>Try a different title or artist, or switch sources.</small>${nextSource ? `<button class="try-source" data-try-source="${nextSource}">TRY ${nextLabel.toUpperCase()}</button>` : ''}</div>`;
  } else {
    const header = label ? `<div class="search-header">${escapeHtml(label)}</div>` : '';
    target.innerHTML = header + results.map((track, index) => {
      const author = track.author || '';
      const isUnknown = /^unknown/i.test(author);
      const durationStr = track.duration ? format(track.duration) : '';
      const sep = author && durationStr ? ' • ' : '';
      const authorText = (!author || isUnknown) ? '' : `${escapeHtml(author)}${sep}`;
      return `<div class="search-result" data-result="${index}"><strong>${escapeHtml(track.title)}</strong><small>${authorText}${durationStr}</small></div>`;
    }).join('') || '<div class="search-result searching"><strong>No matches found</strong><small>Try another title or artist.</small></div>';
  }
  target.classList.toggle('open', results.length > 0 || wasSearching);
}

function connectSocket(auth) {
  const url = new URL('/ws', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  state.socket = socket;
  socket.onopen = () => { setConnection('AUTHENTICATING…'); send({ type: 'auth', ...auth }); };
  socket.onerror = () => setConnection('CONNECTION FAILED', 'error');
  socket.onclose = event => { setConnection(`RECONNECTING (${event.code || 'NETWORK'})`, 'error'); setTimeout(() => connectActivity(), 2000); };
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'ready') {
      $('voice-screen').classList.remove('visible');
      $('shell').style.display = '';
      state.snapshot = message.state;
      if (message.user) state.currentUser = message.user;
      if (Array.isArray(message.scopes)) state.scopes = message.scopes;
      if (message.accessToken && state.sdk) {
        state.sdk.commands.authenticate({ access_token: message.accessToken }).then(auth => {
          state.auth = auth;
          hasRpcScope = true;
          updateRPC();
        }).catch(() => {});
      }
      setSearchSources(message.search);
      setConnection('CONNECTED', 'ready');
      restorePanelStates();
      if (message.rateAggro) {
        state.searchDebounce = 1200;
        state.filterCooldown = 4000;
        state.buttonCooldown = 5000;
      }
      render();
    } else if (message.type === 'reauth-ok') {
      if (Array.isArray(message.scopes)) state.scopes = message.scopes;
      if (message.accessToken && state.sdk) {
        state.sdk.commands.authenticate({ access_token: message.accessToken }).then(auth => {
          state.auth = auth;
          hasRpcScope = true;
          toast('Rich Presence permission granted');
          applyRpcMode(state.pendingRpcMode || 'full');
        }).catch(() => {
          applyRpcMode('off');
        });
      } else {
        hasRpcScope = true;
        toast('Rich Presence permission granted');
        applyRpcMode(state.pendingRpcMode || 'full');
      }
    } else if (message.type === 'state') {
      state.snapshot = message;
      render();
    } else if (message.type === 'search-results') renderSearch(message.results);
    else if (message.type === 'top-results') renderSearch(message.results, 'Trending');
    else if (message.type === 'playlist-added') {
      toast(`${message.count} tracks added from playlist`);
      $('search').value = '';
      renderSearch([]);
    } else if (message.type === 'track-added') {
      toast(`Added ${message.track?.title || 'track'} to the queue`);
      $('search').value = '';
      renderSearch([]);
    } else if (message.type === 'error') { toast(message.message); setConnection('ACTIVITY ERROR', 'error'); }
  };
}

async function connectActivity() {
  try {
    setConnection('CONNECTING TO DISCORD…');
    const { DiscordSDK } = await import('/activity/sdk/index.mjs');
    const config = await fetch('/config').then(response => response.json());
    state.config = config;
    if (config.botAvatar) $('brand-avatar').src = config.botAvatar;
    if (config.botName) {
      const cleaned = config.botName.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
      $('brand-name').textContent = cleaned;
      document.title = `${config.botName} Music`;
    }
    const sdk = new DiscordSDK(config.clientId);
    state.sdk = sdk;
    await withTimeout(sdk.ready(), 10000, 'Discord Activity handshake timed out.');
    const applyLayoutMode = update => {
      const isPip = update?.layout_mode === 1 || update?.is_pip === true;
      document.documentElement.classList.toggle('pip', isPip);
    };
    sdk.commands.setConfig({ use_interactive_pip: true }).catch(() => { });
    sdk.subscribe('ACTIVITY_LAYOUT_MODE_UPDATE', applyLayoutMode).catch(() => { });
    sdk.subscribe('ACTIVITY_PIP_MODE_UPDATE', applyLayoutMode).catch(() => { });
    setConnection('AUTHORIZING…');
    const { code } = await withTimeout(sdk.commands.authorize({ client_id: config.clientId, response_type: 'code', prompt: 'none', scope: ['identify', 'guilds', 'rpc.activities.write'] }), 10000, 'Discord authorization timed out.');
    if (!sdk.guildId || !sdk.channelId) throw new Error(`Launch ${config.botName || 'Lunar'} Activity from a guild voice channel.`);
    connectSocket({ code, guildId: sdk.guildId, channelId: sdk.channelId });
  } catch (error) {
    const msg = error.message || '';
    setConnection('DISCORD SETUP REQUIRED', 'error');

    if (/voice channel/i.test(msg) || /guild/i.test(msg) || /dm/i.test(msg)) {
      const screen = $('voice-screen');
      if (screen) {
        if (/different/i.test(msg) || /bot['’]s voice channel/i.test(msg)) {
          const bName = state.config?.botName || 'Lunar';
          $('voice-screen-title').textContent = `${bName} is in Another Channel`;
          $('voice-screen-message').textContent = `${bName} is playing music in a different voice channel. Join that channel or use /stop to move it.`;
        } else {
          $('voice-screen-title').textContent = 'Voice Channel Required';
          $('voice-screen-message').textContent = 'Open this Activity from a voice channel to control the music.';
        }
        screen.classList.add('visible');
        $('shell').style.display = 'none';
        return;
      }
    }
    toast(msg || 'Unable to connect to Discord Activity');
  }
}
//
function isWideScreen() { return window.innerWidth >= 1100; }

function openPanel(name) {
  const overlay = $(`${name}-overlay`);
  const toggle = $(`toggle-${name}`);
  if (!overlay || !toggle) return;
  if (!isWideScreen() && state.openPanel && state.openPanel !== name) closePanel(state.openPanel);
  overlay.classList.add('open');
  toggle.classList.add('active');
  if (!isWideScreen()) state.openPanel = name;
  saveState(`${name}_open`, true);
}

function closePanel(name) {
  const overlay = $(`${name}-overlay`);
  const toggle = $(`toggle-${name}`);
  if (!overlay || !toggle) return;
  overlay.classList.remove('open');
  toggle.classList.remove('active');
  if (!isWideScreen() && state.openPanel === name) state.openPanel = null;
  saveState(`${name}_open`, false);
}

function togglePanel(name) {
  const overlay = $(`${name}-overlay`);
  if (overlay?.classList.contains('open')) closePanel(name);
  else openPanel(name);
}

function restorePanelStates() {
  if (isWideScreen()) {
    document.querySelectorAll('.overlay-panel').forEach(p => p.classList.add('open'));
    document.querySelectorAll('.panel-toggle').forEach(b => b.classList.add('active'));
  } else {
    if (loadState('queue_open', false)) openPanel('queue');
    if (loadState('lyrics_open', false)) openPanel('lyrics');
  }
}

window.addEventListener('resize', () => {
  const wide = isWideScreen();
  if (wide) {
    document.querySelectorAll('.overlay-panel').forEach(p => p.classList.add('open'));
    document.querySelectorAll('.panel-toggle').forEach(b => b.classList.add('active'));
    state.openPanel = null;
  } else {
    const wasOpen = [...document.querySelectorAll('.overlay-panel.open')].map(p => p.id.replace('-overlay', ''));
    document.querySelectorAll('.overlay-panel').forEach(p => p.classList.remove('open'));
    document.querySelectorAll('.panel-toggle').forEach(b => b.classList.remove('active'));
    state.openPanel = null;
    wasOpen.forEach(name => openPanel(name));
  }
});
//
function addRipple(btn, event) {
  const ripple = document.createElement('span');
  ripple.classList.add('ripple');
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${(event.clientX || rect.left + rect.width / 2) - rect.left - size / 2}px`;
  ripple.style.top = `${(event.clientY || rect.top + rect.height / 2) - rect.top - size / 2}px`;
  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}
//
$('search').addEventListener('focus', () => {
  if ($('search').value.trim()) return;
  if (state.socket?.readyState !== WebSocket.OPEN || !state.snapshot) return;
  if (state.topTracksLoaded) { renderSearch(state.searchResults.length ? state.searchResults : []); return; }
  showTopLoading();
  send({ type: 'top-tracks' });
  state.topTracksLoaded = true;
});

$('search').addEventListener('input', event => {
  clearTimeout(state.searchTimer);
  const query = event.target.value.trim();
  if (!query) {
    if (state.socket?.readyState === WebSocket.OPEN && state.snapshot) {
      if (state.topTracksLoaded) { renderSearch(state.searchResults.length ? state.searchResults : []); return; }
      showTopLoading();
      send({ type: 'top-tracks' });
      state.topTracksLoaded = true;
    }
    return;
  }
  state.topTracksLoaded = false;
  if (state.socket?.readyState !== WebSocket.OPEN || !state.snapshot) { toast('Finish connecting the Activity before searching.'); return; }
  if (DIRECT_URL_RE.test(query)) {
    clearTimeout(state.searchTimer);
    const source = sourceFromUrl(query); if (source) selectSearchSource(source, false);
    state.searching = false; document.querySelector('.search-wrap')?.classList.remove('searching');
    $('search-results').innerHTML = '<div class="search-result searching"><strong>Press Enter to add this link</strong><small>It will be resolved directly by the music node.</small></div>';
    $('search-results').classList.add('open');
    return;
  }
  renderSearch(null);
  state.searchTimer = setTimeout(() => send({ type: 'search', query, source: state.searchSource }), state.searchDebounce);
});

$('search').addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  const query = $('search').value.trim();
  if (!query) return;
  if (!DIRECT_URL_RE.test(query)) return;
  event.preventDefault();
  event.stopPropagation();
  if (state.socket?.readyState !== WebSocket.OPEN || !state.snapshot) { toast('Finish connecting the Activity before searching.'); return; }
  clearTimeout(state.searchTimer);
  renderSearch(null);
  send({ type: 'search', query: normalizeDirectUrl(query), source: null });
});

$('source-toggle').addEventListener('click', () => {
  const picker = $('source-picker');
  const open = picker.classList.toggle('open');
  $('source-toggle').setAttribute('aria-expanded', String(open));
});

$('source-menu').addEventListener('click', event => {
  const option = event.target.closest('[data-source]');
  if (!option) return;
  const source = option.dataset.source;
  selectSearchSource(source, true);
  $('source-picker').classList.remove('open');
  $('source-toggle').setAttribute('aria-expanded', 'false');
  const query = $('search').value.trim();
  if (query) $('search').dispatchEvent(new Event('input'));
});

document.addEventListener('click', event => {
  if (!event.target.closest('#source-picker')) {
    $('source-picker').classList.remove('open');
    $('source-toggle').setAttribute('aria-expanded', 'false');
  }
  if (!event.target.closest('.search-wrap')) {
    $('search-results').classList.remove('open');
    document.querySelector('.search-wrap')?.classList.remove('searching');
  }
});

$('search-results').addEventListener('click', event => {
  const row = event.target.closest('[data-result]');
  if (row) {
    clearTimeout(state.searchTimer);
    send({ type: 'enqueue', index: Number(row.dataset.result) });
    $('search').value = '';
    $('search').blur();
    renderSearch([]);
    return;
  }
  const tryBtn = event.target.closest('[data-try-source]');
  if (tryBtn) {
    const source = tryBtn.dataset.trySource;
    state.searchSource = source;
    saveState('source', source);
    const labels = { youtube: 'YouTube', youtubemusic: 'YouTube Music', soundcloud: 'SoundCloud', spotify: 'Spotify', deezer: 'Deezer', applemusic: 'Apple Music', tidal: 'Tidal', monochrome: 'Monochrome' };
    const icons = { spotify: 'emojis/spotify.webp', applemusic: 'emojis/apple_music.webp', deezer: 'emojis/deezer.webp', tidal: 'emojis/tidal.webp', soundcloud: 'emojis/soundcloud.webp', youtube: 'emojis/youtube.png', youtubemusic: 'emojis/youtube_music.png', monochrome: 'emojis/headphones.webp' };
    $('source-label').textContent = labels[source] || source;
    $('source-icon').src = `/assets/${icons[source] || 'emojis/headphones.webp'}`;
    document.querySelectorAll('.source-option').forEach(item => {
      const selected = item.dataset.source === source;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-selected', String(selected));
    });
    const query = $('search').value.trim();
    if (query) $('search').dispatchEvent(new Event('input'));
  }
});

$('queue').addEventListener('click', event => {
  const removeBtn = event.target.closest('[data-remove]');
  if (removeBtn) { send({ type: 'queue-remove', index: Number(removeBtn.dataset.remove) }); return; }
  const addBtn = event.target.closest('[data-related-index]');
  if (addBtn) {
    const index = Number(addBtn.dataset.relatedIndex);

    const item = addBtn.closest('.related-item');
    if (item) item.style.opacity = '0.3';
    send({ type: 'add-related', index });
  }
});

$('queue').addEventListener('dragstart', event => { const row = event.target.closest('[data-index]'); if (!row) return; state.dragIndex = Number(row.dataset.index); row.classList.add('dragging'); });
$('queue').addEventListener('dragend', event => event.target.closest('[data-index]')?.classList.remove('dragging'));
$('queue').addEventListener('dragover', event => event.preventDefault());
$('queue').addEventListener('drop', event => { event.preventDefault(); const row = event.target.closest('[data-index]'); if (row && Number.isInteger(state.dragIndex)) send({ type: 'queue-move', from: state.dragIndex, to: Number(row.dataset.index) }); state.dragIndex = null; });

//
$('toggle-queue').addEventListener('click', () => togglePanel('queue'));
$('toggle-lyrics').addEventListener('click', () => togglePanel('lyrics'));
document.querySelectorAll('.overlay-close').forEach(btn => btn.addEventListener('click', () => closePanel(btn.dataset.close)));
//
const lyricsAutoBtn = $('lyrics-auto');
function applyLyricsAutoScroll() {
  lyricsAutoBtn.classList.toggle('active', lyricsAutoScroll);
  lyricsAutoBtn.setAttribute('aria-pressed', String(lyricsAutoScroll));
  lyricsAutoBtn.title = lyricsAutoScroll ? 'Auto-scroll on' : 'Auto-scroll off';
  document.documentElement.toggleAttribute('data-lyrics-scroll', lyricsAutoScroll);
}
applyLyricsAutoScroll();
lyricsAutoBtn.addEventListener('click', () => {
  lyricsAutoScroll = !lyricsAutoScroll;
  saveState('lyrics_auto_scroll', lyricsAutoScroll);
  applyLyricsAutoScroll();
});
//
$('effects').addEventListener('click', event => {
  const btn = event.target.closest('[data-effect]');
  if (!btn) return;
  const name = btn.dataset.effect;
  if (isOnCooldown(name)) return;
  setCooldown(name);

  btn.classList.toggle('active');
  btn.toggleAttribute('data-active');
  send({ type: 'toggle-filter', filter: name });
});
//
$('btn-play').addEventListener('click', event => {
  const player = state.snapshot?.player;
  if (!player?.current) return;
  const action = player.paused ? 'resume' : 'pause';
  if (isOnCooldown(action)) return;
  addRipple($('btn-play'), event);
  setCooldown(action);
  send({ type: action });
});

$('btn-skip').addEventListener('click', event => {
  if (isOnCooldown('skip') || !state.snapshot?.player?.queueLength) return;
  addRipple($('btn-skip'), event);
  setCooldown('skip');
  send({ type: 'skip' });
});

$('btn-back').addEventListener('click', event => {
  const player = state.snapshot?.player;
  if (isOnCooldown('back') || !player?.current) return;
  const position = getPlaybackPosition();
  const canPrev = Boolean(player.hasPrevious);
  if (position <= 10000 && !canPrev) return;

  addRipple($('btn-back'), event);
  setCooldown('back');
  send({ type: 'back' });
});
//
const canvas = $('visualizer'), ctx = canvas.getContext('2d');
let lastFrameTime = 0;
const VIZ_MODES = ['auto', 'wave'];
let vizMode = loadState('viz-mode', 'auto');
let currentMode = vizMode === 'auto' ? 0 : 0;
let nextMode = 0;
let modeTimer = 0;
let modeDuration = randomModeDuration();
let transitioning = false;
let transitionProgress = 0;
const TRANSITION_MS = 2000;
const MODE_COUNT = 1;
let waveIntensity = 0.5;

function randomModeDuration() { return 8000 + Math.random() * 27000; }

const vizBtn = $('viz-mode');
function applyVizMode(mode) {
  vizMode = mode;
  saveState('viz-mode', mode);
  document.documentElement.setAttribute('data-viz-mode', mode);
  if (mode !== 'auto') {
    currentMode = VIZ_MODES.indexOf(mode) - 1;
    transitioning = false;
    transitionProgress = 0;
    modeTimer = 0;
  }
}
applyVizMode(vizMode);
vizBtn.addEventListener('click', () => {
  const idx = VIZ_MODES.indexOf(vizMode);
  applyVizMode(VIZ_MODES[(idx + 1) % VIZ_MODES.length]);
});

const JAM_MESSAGES = [
  'Listening to some jams',
  'Vibing to the queue',
  'Enjoying the tunes',
  'Chilling with music',
  'Listening with the squad',
  'Jumping to the beat',
  'Grooving along',
  'Jamming in voice',
  'Listening to group queue',
  'Riding the soundwaves'
];

const RPC_MODES = ['full', 'limited', 'off'];
let rpcMode = loadState('rpc-mode', 'full');
let currentRpcTrackKey = null;
let currentJamMessage = JAM_MESSAGES[0];

const rpcBtn = $('rpc-mode');
function applyRpcMode(mode) {
  rpcMode = mode;
  saveState('rpc-mode', mode);
  document.documentElement.setAttribute('data-rpc-mode', mode);
  if (rpcBtn) {
    rpcBtn.setAttribute('data-rpc-mode', mode);
    rpcBtn.title = mode === 'full' ? 'RPC: Full' : mode === 'limited' ? 'RPC: Limited (Mine Only)' : 'RPC: Off';
    rpcBtn.setAttribute('aria-label', `Rich Presence: ${mode}`);
  }
  updateRPC();
}
applyRpcMode(rpcMode);

let hasRpcScope = true;

async function reauthorizeRPC() {
  if (!state.sdk || !state.config?.clientId) return false;
  try {
    toast('Opening Discord permission prompt…');
    const res = await state.sdk.commands.authorize({
      client_id: state.config.clientId,
      response_type: 'code',
      prompt: 'consent',
      scope: ['identify', 'guilds', 'rpc.activities.write']
    });
    if (res?.code) {
      hasRpcScope = true;
      try { send({ type: 'reauth', code: res.code, guildId: state.sdk.guildId, channelId: state.sdk.channelId }); } catch {}
      return true;
    }
  } catch (error) {
    toast(error.message || 'Permission prompt declined');
  }
  return false;
}

if (rpcBtn) {
  rpcBtn.addEventListener('click', async () => {
    const idx = RPC_MODES.indexOf(rpcMode);
    const nextMode = RPC_MODES[(idx + 1) % RPC_MODES.length];
    if (nextMode !== 'off' && hasRpcScope === false) {
      state.pendingRpcMode = nextMode;
      const success = await reauthorizeRPC();
      if (!success) return;
    }
    applyRpcMode(nextMode);
  });
}

function resolveFullImageUrl(url) {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${window.location.origin}${url}`;
  return url;
}

function isStandardYouTubeTrack(track) {
  if (!track) return false;
  const source = String(track.sourceName || '').toLowerCase();
  const uri = String(track.uri || track.url || '').toLowerCase();
  const isYtm = source === 'youtubemusic' || source === 'ytmsearch' || uri.includes('music.youtube.com');
  if (isYtm) return false;
  return source === 'youtube' || source === 'ytsearch' || uri.includes('youtube.com') || uri.includes('youtu.be');
}

function updateRPC() {
  if (!state.sdk) return;
  if (rpcMode === 'off') {
    if (currentRpcTrackKey !== 'off') {
      currentRpcTrackKey = 'off';
      state.sdk.commands.setActivity({ activity: null }).catch(() => {});
    }
    return;
  }

  const player = state.snapshot?.player;
  const current = player?.current;
  if (!current || !player?.playing || player?.paused || player?.onBreak || isStandardYouTubeTrack(current)) {
    if (currentRpcTrackKey !== 'idle') {
      currentRpcTrackKey = 'idle';
      state.sdk.commands.setActivity({ activity: null }).catch(() => {});
    }
    return;
  }

  const isMySong = Boolean(
    current.requester?.id &&
    state.currentUser?.id &&
    String(current.requester.id) === String(state.currentUser.id)
  );

  const trackKey = `${current.encoded || ''}:${current.uri || ''}:${current.title}:${current.author}`;
  if (trackKey !== currentRpcTrackKey) {
    currentRpcTrackKey = trackKey;
    const randomIndex = Math.floor(Math.random() * JAM_MESSAGES.length);
    currentJamMessage = JAM_MESSAGES[randomIndex];
  }

  const botName = state.config?.botName || 'Lunar';
  const botBranding = `${botName} Music`;
  const botAvatar = state.config?.botAvatar ? resolveFullImageUrl(state.config.botAvatar) : undefined;
  const largeArt = resolveFullImageUrl(current.artworkUrl) || botAvatar;
  const now = Date.now();
  const position = Number(player.position) || 0;
  const duration = Number(current.duration) || 0;

  const handleRpcError = err => {
    if (err && /scope|permission|denied|unauthorized|4001/i.test(err.message || String(err))) {
      hasRpcScope = false;
      applyRpcMode('off');
    }
  };

  if (rpcMode === 'full' || (rpcMode === 'limited' && isMySong)) {
    const titleText = String(current.title || 'Unknown Track').slice(0, 128);
    const authorText = current.author ? String(current.author).slice(0, 60) : '';
    const stateText = authorText ? `Listening to ${authorText}`.slice(0, 128) : 'Listening to music';
    const timestamps = duration > 0 ? {
      start: Math.round(now - position),
      end: Math.round(now + Math.max(0, duration - position))
    } : {
      start: Math.round(now - position)
    };

    state.sdk.commands.setActivity({
      activity: {
        details: titleText,
        state: stateText,
        assets: {
          large_image: largeArt,
          large_text: titleText,
          small_image: botAvatar,
          small_text: botBranding
        },
        timestamps
      }
    }).then(() => { hasRpcScope = true; }).catch(handleRpcError);
  } else {
    state.sdk.commands.setActivity({
      activity: {
        details: currentJamMessage,
        state: botBranding,
        assets: {
          large_image: botAvatar,
          large_text: botBranding,
          small_image: botAvatar,
          small_text: botBranding
        },
        timestamps: {
          start: Math.round(now - position)
        }
      }
    }).then(() => { hasRpcScope = true; }).catch(handleRpcError);
  }
}
function lerp(a, b, t) { return a + (b - a) * Math.min(1, Math.max(0, t)); }
function lerpColor(c1, c2, t) {
  return { r: Math.round(lerp(c1.r, c2.r, t)), g: Math.round(lerp(c1.g, c2.g, t)), b: Math.round(lerp(c1.b, c2.b, t)) };
}
function easeInOut(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

function drawWave(w, h, pos, energy, col1, col2, alpha, bpm) {
  const beatPulse = bpm && bpm >= 40 && bpm <= 300
    ? (() => { const beat = pos / (60000 / bpm); const phase = beat - Math.floor(beat); const hit = Math.pow(1 - phase, 7); const downbeat = Math.floor(beat) % 4 === 0 ? 1 : 0.55; return hit * downbeat; })()
    : Math.abs(Math.sin(pos / 280)) * 0.5 + Math.abs(Math.sin(pos / 480 + 1.3)) * 0.3 + Math.abs(Math.sin(pos / 160 + 2.7)) * 0.2;
  const target = 0.35 + beatPulse * 0.65 * energy;
  waveIntensity = lerp(waveIntensity, target, 0.06);

  const layers = 4;
  for (let l = 0; l < layers; l++) {
    const ly = h * (0.33 + l * 0.11);
    const amp = h * 0.055 * energy * (1 - l * 0.12);
    const freq = 0.0025 + l * 0.0008;
    const speed = pos / (280 + l * 70);

    ctx.beginPath();
    ctx.moveTo(0, ly);
    for (let x = 0; x <= w; x += 2) {
      const wave = Math.sin(x * freq + speed) * amp +
        Math.sin(x * freq * 1.8 + speed * 0.6 + l) * amp * 0.35 +
        Math.sin(x * freq * 0.4 + speed * 1.4 + l * 2) * amp * 0.25;
      ctx.lineTo(x, ly + wave);
    }
    const c = lerpColor(col1, col2, l / layers);
    const baseW = 1.2 + waveIntensity * 3.3 - l * 0.4;
    ctx.shadowColor = `rgba(${c.r},${c.g},${c.b},${alpha * 0.8 * energy})`;
    ctx.shadowBlur = 10 + waveIntensity * 18 * (1 - l * 0.15);
    ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${alpha * (0.4 - l * 0.05)})`;
    ctx.lineWidth = Math.max(1, baseW);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

const modeFns = [drawWave];

function draw(time) {
  requestAnimationFrame(draw);
  if (time - lastFrameTime < 16) return;
  lastFrameTime = time;

  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const w = innerWidth, h = innerHeight;
  const player = state.snapshot?.player;
  const now = Date.now();
  const speed = player?.filters?.nightcore ? 1.15 : player?.filters?.vaporwave ? 0.85 : 1.0;
  const pos = (player?.position || 0) + (player?.playing && !player?.paused ? Math.min(now - (player?.updatedAt || now), 2000) * speed : 0);
  const playing = player?.playing && !player?.paused;
  const energy = playing ? 1 : 0.1;
  const col1 = state.accent || hexToRgb('#8c6cff');
  const col2 = state.secondary || hexToRgb('#64b4ff');
  const col3 = state.tertiary || hexToRgb('#ff78b4');
  const shade1 = { r: Math.min(255, col1.r + 60), g: Math.min(255, col1.g + 60), b: Math.min(255, col1.b + 60) };
  const shade2 = { r: Math.max(0, col2.r - 40), g: Math.max(0, col2.g - 40), b: Math.max(0, col2.b - 40) };
  const shade3 = { r: Math.min(255, col3.r + 40), g: Math.min(255, col3.g + 40), b: Math.min(255, col3.b + 40) };
  const mix1 = lerpColor(col1, col2, 0.5);
  const mix2 = lerpColor(col2, col3, 0.4);

  ctx.clearRect(0, 0, w, h);
  //
  const hadTrack = Boolean(player?.current);
  drawArtworkBg(w, h, playing, hadTrack);
  //
  const bg = ctx.createRadialGradient(w / 2, h * 0.44, 0, w / 2, h * 0.45, Math.max(w, h) * 0.7);
  bg.addColorStop(0, rgba(col1, 0.18));
  bg.addColorStop(0.3, rgba(col2, 0.04));
  bg.addColorStop(0.6, rgba(col3, 0.02));
  bg.addColorStop(1, 'rgba(6,5,13,.96)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  if (vizMode === 'auto') {
    modeTimer += 16;
    if (!transitioning && modeTimer >= modeDuration - TRANSITION_MS) {
      transitioning = true;
      transitionProgress = 0;
      nextMode = (currentMode + 1) % MODE_COUNT;
    }

    if (transitioning) {
      transitionProgress += 16 / TRANSITION_MS;
      if (transitionProgress >= 1) {
        transitionProgress = 0;
        transitioning = false;
        currentMode = nextMode;
        nextMode = (currentMode + 1) % MODE_COUNT;
        modeTimer = 0;
        modeDuration = randomModeDuration();
      }
    }
  }

  const outAlpha = transitioning ? 1 - easeInOut(transitionProgress) : 1;
  modeFns[currentMode](w, h, pos, energy, mix1, shade3, outAlpha, player?.current?.bpm || null);
  updateControlStates();
}
requestAnimationFrame(draw);
//
function startPreview() {
  const now = Date.now();
  state.snapshot = {
    player: {
      playing: true, paused: false, position: 97400, updatedAt: now,
      current: { title: 'Midnight City', author: 'M83', duration: 244000, artworkUrl: 'https://i.scdn.co/image/ab67616d0000b2731ab3f157a98a8a1b2812e5f8', requester: { username: 'lunar listener' } },
      palette: { accent: '#6a4cff', secondary: '#4a9fff', tertiary: '#ff6b9d' },
      filters: { nightcore: true },
      hasPrevious: true, queueLength: 2
    },
    queue: [
      { index: 0, title: 'Crimewave', author: 'Crystal Castles', duration: 258000, artworkUrl: 'https://i.scdn.co/image/ab67616d0000b273f9e369e5f7fb7a2d6f5c2b47' },
      { index: 1, title: 'Genesis', author: 'Grimes', duration: 258000, artworkUrl: 'https://i.scdn.co/image/ab67616d0000b273a048415d3f7167a2c8b0f5c7' }
    ],
    lyrics: [
      { time: 90000, text: 'The city is my church' },
      { time: 96000, text: 'It wraps me in its blinding twilight' },
      { time: 103000, text: 'The skyline is a quiet dream' },
      { time: 110000, text: 'And we are dancing through the night' }
    ]
  };

  loadArtwork(state.snapshot.player.current.artworkUrl, 128);
  $('connection').textContent = 'LOCAL VISUAL PREVIEW';
  render();
  setInterval(() => { state.snapshot.player.position = Math.min(state.snapshot.player.current.duration, state.snapshot.player.position + 1000); render(); }, 1000);
}

if (previewMode) startPreview(); else connectActivity();
// contributors: @relentiousdragon, @paccman-0