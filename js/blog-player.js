/*!
 * blog-player.js —— 全站音乐播放器
 * -----------------------------------------------------------------------------
 * 曲目：我爱你（ウォーアイニー）
 *       高橋瞳 × BEAT CRUSADERS —— TV 动画《银魂》ED14（第 164–176 话）
 *
 * 两种形态：
 *   1) 全站迷你播放器：固定于左下角（fixed + mini），任意页面可用；
 *   2) 音乐页播放器：/music/ 页面使用完整播放器，并与黑胶展示卡联动。
 *
 * 依赖：APlayer（由 _config.butterfly.yml 的 inject 引入；
 *      若 CDN 未命中，本脚本会自动切换到备用镜像，保证播放器始终可用）。
 * -----------------------------------------------------------------------------
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ 曲目配置 */

  var SONG = {
    name: '我爱你',
    artist: '高橋瞳 × BEAT CRUSADERS',
    // 网易云「外链」地址，浏览器可直接播放（自动 302 到 CDN）。
    // 备选（第三方 Meting 接口，稳定性取决于该服务）：
    //   https://api.injahow.cn/meting/?server=netease&type=url&id=4925813
    url: 'https://music.163.com/song/media/outer/url?id=4925813.mp3',
    cover: 'https://p3.music.126.net/4FRmPtwqiIe_hTvbXOxSJA==/5763639952926196.jpg?param=300y300',
    lrc: 'https://api.injahow.cn/meting/?server=netease&type=lrc&id=4925813'
  };

  var BRAND = { light: '#3b6df0', dark: '#6c8cff' };

  // 首屏副标题文案（与 _config.butterfly.yml 的 subtitle.sub 保持一致）
  var SUBTITLE_TEXT = '记录学习与生活 · 见证每一次成长';

  // 主 CDN 失效时的备用镜像
  var LIB_FALLBACK = [
    'https://unpkg.com/aplayer@1.10.1/dist/APlayer.min.js',
    'https://cdn.staticfile.org/aplayer/1.10.1/APlayer.min.js',
    'https://lib.baomitu.com/aplayer/1.10.1/APlayer.min.js'
  ];
  var CSS_FALLBACK = [
    'https://unpkg.com/aplayer@1.10.1/dist/APlayer.min.css',
    'https://cdn.staticfile.org/aplayer/1.10.1/APlayer.min.css',
    'https://lib.baomitu.com/aplayer/1.10.1/APlayer.min.css'
  ];

  /* ------------------------------------------------------------------ 工具 */

  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function brandColor() {
    return isDark() ? BRAND.dark : BRAND.light;
  }

  function loadSequential(urls, onDone, onFail) {
    var i = 0;
    (function next() {
      if (i >= urls.length) { onFail(); return; }
      var el = document.createElement('script');
      el.src = urls[i++];
      el.onload = onDone;
      el.onerror = next;
      document.head.appendChild(el);
    })();
  }

  function loadCssSequential(urls) {
    var i = 0;
    (function next() {
      if (i >= urls.length) return;
      var el = document.createElement('link');
      el.rel = 'stylesheet';
      el.href = urls[i++];
      el.onerror = next;
      document.head.appendChild(el);
    })();
  }

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  function warn(msg) {
    if (window.console && console.warn) console.warn('[blog-player] ' + msg);
  }

  /* ------------------------------------------------------------ 播放器配置 */

  function baseOptions(container, extra) {
    var opts = {
      container: container,
      theme: brandColor(),
      audio: [
        {
          name: SONG.name,
          artist: SONG.artist,
          url: SONG.url,
          cover: SONG.cover,
          lrc: SONG.lrc
        }
      ],
      lrcType: 3,        // 3 = 歌词以 URL 形式提供
      autoplay: false,
      loop: 'all',
      order: 'list',
      preload: 'none',   // 用户点击后才请求音频，节省流量
      volume: 0.75,
      mutex: true        // 同页多播放器互斥，避免叠音
    };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) opts[k] = extra[k];
      }
    }
    return opts;
  }

  /* -------------------------------------------------- 明暗主题切换时同步主色 */

  function bindThemeSync(player) {
    var btn = document.getElementById('darkmode');
    if (!btn) return;
    btn.addEventListener('click', function () {
      window.setTimeout(function () {
        if (player && typeof player.theme === 'function') player.theme(brandColor());
      }, 60);
    });
  }

  /* ------------------------------------------------------------ 音乐页播放器 */

  function initMusicPage() {
    var host = document.getElementById('music-page-player');
    if (!host) return false;

    var player = new window.APlayer(baseOptions(host, {
      fixed: false,
      mini: false,
      listFolded: false,
      listMaxHeight: '260px'
    }));

    var disc = document.querySelector('.vinyl-disc');
    var arm = document.querySelector('.vinyl-arm');
    var bar = document.querySelector('.vinyl-bar');
    var curEl = document.querySelector('.vinyl-time .t-cur');
    var totalEl = document.querySelector('.vinyl-time .t-total');
    var playBtn = document.querySelector('.v-play');
    var muteBtn = document.querySelector('.v-mute');
    var progressWrap = document.querySelector('.vinyl-progress');

    function setPlaying(on) {
      if (disc) disc.classList.toggle('is-playing', on);
      if (arm) arm.classList.toggle('is-playing', on);
      if (playBtn) {
        var icon = playBtn.querySelector('i');
        if (icon) icon.className = on ? 'fas fa-pause' : 'fas fa-play';
        playBtn.setAttribute('aria-label', on ? '暂停' : '播放');
        playBtn.setAttribute('title', on ? '暂停' : '播放');
      }
    }

    player.on('play', function () { setPlaying(true); });
    player.on('pause', function () { setPlaying(false); });
    player.on('ended', function () { setPlaying(false); });

    player.on('loadedmetadata', function () {
      if (totalEl && player.audio && isFinite(player.audio.duration)) {
        totalEl.textContent = fmt(player.audio.duration);
      }
    });

    player.on('timeupdate', function () {
      var a = player.audio;
      if (!a) return;
      var dur = a.duration;
      var pct = isFinite(dur) && dur > 0 ? (a.currentTime / dur) * 100 : 0;
      if (bar) bar.style.width = pct + '%';
      if (curEl) curEl.textContent = fmt(a.currentTime);
      if (totalEl && isFinite(dur) && dur > 0) totalEl.textContent = fmt(dur);
    });

    if (playBtn) {
      playBtn.addEventListener('click', function () { player.toggle(); });
    }

    if (muteBtn) {
      muteBtn.addEventListener('click', function () {
        var a = player.audio;
        if (!a) return;
        var icon = muteBtn.querySelector('i');
        if (a.volume > 0) {
          muteBtn.dataset.volume = String(a.volume);
          player.volume(0, true);
          if (icon) icon.className = 'fas fa-volume-xmark';
        } else {
          var v = parseFloat(muteBtn.dataset.volume || '0.75');
          player.volume(v, true);
          if (icon) icon.className = 'fas fa-volume-high';
        }
      });
    }

    // 点击进度条跳转
    if (progressWrap) {
      progressWrap.addEventListener('click', function (e) {
        var a = player.audio;
        if (!a || !isFinite(a.duration) || a.duration <= 0) return;
        var rect = progressWrap.getBoundingClientRect();
        var ratio = (e.clientX - rect.left) / rect.width;
        ratio = Math.min(1, Math.max(0, ratio));
        player.seek(a.duration * ratio);
      });
    }

    bindThemeSync(player);
    window.blogPlayer = player;
    return true;
  }

  /* -------------------------------------------------------- 全站迷你播放器 */

  function initGlobalMini() {
    var host = document.createElement('div');
    host.id = 'global-aplayer';
    host.setAttribute('aria-label', '全站音乐播放器');
    document.body.appendChild(host);

    var player = new window.APlayer(baseOptions(host, {
      fixed: true,
      mini: true,
      listFolded: false,
      listMaxHeight: '220px'
    }));

    bindThemeSync(player);
    window.blogPlayer = player;
  }

  /* ------------------------------------------------------------------ 启动 */

  function boot() {
    try {
      // 音乐页已自带完整播放器，则不再插入迷你播放器，避免重复控件与叠音。
      if (initMusicPage()) return;
      initGlobalMini();
    } catch (err) {
      warn('初始化失败：' + err);
    }
  }

  function withLib(cb) {
    if (window.APlayer) { cb(); return; }
    warn('主 CDN 未命中，正在切换备用镜像…');
    loadSequential(LIB_FALLBACK, cb, function () {
      warn('APlayer 加载失败，播放器功能不可用。');
    });
    loadCssSequential(CSS_FALLBACK);
  }

  withLib(function () {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  });

  /* -------------------------------------------------------- 首屏副标题兜底 */
  // 主题的打字机效果依赖 typed.js 外链。若该外链不可达（部分网络环境会失败），
  // 副标题会一直空白；这里在短暂等待后做一次静态补位，保证首屏信息完整。
  function ensureSubtitle() {
    var el = document.getElementById('subtitle');
    if (!el) return;
    if ((el.textContent || '').trim() !== '') return; // 打字机已产出内容
    el.textContent = SUBTITLE_TEXT;
  }

  function scheduleSubtitleFallback() {
    if (!document.getElementById('subtitle')) return;
    window.setTimeout(ensureSubtitle, 1800);
  }

  if (document.readyState === 'complete') {
    scheduleSubtitleFallback();
  } else {
    window.addEventListener('load', scheduleSubtitleFallback);
  }
  // pjax 返回首页时同样兜底（事件不存在时无副作用）
  document.addEventListener('pjax:complete', function () {
    window.setTimeout(ensureSubtitle, 1800);
  });
})();
