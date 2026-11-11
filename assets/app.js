/* 果果的数学笔记 —— 交互逻辑（纯原生 JS，无外部依赖） */
(function () {
  'use strict';

  var STORE_KEY = 'guoguo-notes-v1';
  var lessons = [];          // 按加载顺序
  var current = null;        // 当前渲染的讲次 id
  var quizState = {};        // 本次会话内的答题状态 {lessonId: {qid: 'ok'|'bad'}}
  var app = document.getElementById('app');
  var btnBack = document.getElementById('btn-back');
  var btnPrint = document.getElementById('btn-print');

  /* 科目分组：顺序即首页展示顺序。老数据没有 subject 字段，一律当数学 */
  var SUBJECTS = [
    { key: 'math', label: '数学', icon: '📐', desc: '公式推导 · 题型 · 易错' },
    { key: 'chinese', label: '语文', icon: '📖', desc: '名著考点 · 阅读 · 作文' },
    { key: 'english', label: '英语', icon: '🔤', desc: '阅读技巧 · 词汇 · 表达' }
  ];
  function subjOf(L) { return (L && L.subject) || 'math'; }
  function subjLabel(L) {
    var k = subjOf(L);
    for (var i = 0; i < SUBJECTS.length; i++) if (SUBJECTS[i].key === k) return SUBJECTS[i].label;
    return '数学';
  }

  /* ---------- 本地存储 ---------- */
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveStore(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* 隐私模式下忽略 */ }
  }
  function store() { return loadStore(); }

  /* ---------- 文本渲染 ---------- */
  function fmt(str) {
    if (!str) return '';
    return String(str).replace(/~\{([^{}]*)\}\{([^{}]*)\}/g, function (_, a, b) {
      return '<span class="frac"><i>' + a + '</i><i>' + b + '</i></span>';
    });
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function stripTags(html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    // 分数转成 "a分之b" 方便朗读
    d.querySelectorAll('.frac').forEach(function (f) {
      var parts = f.querySelectorAll('i');
      f.textContent = parts[0].textContent + '分之' + parts[1].textContent;
    });
    return d.textContent;
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dateAfter(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayDiff(dateStr) {
    var a = new Date(dateStr + 'T00:00:00');
    var b = new Date(todayStr() + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  /* ---------- 数据加载 ---------- */
  function loadScripts(urls, done) {
    var i = 0;
    (function next() {
      if (i >= urls.length) { done(); return; }
      var s = document.createElement('script');
      s.src = urls[i++];
      s.onload = next;
      s.onerror = function () { console.warn('加载失败:', s.src); next(); };
      document.head.appendChild(s);
    })();
  }

  /* ---------- 首页 ---------- */
  function renderHome() {
    current = null;
    btnBack.hidden = true;
    btnPrint.hidden = true;
    stopSpeak();
    var st = store();
    var html = '';
    // 结构断言：数据文件加载失败的讲，不能静默消失——必须在页面上说出来
    var expected = (window.NOTE_INDEX || []).length;
    if (lessons.length !== expected) {
      var missing = (window.NOTE_INDEX || []).filter(function (id2) { return !(window.NOTES && window.NOTES[id2]); });
      html += '<div style="background:#fff3f3;border:2px solid var(--bad,#e05252);border-radius:12px;padding:12px 16px;margin:12px 0;color:#a33;">' +
        '⚠️ 有 ' + missing.length + ' 讲的笔记数据没加载成功（' + missing.join('、') + '），所以首页看不到它们。' +
        '刷新一次试试；还不行就告诉爸爸，笔记文件可能没上传齐。</div>';
    }
    html += '<div class="hero">' +
      '<h1>果果的课堂笔记</h1>' +
      '<p>每一讲 = 一分钟总结 → 知识点 → 例题 → 雷区 → 自测 → 复习打卡。先听一分钟，再做几道题，这一讲才算砸实。</p>' +
      '</div>';

    /* 按科目分组：数学 / 语文 / 英语 各一块，别混在一起 */
    var groups = {};
    lessons.forEach(function (L) { (groups[subjOf(L)] = groups[subjOf(L)] || []).push(L); });
    SUBJECTS.forEach(function (S) {
      var list = groups[S.key] || [];
      if (!list.length) return;
      html += '<section class="subj-block" id="subj-' + S.key + '">' +
        '<h2 class="subj-h"><span class="subj-icon">' + S.icon + '</span>' + S.label +
        '<span class="subj-desc">' + S.desc + '</span>' +
        '<span class="subj-count">' + list.length + ' 讲</span></h2>' +
        '<div class="lesson-grid">';
      list.forEach(function (L) {
        var q = (st.quiz && st.quiz[L.id]) || {};
        var best = q.best || null;
        var due = reviewDue(st, L.id);
        html += '<a class="lesson-card" href="#/' + L.id + '">' +
          '<div class="lc-top">' +
            '<span class="lc-no">' + esc(L.no) + '</span>' +
            '<span class="lc-title">' + esc(L.title) + '</span>' +
            (due ? '<span class="lc-flag">📌 今天该复习</span>' : '') +
          '</div>' +
          '<p class="lc-tagline">' + esc(L.tagline) + '</p>' +
          '<div class="lc-tags">' + L.tags.map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('') + '</div>' +
          '<div class="lc-foot">' +
            (best ? '<span>🏅 自测最好成绩：' + best.correct + '/' + best.total + '</span>' : '<span>🧪 自测还没做</span>') +
            (due ? '<span>' + esc(due) + '</span>' : '') +
            '<span>📚 共 ' + L.examples.length + ' 道例题 · ' + L.quiz.length + ' 道自测</span>' +
          '</div>' +
        '</a>';
      });
      html += '</div></section>';
    });

    html += '<div class="todo-card"><b>以后每一讲都进这里：</b>把课堂笔记 PDF 发给阿岩，或用「笔记工坊」自己传，就会按同样的格式生成新的一讲（详见右上角「怎么加新笔记」）。已整理：' +
      lessons.map(function (L) { return esc(L.no); }).join('、') + '。</div>';

    app.innerHTML = html;
    window.scrollTo(0, 0);
  }

  /* ---------- 复习计划 ---------- */
  var CYCLES = [
    { key: 'd1', label: '明天', offset: 1 },
    { key: 'd3', label: '3 天后', offset: 3 },
    { key: 'd7', label: '一周后', offset: 7 }
  ];
  function reviewInfo(st, lessonId) {
    return (st.review && st.review[lessonId]) || null;
  }
  function reviewDue(st, lessonId) {
    var r = reviewInfo(st, lessonId);
    if (!r) return null;
    for (var i = 0; i < CYCLES.length; i++) {
      var c = CYCLES[i];
      if (!r.done[c.key] && dayDiff(r.start) >= c.offset) {
        return c.label + '的复习（' + c.label + '到了）';
      }
    }
    return null;
  }

  /* ---------- 讲次页 ---------- */
  /* ---------- 思维导图 ---------- */
  function renderMindmap(L) {
    var mm = L.mindmap;
    if (!mm || !mm.branches || !mm.branches.length) return '';
    var branches = mm.branches.map(function (b) {
      var node = '<div class="mm-node' + (b.hot ? ' hot' : '') + '">' +
        (b.hot ? '<span class="mm-star">⭐</span>' : '') + esc(b.t) + '</div>';
      if (b.link) node = '<a class="mm-link" href="#/' + L.id + '/sec-' + b.link + '">' + node + '</a>';
      return '<div class="mm-branch">' + node +
        '<ul class="mm-subs">' + b.sub.map(function (s) { return '<li>' + fmt(s) + '</li>'; }).join('') + '</ul>' +
        '</div>';
    }).join('');
    return '<section class="mindmap" id="mindmap">' +
      '<h2>🗺️ 这讲一张图</h2>' +
      '<p class="mm-sub">先看整体：这一讲到底在讲几件事。⭐ 的是必考/最容易错的，点方块能跳到对应讲解。</p>' +
      '<div class="mm-canvas">' +
        '<div class="mm-center">' + esc(mm.center).replace(/\n/g, '<br>') + '</div>' +
        '<div class="mm-branches">' + branches + '</div>' +
      '</div></section>';
  }

  /* ---------- 课堂回放（板书原页） ---------- */
  function gallerySrc(L, i) {
    return L.galleryDir + '/' + (i < 10 ? 'p0' : 'p') + i + '.jpg';
  }

  /* ---------- 板书原页：嵌进纪要正文 ---------- */
  function boardMap(L) { return (window.BOARD && L && window.BOARD[L.id]) || null; }
  function boardNote(L, p) {
    var bm = boardMap(L);
    return (bm && bm.pages && bm.pages[p]) || ('第 ' + p + ' 页');
  }
  function boardPages(L, kind, key) {
    var bm = boardMap(L);
    return (bm && bm[kind] && bm[kind][key]) || [];
  }
  /* 封面 / 目录 / 过渡 / 空白页：不进正文，只在文末画廊里按顺序保留 */
  function boardSkip(L) {
    var bm = boardMap(L);
    return (bm && bm.skipInBody) || [];
  }
  function isFiller(L, p) { return boardSkip(L).indexOf(p) >= 0; }
  /* 就地插图：点开放大（复用灯箱），不点也能直接看清原题 */
  function boardShots(L, pages, hint) {
    if (!L.galleryDir || !pages || !pages.length) return '';
    /* 过滤纯封面页：去掉后如果一张都不剩，就整块不出，避免留个空标题 */
    pages = pages.filter(function (p) { return !isFiller(L, p); });
    if (!pages.length) return '';
    var figs = pages.map(function (p) {
      return '<figure class="bshot">' +
        '<button class="gthumb bthumb" data-page="' + p + '" title="第 ' + p + ' 页 · 点开放大">' +
          '<img src="' + gallerySrc(L, p) + '" alt="' + esc(L.no) + ' 第 ' + p + ' 页板书" loading="lazy">' +
          '<span class="bzoom">🔍 放大</span>' +
        '</button>' +
        '<figcaption>第 ' + p + ' 页 · ' + esc(boardNote(L, p)) + '</figcaption>' +
        '</figure>';
    }).join('');
    return '<div class="bshots">' +
      '<p class="bshots-h">📷 ' + esc(hint || '老师这一页的板书') + '</p>' +
      '<div class="bshots-row">' + figs + '</div>' +
      '</div>';
  }
  function renderGallery(L) {
    if (!L.galleryDir || !L.pages) return '';
    var thumbs = '';
    var fillerCount = 0;
    for (var i = 1; i <= L.pages; i++) {
      var fill = isFiller(L, i);
      if (fill) fillerCount++;
      thumbs += '<button class="gthumb' + (fill ? ' gthumb-filler' : '') + '" data-page="' + i + '" ' +
        'title="第 ' + i + ' 页 · ' + esc(boardNote(L, i)) + (fill ? '（封面/目录页，正文不引用）' : '') + '">' +
        '<img src="' + gallerySrc(L, i) + '" alt="课堂笔记第 ' + i + ' 页" loading="lazy">' +
        '<span class="gnum">' + i + '</span>' +
        (fill ? '<span class="gfill">封面</span>' : '') +
        '</button>';
    }
    return '<section class="gallery" id="gallery">' +
      '<h2>🖼️ 整份课件原页（按上课顺序）</h2>' +
      '<p class="g-sub">上面各章节和例题里已经嵌了对应的那几页，这里是完整一份，共 ' + L.pages + ' 页' +
      (fillerCount ? '（其中 ' + fillerCount + ' 页是封面 / 目录 / 空白页，灰掉了，正文不引用）' : '') + '。' +
      '想按老师的节奏从上到下过一遍网课，就翻这里；点任意一页放大，放大后按 ← → 翻页、按 Esc 退出。</p>' +
      '<div class="g-grid">' + thumbs + '</div>' +
      '<p class="g-foot">完整原版 PDF：<a href="' + esc(L.original) + '" target="_blank">拿去做打印 / 存档</a></p>' +
      '</section>';
  }

  function renderLesson(id) {
    var L = window.NOTES && window.NOTES[id];
    if (!L) { renderHome(); return; }
    current = id;
    btnBack.hidden = false;
    btnPrint.hidden = false;
    stopSpeak();
    quizState[id] = quizState[id] || {};

    var html = '';
    html += '<div class="lesson-head">' +
      '<span class="subj-chip">' + esc(subjLabel(L)) + '</span>' +
      '<span class="lc-no">' + esc(L.no) + '</span>' +
      '<h1>' + esc(L.title) + '</h1>' +
      '<p class="lc-tagline">' + esc(L.tagline) + '</p>' +
      '</div>';

    /* 一分钟总结 */
    var minuteText = L.minute.headline + '。' + L.minute.points.map(stripTags).join('。') + '。' + L.minute.closing;
    html += '<section class="minute" id="minute">' +
      '<div class="minute-head">' +
        '<span class="minute-badge">⏱ ' + (L.minute.seconds || 60) + ' 秒总结</span>' +
        '<span class="minute-headline">' + fmt(L.minute.headline) + '</span>' +
      '</div>' +
      '<ol class="minute-points">' + L.minute.points.map(function (p) { return '<li>' + fmt(p) + '</li>'; }).join('') + '</ol>' +
      '<p class="minute-close">👉 ' + fmt(L.minute.closing) + '</p>' +
      '<div class="minute-actions">' +
        '<button class="speak-btn" id="btn-speak">🔊 听一遍（约 ' + (L.minute.seconds || 60) + ' 秒）</button>' +
        '<span class="speak-hint">先闭眼听一遍，再去下面做题</span>' +
      '</div>' +
      '</section>';

    /* 章节导航 */
    html += '<nav class="sec-nav no-print">' +
      (L.mindmap ? '<a href="#/' + id + '/mindmap">🗺️ 一张图</a>' : '') +
      L.sections.map(function (s) { return '<a href="#/' + id + '/sec-' + s.id + '">' + esc(s.title.replace(/^[一二三四五六七八九十]+、/, '')) + '</a>'; }).join('') +
      '<a href="#/' + id + '/examples">例题</a>' +
      '<a href="#/' + id + '/pitfalls">雷区</a>' +
      (L.galleryDir ? '<a href="#/' + id + '/gallery">🖼️ 课堂回放</a>' : '') +
      '<a href="#/' + id + '/quiz">自测</a>' +
      '<a href="#/' + id + '/review">复习打卡</a>' +
      '</nav>';

    /* 思维导图：先看整体结构 */
    html += renderMindmap(L);

    /* 知识模块（每个模块下面直接嵌老师讲这部分的板书页） */
    L.sections.forEach(function (s) {
      html += '<section class="sect" id="sec-' + s.id + '">' +
        '<h2>' + esc(s.title) + ' <span class="level-chip">' + esc(s.level || '') + '</span></h2>' +
        s.blocks.map(renderBlock).join('') +
        boardShots(L, boardPages(L, 'sections', s.id), '老师讲「' + s.title.replace(/^[一二三四五六七八九十]+、/, '') + '」时的板书') +
        '</section>';
    });

    /* 例题 */
    html += '<section class="sect" id="examples" style="background:transparent;border:none;box-shadow:none;padding-left:0;padding-right:0;"><h2 style="margin-left:4px;">📝 例题精讲（先自己想，再看步骤）</h2></section>';
    L.examples.forEach(function (ex) {
      html += '<div class="example" id="ex-' + encodeURIComponent(ex.no) + '">' +
        '<div class="ex-head">' +
          '<span class="ex-no">' + esc(ex.no) + '</span>' +
          '<span class="ex-title">' + esc(ex.title) + '</span>' +
          '<span class="ex-level">' + esc(ex.level || '') + '</span>' +
          '<span class="ex-tag">' + esc(ex.tag || '') + '</span>' +
        '</div>' +
        '<div class="ex-problem"><b>题目：</b>' + fmt(ex.problem) + '</div>' +
        '<p class="ex-ans">✅ 答案：<b>' + fmt(ex.answer) + '</b></p>' +
        '<div class="ex-steps"><b>解题步骤：</b><ol>' + ex.steps.map(function (st2) { return '<li>' + fmt(st2) + '</li>'; }).join('') + '</ol></div>' +
        '<div class="ex-actions">' +
          '<button class="toggle-steps" data-ex>先自己想，再看步骤 👀</button>' +
        '</div>' +
        (ex.method ? '<p class="ex-method">' + fmt(ex.method) + '</p>' : '') +
        (ex.trap ? '<p class="ex-trap">' + fmt(ex.trap) + '</p>' : '') +
        boardShots(L, boardPages(L, 'examples', ex.no), ex.no + ' 的原题和老师手写过程') +
        '</div>';
    });

    /* 雷区 */
    html += '<section class="pitfalls" id="pitfalls"><h2>⚠️ 这讲最容易踩的坑</h2>' +
      L.pitfalls.map(function (p) { return '<div class="pit"><b>' + esc(p.title) + '</b>' + fmt(p.body) + '</div>'; }).join('') +
      '</section>';

    /* 课堂回放：老师板书原页，按上课顺序，点开可放大 */
    html += renderGallery(L);

    /* 自测 */
    html += '<section class="quiz" id="quiz"><h2>🧪 自测：砸实检验</h2>' +
      '<p class="quiz-sub">做完自动判分，错题会存进"只练错的"。建议先别翻上面，凭记忆做。</p>' +
      '<div id="quiz-list">' + L.quiz.map(renderQuizCard).join('') + '</div>' +
      '<div class="quiz-result" id="quiz-result"></div>' +
      '<div class="quiz-tools no-print">' +
        '<button class="check-btn" id="btn-quiz-reset">重做全部</button>' +
        '<button class="check-btn" id="btn-quiz-wrong" style="background:var(--accent)">只练错的题</button>' +
      '</div>' +
      '<p class="quiz-score-line" id="quiz-history"></p>' +
      '</section>';

    /* 复习打卡 */
    html += renderReview(L);

    /* 原版笔记 */
    html += '<p class="origin">📖 想看老师原版板书？<a href="' + esc(L.original) + '" target="_blank">打开「' + esc(L.no) + '」课堂笔记 PDF</a>（共 ' + (L.pages || '') + ' 页）</p>';

    app.innerHTML = html;
    window.scrollTo(0, 0);
    refreshQuizHistory(L);
    applyQuizState(L);
  }

  /* 重渲染后恢复本会话已答的题的状态 */
  function applyQuizState(L) {
    var st = quizState[L.id] || {};
    Object.keys(st).forEach(function (qid) {
      var card = document.querySelector('.qcard[data-qid="' + qid + '"]');
      var q = questionOf(qid);
      if (!card || !q) return;
      var ok = st[qid] === 'ok';
      card.classList.add(ok ? 'done-ok' : 'done-bad');
      card.querySelector('.explain').classList.add('show');
      if (q.type === 'choice') {
        var opts = card.querySelectorAll('.opt');
        if (ok) opts[q.answer].classList.add('sel-ok');
        else opts[q.answer].classList.add('reveal');
      } else {
        var inp = card.querySelector('.fill-input');
        if (inp) inp.style.borderColor = ok ? 'var(--ok)' : 'var(--bad)';
      }
    });
  }

  function renderBlock(b) {
    switch (b.t) {
      case 'p': return '<p>' + fmt(b.v) + '</p>';
      case 'list': return '<ul>' + b.v.map(function (x) { return '<li>' + fmt(x) + '</li>'; }).join('') + '</ul>';
      case 'formula': return '<div class="formula">' + fmt(b.v) + '</div>';
      case 'board': return '<div class="board">' + fmt(b.v) + '</div>';
      case 'tip': return '<div class="tip">' + fmt(b.v) + '</div>';
      case 'trap': return '<div class="trap">' + fmt(b.v) + '</div>';
      case 'table':
        var h = '<table class="tb"><thead><tr>' + b.head.map(function (x) { return '<th>' + fmt(x) + '</th>'; }).join('') + '</tr></thead><tbody>';
        b.rows.forEach(function (r) { h += '<tr>' + r.map(function (x) { return '<td>' + fmt(x) + '</td>'; }).join('') + '</tr>'; });
        return h + '</tbody></table>';
      default: return '';
    }
  }

  function renderQuizCard(q, idx) {
    var n = idx + 1;
    var card = '<div class="qcard" data-qid="' + q.id + '">';
    if (q.type === 'choice') {
      card += '<p class="qtext">' + n + '. ' + fmt(q.q) + '</p><div class="opts">' +
        q.options.map(function (o, i) {
          return '<button class="opt" data-idx="' + i + '">' + String.fromCharCode(65 + i) + '. ' + fmt(o) + '</button>';
        }).join('') + '</div>';
    } else {
      card += '<p class="qtext">' + n + '. ' + fmt(q.q) + '</p>' +
        '<div class="fill-row"><input class="fill-input" placeholder="' + esc(q.placeholder || '填答案') + '">' +
        '<button class="check-btn">检查</button></div>';
    }
    card += '<div class="explain"><b>解析：</b>' + fmt(q.explain) + '</div></div>';
    return card;
  }

  function renderReview(L) {
    var st = store();
    var r = reviewInfo(st, L.id);
    var html = '<section class="review" id="review"><h2>📅 复习打卡（对抗遗忘）</h2>' +
      '<p class="quiz-sub">记不住是正常的。按 1 天 → 3 天 → 7 天的节奏回来看「一分钟总结」＋重做错题，这一讲才算真的砸实。</p>';
    if (!r) {
      html += '<button class="review-start" id="btn-review-start">从今天开始打卡（' + todayStr() + '）</button>';
    } else {
      html += '<div class="cycle-list">';
      CYCLES.forEach(function (c) {
        var dueDate = dateAfter(0);
        var target = addDaysStr(r.start, c.offset);
        var diff = dayDiff(target);
        var cls = r.done[c.key] ? 'done' : (diff >= 0 ? 'due' : '');
        var status = r.done[c.key] ? '✅ 已完成' : (diff >= 0 ? '📌 到时间了' : '还没到（' + (-diff) + ' 天后）');
        html += '<div class="cycle ' + cls + '">' +
          '<span class="c-day">' + c.label + '</span>' +
          '<span class="c-date">' + target + ' · ' + status + '</span>' +
          (r.done[c.key] ? '' : '<button class="cycle-done-btn" data-cycle="' + c.key + '">完成打卡</button>') +
          '</div>';
      });
      html += '</div>';
    }
    html += '</section>';
    return html;
  }
  function addDaysStr(startStr, days) {
    var d = new Date(startStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* ---------- 自测交互 ---------- */
  function questionOf(qid) {
    var L = window.NOTES[current];
    for (var i = 0; i < L.quiz.length; i++) if (L.quiz[i].id === qid) return L.quiz[i];
    return null;
  }
  function markCard(card, ok, q) {
    card.classList.remove('done-ok', 'done-bad');
    card.classList.add(ok ? 'done-ok' : 'done-bad');
    quizState[current][q.id] = ok ? 'ok' : 'bad';
    card.querySelector('.explain').classList.add('show');
    checkAllDone();
  }
  function checkAllDone() {
    var cards = Array.prototype.slice.call(document.querySelectorAll('#quiz-list .qcard'));
    var total = cards.length;
    if (!total) return;
    var answered = 0, correct = 0;
    cards.forEach(function (c) {
      var s = quizState[current][c.getAttribute('data-qid')];
      if (s) answered++;
      if (s === 'ok') correct++;
    });
    var box = document.getElementById('quiz-result');
    if (answered === total) {
      var L = window.NOTES[current];
      box.classList.add('show');
      box.innerHTML = '🎉 本轮成绩：<b>' + correct + ' / ' + total + '</b>' +
        (correct === total ? '　全对，这一讲砸实了！记得点下面的复习打卡。'
          : correct >= total * 0.7 ? '　不错！错的那几道看看解析，再用「只练错的题」过一遍。'
          : '　别急，错题暴露的才是值钱的地方——把解析看懂，再「只练错的题」。');
      // 持久化（错题记录取并集，避免“只练错的”那轮把老错题洗掉）
      var s = store();
      s.quiz = s.quiz || {};
      s.quiz[current] = s.quiz[current] || {};
      var rec = s.quiz[current];
      rec.attempts = rec.attempts || [];
      rec.attempts.push({ date: todayStr(), correct: correct, total: total });
      if (!rec.best || correct > rec.best.correct) rec.best = { correct: correct, total: total };
      var wrongNow = cards.filter(function (c) { return quizState[current][c.getAttribute('data-qid')] === 'bad'; })
        .map(function (c) { return c.getAttribute('data-qid'); });
      var old = rec.wrongIds || [];
      rec.wrongIds = old.concat(wrongNow.filter(function (x) { return old.indexOf(x) < 0; }));
      saveStore(s);
      refreshQuizHistory(L);
    }
  }
  function refreshQuizHistory(L) {
    var s = store();
    var rec = (s.quiz && s.quiz[L.id]) || {};
    var el = document.getElementById('quiz-history');
    if (!el) return;
    var n = (rec.attempts || []).length;
    el.textContent = n ? '历史上做过 ' + n + ' 轮自测' + (rec.best ? '，最好成绩 ' + rec.best.correct + '/' + rec.best.total : '') +
      (rec.wrongIds && rec.wrongIds.length ? '；上轮错题 ' + rec.wrongIds.length + ' 道。' : '。') : '';
  }

  function resetQuiz(onlyWrong) {
    var L = window.NOTES[current];
    var s = store();
    var wrongIds = (s.quiz && s.quiz[current] && s.quiz[current].wrongIds) || [];
    var list = onlyWrong ? L.quiz.filter(function (q) { return wrongIds.indexOf(q.id) >= 0; }) : L.quiz;
    if (onlyWrong && !list.length) { alert('上一轮全对，没有错题可练，去做点别的吧 👍'); return; }
    quizState[current] = {};
    var box = document.getElementById('quiz-result');
    box.classList.remove('show'); box.innerHTML = '';
    document.getElementById('quiz-list').innerHTML = list.map(renderQuizCard).join('');
    window.scrollTo(0, document.getElementById('quiz').offsetTop - 60);
  }

  /* ---------- 朗读 ---------- */
  function stopSpeak() {
    try { speechSynthesis.cancel(); } catch (e) {}
    document.querySelectorAll('.speak-btn.speaking').forEach(function (b) { b.classList.remove('speaking'); });
  }
  function speakLesson(L) {
    var minuteText = L.minute.headline + '。' + L.minute.points.map(stripTags).join('。') + '。' + L.minute.closing;
    try {
      stopSpeak();
      var u = new SpeechSynthesisUtterance(minuteText);
      u.lang = 'zh-CN';
      u.rate = 1.05;
      var vs = speechSynthesis.getVoices().filter(function (v) { return /zh|cmn/i.test(v.lang); });
      if (vs.length) u.voice = vs[0];
      var btn = document.getElementById('btn-speak');
      u.onstart = function () { btn.classList.add('speaking'); btn.textContent = '⏸ 正在朗读…点击停止'; };
      u.onend = u.onerror = function () { btn.classList.remove('speaking'); btn.textContent = '🔊 再听一遍'; };
      speechSynthesis.speak(u);
    } catch (e) { /* 不支持朗读的浏览器就静默跳过 */ }
  }

  /* ---------- 事件 ---------- */
  app.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!current) return;
    var L = window.NOTES[current];

    // 例题展开
    if (t.closest('[data-ex]')) {
      var exEl = t.closest('.example').querySelector('.ex-steps');
      var open = exEl.classList.toggle('open');
      t.textContent = open ? '收起步骤 🙈' : '先自己想，再看步骤 👀';
      return;
    }
    // 选择题
    if (t.classList && t.classList.contains('opt')) {
      var card = t.closest('.qcard');
      var qid = card.getAttribute('data-qid');
      if (quizState[current][qid]) return; // 已答
      var q = questionOf(qid);
      var idx = parseInt(t.getAttribute('data-idx'), 10);
      var ok = idx === q.answer;
      if (ok) { t.classList.add('sel-ok'); }
      else {
        t.classList.add('sel-bad');
        card.querySelectorAll('.opt')[q.answer].classList.add('reveal');
      }
      markCard(card, ok, q);
      return;
    }
    // 填空题
    if (t.classList && t.classList.contains('check-btn') && t.closest('.fill-row')) {
      var card2 = t.closest('.qcard');
      var qid2 = card2.getAttribute('data-qid');
      if (quizState[current][qid2]) return;
      var q2 = questionOf(qid2);
      /* 去空格 + 转小写：英语答案大小写不该判错（Filled with / filled with 都对） */
      var val = card2.querySelector('.fill-input').value.trim().replace(/\s/g, '').toLowerCase();
      var ok2 = q2.answer.some(function (a) {
        return String(a).replace(/\s/g, '').toLowerCase() === val;
      });
      if (!ok2) card2.querySelector('.fill-input').style.borderColor = 'var(--bad)';
      else card2.querySelector('.fill-input').style.borderColor = 'var(--ok)';
      markCard(card2, ok2, q2);
      return;
    }
    // 重做 / 只练错的
    if (t.id === 'btn-quiz-reset') { resetQuiz(false); return; }
    if (t.id === 'btn-quiz-wrong') { resetQuiz(true); return; }
    // 复习打卡
    if (t.id === 'btn-review-start') {
      var s = store();
      s.review = s.review || {};
      s.review[current] = { start: todayStr(), done: {} };
      saveStore(s);
      renderLesson(current);
      return;
    }
    if (t.hasAttribute && t.hasAttribute('data-cycle')) {
      var s2 = store();
      s2.review[current].done[t.getAttribute('data-cycle')] = true;
      saveStore(s2);
      renderLesson(current);
      return;
    }
    // 朗读
    if (t.id === 'btn-speak') {
      if (t.classList.contains('speaking')) stopSpeak();
      else speakLesson(L);
      return;
    }
  });

  // 填空题回车提交
  app.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter') return;
    var row = ev.target.closest && ev.target.closest('.fill-row');
    if (row) row.querySelector('.check-btn').click();
  });

  /* 顶栏 */
  document.getElementById('btn-back').addEventListener('click', function () { location.hash = ''; });
  btnPrint.addEventListener('click', function () {
    document.querySelectorAll('.ex-steps').forEach(function (e) { e.classList.add('open'); });
    document.querySelectorAll('.explain').forEach(function (e) { e.classList.add('show'); });
    window.print();
  });
  /* 说明弹窗：四条关闭路径（× / 点遮罩 / Esc / 知道了按钮），任一条都必须能用 */
  var guideMask = document.getElementById('guide-mask');
  function closeGuide() { guideMask.hidden = true; }
  function openGuide() { guideMask.hidden = false; }
  document.getElementById('btn-guide').addEventListener('click', openGuide);
  document.getElementById('btn-guide-close').addEventListener('click', closeGuide);
  document.getElementById('btn-guide-ok').addEventListener('click', closeGuide);
  guideMask.addEventListener('click', function (ev) { if (ev.target === guideMask) closeGuide(); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !guideMask.hidden) closeGuide();
  });

  /* 板书灯箱：点缩略图放大，← → 翻页，Esc 退出 */
  var lb = document.getElementById('lightbox');
  var lbImg = document.getElementById('lb-img');
  var lbCap = document.getElementById('lb-cap');
  var lbLesson = null, lbPage = 1;

  function showPage(p) {
    if (!lbLesson) return;
    var total = lbLesson.pages;
    if (p < 1) p = 1;
    if (p > total) p = total;
    lbPage = p;
    lbImg.src = gallerySrc(lbLesson, p);
    lbCap.textContent = lbLesson.no + ' 第 ' + p + ' / ' + total + ' 页 · ' + boardNote(lbLesson, p);
  }
  function openLightbox(L, page) {
    lbLesson = L; lbPage = page;
    showPage(page);
    lb.hidden = false;
  }
  function closeLightbox() {
    lb.hidden = true;
    lbImg.removeAttribute('src');
    lbLesson = null;
  }
  document.addEventListener('click', function (ev) {
    var thumb = ev.target.closest && ev.target.closest('.gthumb');
    if (thumb) {
      var L = window.NOTES && window.NOTES[current];
      if (L) openLightbox(L, parseInt(thumb.getAttribute('data-page'), 10) || 1);
    }
  });
  document.getElementById('lb-close').addEventListener('click', closeLightbox);
  document.getElementById('lb-prev').addEventListener('click', function () { showPage(lbPage - 1); });
  document.getElementById('lb-next').addEventListener('click', function () { showPage(lbPage + 1); });
  lb.addEventListener('click', function (ev) { if (ev.target === lb) closeLightbox(); });
  document.addEventListener('keydown', function (ev) {
    if (lb.hidden) return;
    if (ev.key === 'Escape') closeLightbox();
    else if (ev.key === 'ArrowLeft') showPage(lbPage - 1);
    else if (ev.key === 'ArrowRight') showPage(lbPage + 1);
  });

  /* 路由 */
  function route() {
    var h = location.hash.replace(/^#\//, '');
    if (!h) { renderHome(); return; }
    var parts = h.split('/');
    var id = parts[0];
    if (current !== id) renderLesson(id);
    // 同讲内的章节锚点：只滚动，不重渲染（保住已答的自测状态）
    if (parts[1]) {
      var target = document.getElementById(parts[1]);
      if (target) setTimeout(function () { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
    }
  }
  window.addEventListener('hashchange', route);

  /* 启动 */
  var urls = ['data/board-map.js'].concat((window.NOTE_INDEX || []).map(function (id) { return 'data/lesson-' + id.replace(/^lesson/, '') + '.js'; }));
  loadScripts(urls, function () {
    if (!window.BOARD) console.warn('板书映射表 data/board-map.js 没加载成功，正文里的板书插图会缺失');
    lessons = (window.NOTE_INDEX || [])
      .map(function (id) { return window.NOTES && window.NOTES[id]; })
      .filter(Boolean);
    route();
  });
})();
