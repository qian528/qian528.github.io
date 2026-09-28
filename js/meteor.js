/**
 * 流星雨背景效果（Canvas 2D，零依赖）
 *
 * 用法：本文件被注入到页面底部即可自动运行。
 * 调参：可在引入本脚本【之前】定义 window.METEOR_CONFIG 覆盖任意配置项，例如
 *   <script>
 *     window.METEOR_CONFIG = { meteor: { density: 1.6, speed: [500, 1100] } };
 *   </script>
 *
 * 说明：
 * - 画布固定全屏、z-index 为负且 pointer-events:none，永远在内容层之下、不拦截鼠标；
 * - 页面切到后台自动暂停；尊重系统的「减弱动态效果」设置；
 * - 同屏流星数量按屏幕面积自适应，帧率偏低时自动降载。
 */

(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var BASE_AREA = 1440 * 900;

  // ------------------------------------------------------------------ 默认配置
  var CONFIG = {
    // ——— 通用 ———
    zIndex: -998,          // 画布层级：高于主题背景图(-999)，低于正文内容
    maxDpr: 2,             // 最大设备像素比，避免高分屏过度绘制
    pauseWhenHidden: true, // 页面不可见时暂停动画
    respectReducedMotion: true, // 跟随系统「减弱动态效果」
    darkOnly: false,       // true = 仅在暗色模式(html[data-theme=dark])下显示

    // ——— 星空 ———
    stars: {
      enabled: true,
      count: 0,            // 0 = 按屏幕面积自动计算（推荐）
      density: 1,          // 密度倍率
      maxCount: 260,       // 自动计算时的上限
      size: [0.4, 1.3],    // 半径范围(px)
      alpha: [0.25, 0.9],  // 亮度范围
      color: '#ffffff',
      twinkle: true,       // 是否让部分星星闪烁
      twinkleRatio: 0.08,  // 闪烁星占比
      twinkleSpeed: 0.0018 // 闪烁速度
    },

    // ——— 流星 ———
    meteor: {
      enabled: true,
      density: 1,           // 密度倍率（同时影响同屏数量与生成间隔）
      maxCount: 16,         // 同屏最多几颗（以 1440x900 为基准，按面积缩放）
      interval: [350, 1800],// 生成间隔范围(ms)，density 越大间隔越短
      speed: [420, 900],    // 飞行速度(px/s)
      length: [70, 210],    // 拖尾长度(px)
      thickness: [1.0, 2.6],// 头部粗细(px)
      angle: [18, 40],      // 与水平线的夹角(度)
      direction: 'right',   // 'right' = 右上飞向左下；'left' = 左上飞向右下
      fadeIn: 0.12,         // 出现渐显占行程比例
      fadeOut: 0.30,        // 消失渐隐占行程比例
      glow: true,           // 头部光晕
      colors: ['#ffffff', '#cfe6ff', '#ffe7ad', '#ffa8c8', '#b7fff0']
    },

    // ——— 夜空滤镜（可选）———
    // 在画布上叠一层深色蒙版，让背景更像深邃星空，同时提高流星对比度。
    // 画布在内容层之下，所以蒙版只压暗背景，不会让卡片和文字变暗。
    veil: {
      enabled: true,
      color: '#050a18',
      opacity: 0.30
    }
  };

  // 深度合并用户配置
  function isPlain(o) { return o && typeof o === 'object' && !Array.isArray(o); }
  function merge(base, ext) {
    if (!isPlain(ext)) return base;
    Object.keys(ext).forEach(function (k) {
      if (isPlain(base[k]) && isPlain(ext[k])) merge(base[k], ext[k]);
      else if (ext[k] !== undefined) base[k] = ext[k];
    });
    return base;
  }
  merge(CONFIG, window.METEOR_CONFIG);

  var reduceMotion = CONFIG.respectReducedMotion &&
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------------ 工具
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth(t) { return t * t * (3 - 2 * t); }

  var rgbaCache = {};
  function rgba(hex, a) {
    var key = hex + '|' + a.toFixed(3);
    if (rgbaCache[key]) return rgbaCache[key];
    var c = hex.replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var n = parseInt(c, 16);
    var out = 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    rgbaCache[key] = out;
    return out;
  }

  // ------------------------------------------------------------------ 画布
  var canvas = document.createElement('canvas');
  canvas.id = 'meteor-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  var style = canvas.style;
  style.position = 'fixed';
  style.top = '0';
  style.left = '0';
  style.width = '100%';
  style.height = '100%';
  style.zIndex = String(CONFIG.zIndex);
  style.pointerEvents = 'none'; // 关键：不拦截任何鼠标事件
  style.display = 'block';

  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var dpr = 1, W = 0, H = 0;
  var starLayer = null, starCtx = null;
  var twinklers = [];
  var meteors = [];
  var rafId = 0, lastTs = 0, spawnIn = 0;
  var baseMax = CONFIG.meteor.maxCount;
  var activeMax = baseMax;
  var slowFrames = 0, sampled = 0, running = false;

  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function areaScale() {
    var s = Math.sqrt((W * H) / BASE_AREA);
    return clamp(s, 0.6, 1.8);
  }

  function targetMax() {
    return Math.max(2, Math.round(baseMax * areaScale() * CONFIG.meteor.density));
  }

  // ------------------------------------------------------------------ 星空
  function buildStars() {
    var s = CONFIG.stars;
    if (!s.enabled) { starLayer = null; twinklers = []; return; }

    var count = s.count > 0 ? s.count : Math.min(s.maxCount, Math.round((W * H) / 6500 * s.density));
    count = Math.max(30, count);

    starLayer = document.createElement('canvas');
    starLayer.width = Math.floor(W * dpr);
    starLayer.height = Math.floor(H * dpr);
    starCtx = starLayer.getContext('2d');
    starCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    twinklers = [];
    var twinkleCount = s.twinkle ? Math.max(6, Math.round(count * s.twinkleRatio)) : 0;
    var twinkleStep = twinkleCount ? Math.floor(count / twinkleCount) : 0;

    for (var i = 0; i < count; i++) {
      var x = rand(0, W), y = rand(0, H);
      var r = rand(s.size[0], s.size[1]);
      var a = rand(s.alpha[0], s.alpha[1]);
      starCtx.beginPath();
      starCtx.arc(x, y, r, 0, TAU);
      starCtx.fillStyle = rgba(s.color, a);
      starCtx.fill();

      if (s.twinkle && twinkleStep && i % twinkleStep === 0) {
        twinklers.push({
          x: x, y: y,
          r: r * rand(1.1, 1.8),
          a: a,
          phase: rand(0, TAU),
          speed: rand(0.6, 1.6)
        });
      }
    }
  }

  // ------------------------------------------------------------------ 流星
  function spawnMeteor() {
    var m = CONFIG.meteor;
    var ang = rand(m.angle[0], m.angle[1]) * Math.PI / 180;
    var sign = m.direction === 'left' ? 1 : -1; // right: 右上 → 左下
    var speed = rand(m.speed[0], m.speed[1]);
    var ux = sign * Math.cos(ang);
    var uy = Math.sin(ang);

    var len = rand(m.length[0], m.length[1]);
    var x = sign < 0 ? rand(0, W * 1.25) : rand(-W * 0.25, W);
    var y = rand(-H * 0.15, H * 0.55);

    // 计算飞出画面所需的行程，用于渐显/渐隐
    var tx = ux > 0 ? (W + len - x) / ux : (ux < 0 ? (-len - x) / ux : Infinity);
    var ty = uy > 0 ? (H + len - y) / uy : Infinity;
    var maxDist = Math.max(1, Math.min(tx, ty));

    meteors.push({
      x: x, y: y,
      ux: ux, uy: uy,
      speed: speed,
      len: len,
      thick: rand(m.thickness[0], m.thickness[1]),
      color: pick(m.colors),
      traveled: 0,
      maxDist: maxDist
    });
  }

  function update(dt) {
    var m = CONFIG.meteor;

    // 生成调度
    spawnIn -= dt * 1000;
    if (spawnIn <= 0) {
      if (meteors.length < activeMax) spawnMeteor();
      var iv = rand(m.interval[0], m.interval[1]) / Math.max(0.2, m.density);
      spawnIn = iv;
    }

    for (var i = meteors.length - 1; i >= 0; i--) {
      var s = meteors[i];
      var step = s.speed * dt;
      s.x += s.ux * step;
      s.y += s.uy * step;
      s.traveled += step;
      if (s.traveled >= s.maxDist) meteors.splice(i, 1);
    }

    // 自适应降载：连续掉帧就减少同屏数量，流畅后逐步恢复
    sampled++;
    if (dt > 0.028) slowFrames++;
    if (sampled >= 120) {
      var ratio = slowFrames / sampled;
      if (ratio > 0.45 && activeMax > 2) activeMax = Math.max(2, Math.round(activeMax * 0.75));
      else if (ratio < 0.08 && activeMax < targetMax()) activeMax = Math.min(targetMax(), activeMax + 1);
      sampled = 0; slowFrames = 0;
    }
  }

  function drawMeteor(s) {
    var m = CONFIG.meteor;
    var p = clamp(s.traveled / s.maxDist, 0, 1);

    var a = 1;
    if (p < m.fadeIn) a = m.fadeIn > 0 ? p / m.fadeIn : 1;
    else if (p > 1 - m.fadeOut) a = m.fadeOut > 0 ? (1 - p) / m.fadeOut : 1;
    a = smooth(clamp(a, 0, 1));
    if (a <= 0.01) return;

    var tailX = s.x - s.ux * s.len;
    var tailY = s.y - s.uy * s.len;

    var g = ctx.createLinearGradient(s.x, s.y, tailX, tailY);
    g.addColorStop(0, rgba(s.color, a));
    g.addColorStop(0.25, rgba(s.color, a * 0.5));
    g.addColorStop(1, rgba(s.color, 0));

    ctx.strokeStyle = g;
    ctx.lineWidth = s.thick;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    if (m.glow) {
      var r = s.thick * 3.2;
      var rg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      rg.addColorStop(0, rgba(s.color, a * 0.85));
      rg.addColorStop(1, rgba(s.color, 0));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, TAU);
      ctx.fill();
    }
  }

  function draw(ts) {
    ctx.clearRect(0, 0, W, H);

    if (CONFIG.veil.enabled) {
      ctx.globalAlpha = CONFIG.veil.opacity;
      ctx.fillStyle = CONFIG.veil.color;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    if (starLayer) {
      // 整层轻微呼吸，比逐颗重绘省得多
      var pulse = 0.86 + 0.14 * Math.sin(ts * 0.0006);
      ctx.globalAlpha = pulse;
      ctx.drawImage(starLayer, 0, 0, W, H);
      ctx.globalAlpha = 1;

      if (CONFIG.stars.twinkle) {
        for (var i = 0; i < twinklers.length; i++) {
          var t = twinklers[i];
          var a = t.a * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(ts * CONFIG.stars.twinkleSpeed * t.speed + t.phase)));
          var r = t.r * (0.8 + 0.2 * Math.sin(ts * 0.001 + t.phase));
          ctx.beginPath();
          ctx.arc(t.x, t.y, r, 0, TAU);
          ctx.fillStyle = rgba(CONFIG.stars.color, a);
          ctx.fill();
        }
      }
    }

    for (var j = 0; j < meteors.length; j++) drawMeteor(meteors[j]);
  }

  // ------------------------------------------------------------------ 生命周期
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    var dt = lastTs ? (ts - lastTs) / 1000 : 0.016;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05; // 切后台回来不跳帧
    if (CONFIG.meteor.enabled) update(dt);
    draw(ts);
  }

  function start() {
    if (running) return;
    running = true;
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDpr);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildStars();
    activeMax = targetMax();
    meteors.length = 0;
    if (!running && !reduceMotion) draw(performance.now());
  }

  var resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 180);
  }

  function mount() {
    document.body.appendChild(canvas);
    resize();

    window.addEventListener('resize', onResize);

    if (CONFIG.pauseWhenHidden) {
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) stop();
        else if (!reduceMotion) start();
      });
    }

    if (reduceMotion) {
      draw(performance.now()); // 只画静态星空
      return;
    }
    start();
  }

  if (CONFIG.darkOnly && !isDark()) {
    // 仅暗色模式：监听主题切换，切到暗色时再挂载
    var observer = new MutationObserver(function () {
      if (isDark() && !canvas.parentNode) {
        mount();
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
