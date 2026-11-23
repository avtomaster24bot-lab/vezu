/* ВЕЗУ: приложение клиента и водителя (app.html) — Заказ · Мои водители · Мои заказы · Лента (для водителей). */
(function () {
  'use strict';
  var V = window.VEZU, C = window.VZC, F = window.VEZU_FAV, CAB = window.VEZU_CAB;
  function esc(s) { return V.esc(s == null ? '' : String(s)); }
  function $(s, r) { return (r || document).querySelector(s); }
  var tabs = ['order', 'favs', 'orders', 'feed'], cur = '';
  var POLL = 20000, timer = 0;

  // устройство клиента: случайный токен на телефоне, в базе — только хэш
  function dev() {
    var t = C.ls('vezu-otok');
    if (!t) { var a = new Uint8Array(24); crypto.getRandomValues(a); t = 'od' + Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); C.ls('vezu-otok', t); }
    return t;
  }
  function me() { var m = C.ls('vezu-me'); return m && typeof m === 'object' ? m : {}; }
  function ago(s) { var m = Math.round((Date.now() - new Date(s)) / 60000); return m < 1 ? 'только что' : m < 60 ? m + ' мин назад' : m < 1440 ? Math.round(m / 60) + ' ч назад' : new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Asia/Almaty' }); }
  function when(o) { return o.when_at ? new Date(o.when_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' }) : o.when || ''; }
  function est(c) { return c && c.lo ? 'примерно ' + V.fmtNum(c.lo) + ' – ' + V.fmtNum(c.hi) + ' ₸' : ''; }
  function route(o) { return '<p class="o-route"><i class="dot d1"></i>' + esc(o.from || '—') + '<br><i class="dot d2"></i>' + esc(o.to || '—') + '</p>'; }
  function facts(o) {
    var c = o.calc || {}, a = [];
    if (o.city) a.push('📍 ' + o.city);
    if (when(o)) a.push('🕑 ' + when(o));
    if (c.km) a.push(c.km + ' км' + (c.inter ? ' · межгород' : ''));
    if (o.agreed) a.push('цена: ' + V.fmtNum(o.agreed) + ' ₸');
    if (c.loaders) a.push('грузчики: ' + c.loaders);
    if (c.floors) a.push('этажи без лифта: ' + c.floors);
    if (c.price) a.push('цена клиента: ' + V.fmtNum(c.price) + ' ₸');
    return a.length ? '<p class="o-facts">' + a.map(esc).join(' · ') + '</p>' : '';
  }
  function mapLink(c) { return c && c.a && c.b ? 'https://www.google.com/maps/dir/?api=1&origin=' + c.a.lat + ',' + c.a.lon + '&destination=' + c.b.lat + ',' + c.b.lon + '&travelmode=driving' : ''; }

  // ---------- вкладки ----------
  function show(t) {
    var openSet = (t === 'settings');
    if (openSet) t = (cur && tabs.indexOf(cur) >= 0) ? cur : (C.key() ? 'feed' : 'order');
    if (tabs.indexOf(t) < 0) t = 'order';
    cur = t;
    document.querySelectorAll('[data-tab]').forEach(function (s) { s.hidden = s.dataset.tab !== t; });
    document.querySelectorAll('.bnav a').forEach(function (a) {
      var on = openSet ? a.classList.contains('bn-set') : (a.getAttribute('href') === '#' + t);
      a.classList.toggle('on', on); a.setAttribute('aria-current', on ? 'page' : 'false');
    });
    if (t === 'favs') drawFavs();
    if (t === 'orders') loadOrders();
    if (t === 'feed') { ensureSoundUi(); loadFeed(); }
    if (t === 'order') drawTargets();
    clearInterval(timer);
    if (t === 'orders' || t === 'feed') timer = setInterval(function () { if (!document.hidden) (t === 'orders' ? loadOrders : loadFeed)(true); }, POLL);
    if (!openSet) window.scrollTo(0, 0);
    if (openSet && V.openSettings) V.openSettings();
  }
  window.addEventListener('hashchange', function () { show(location.hash.slice(1)); });
  document.addEventListener('vezu-city', function () {
    if (cur === 'feed') loadFeed();
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) badges(); });

  // ---------- заказ ----------
  var form = $('#nord'), target = 'all', picked = {};
  V.bindOrderForm(form, function () { return V.SITE_PHONE; }, null, { anchor: form.querySelector('[data-tg]').closest('.fld') });
  // кнопка «Отправить в WhatsApp» формы — прямой заказ; основной — в ленту водителей
  var m = me(); if (m.n) form.querySelector('[name=cn]').value = m.n; if (m.p) form.querySelector('[name=cp]').value = V.fmtPhone ? V.fmtPhone(m.p) : m.p;
  form.querySelector('[data-tg]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-t]'); if (!b) return;
    target = b.dataset.t;
    form.querySelectorAll('[data-tg] .qchip').forEach(function (x) { x.classList.toggle('on', x === b); });
    drawTargets();
  });
  var catRows = null;
  function drawTargets() {
    var box = $('#tgl'), favs = F.list();
    var fb = form.querySelector('[data-t=fav]'); if (fb) fb.disabled = !favs.length;
    if (target === 'fav' && !favs.length) target = 'all';
    if (target === 'all') { box.innerHTML = '<p class="fine">Заказ увидят водители выбранного города в «Ленте». Ваш телефон увидит только водитель, которого вы выберете.</p>'; return; }
    var rows = target === 'fav' ? favs : favs.concat((catRows || []).filter(function (r) { return !F.has(r.slug); }));
    if (target === 'pick' && !catRows) {
      catRows = [];
      C.rpc('vz_catalog', { p_limit: 60 }).then(function (r) { catRows = (r || []).map(function (x) { var d = V.clean(x.d); return { slug: x.slug, n: d.n, c: d.c, w: d.w, t: d.t, st: x.status, rating: x.rating }; }); drawTargets(); }, function () {});
    }
    if (target === 'fav') { picked = {}; favs.forEach(function (f) { picked[f.slug] = 1; }); }
    box.innerHTML = (rows.length ? rows.map(function (r) {
      var si = V.statusInfo(r.st);
      return '<label class="tg-row"><input type="checkbox" value="' + esc(r.slug) + '"' + (picked[r.slug] ? ' checked' : '') + (target === 'fav' ? ' disabled checked' : '') + '><span><b>' + esc(r.n) + (F.has(r.slug) ? ' ★' : '') + '</b><small>' + esc([r.c, r.w, r.t].filter(Boolean).join(' · ')) + '</small></span>' +
        (si ? '<em class="st-' + si.s + '">' + esc(si.short) + '</em>' : '') + '</label>';
    }).join('') : '<p class="muted">Загружаю водителей…</p>') + '<p class="fine">Заказ увидят только выбранные водители.</p>';
  }
  var orderConsent = V.consentGate(form, 'order', $('#osend'));
  $('#tgl').addEventListener('change', function (e) { if (e.target.type === 'checkbox') { if (e.target.checked) picked[e.target.value] = 1; else delete picked[e.target.value]; } });
  function cargoTag(o) { return o.cargo && V.cargoLabel(o.cargo) && o.what ? '<span class="o-cargo">' + esc(V.cargoLabel(o.cargo)) + '</span>' : ''; }
  $('#osend').addEventListener('click', function () {
    var err = $('#oerr'); err.hidden = true;
    var g = function (n) { var i = form.querySelector('[name=' + n + ']'); return i ? i.value.trim() : ''; };
    var phone = V.normPhone(g('cp'));
    var o = { what: g('what'), cargo: g('cargo'), from: g('from'), to: g('to'), when: g('when'), note: g('note'), name: g('cn'), phone: phone || '', city: (V.getCity && V.getCity()) || (V.normCity ? V.normCity(g('city')) : g('city')) };
    var at = g('at'); if (at) { var d = new Date(at); if (!isNaN(d)) o.when_at = d.toISOString(); }
    var c = form._calc ? JSON.parse(JSON.stringify(form._calc)) : {}; delete c.how;
    var pr = +g('price').replace(/\D/g, ''); if (pr) c.price = pr;
    if (!c.a && form._geo) c.a = form._geo;
    o.calc = c;
    var fail = function (t) { err.textContent = t; err.hidden = false; err.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    if (!o.what && !o.from) return fail('Напишите, что везём и откуда.');
    if (!o.city) { if (V.openCitySheet) V.openCitySheet(); return fail('Выберите город в шапке — заказ увидят водители этого города.'); }
    if (!phone) return fail('Укажите телефон — его увидит только водитель, которого вы выберете.');
    var slugs = target === 'all' ? null : target === 'fav' ? F.list().map(function (f) { return f.slug; }) : Object.keys(picked);
    if (slugs && !slugs.length) return fail('Отметьте хотя бы одного водителя.');
    C.ls('vezu-me', { n: o.name, p: phone });
    var b = this; b.disabled = true; b.textContent = 'Отправляю…';
    if (!orderConsent()) return fail('Поставьте галочку согласия на обработку данных.');
    C.rpc('vz_order_create', { p_dev: dev(), p_order: o, p_slugs: slugs, p_consent: orderConsent() }).then(function () {
      if (o.city && V.cityChanged) V.cityChanged(o.city);
      b.disabled = false; b.innerHTML = '<svg><use href="#i-feed"/></svg>Отправить водителям';
      ['what', 'cargo', 'from', 'to', 'note', 'price', 'at'].forEach(function (n) { var i = form.querySelector('[name=' + n + ']'); if (i) i.value = ''; });
      form.querySelectorAll('[data-cargo]').forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
      var cb = form.querySelector('[data-consent=order]'); cb.checked = false; cb.dispatchEvent(new Event('change'));
      if (form._calcReset) form._calcReset();
      location.hash = '#orders';
      if (window.VEZU_SHARE) {
        var ok = V.sheet('Заказ отправлен ✓', '<div class="done-ic"><svg><use href="#i-check"/></svg></div>' +
          '<p class="done-t">Водители уже видят заказ. Отклики появятся в «Мои заказы» — мы покажем их здесь.</p>' +
          '<div class="done-share"><b>Расскажите друзьям 🚚</b><span>Кому-то из знакомых тоже скоро переезжать или везти мебель. Одна ссылка — и они найдут водителя за минуту.</span>' +
          '<button type="button" class="btn btn-share btn-lg btn-block" data-sh-order><svg><use href="#i-share"/></svg>Поделиться VEZU</button></div>' +
          '<button type="button" class="btn btn-glass btn-block" data-sh-close>Смотреть отклики</button>', 'sheet-done');
        ok.el.querySelector('[data-sh-order]').addEventListener('click', function () { window.VEZU_SHARE.open({ src: 'order', head: 'Расскажите друзьям', sub: 'Заказ отправлен. Поделитесь VEZU с теми, кому тоже нужна машина.' }); });
        ok.el.querySelector('[data-sh-close]').addEventListener('click', function () { ok.close(); });
      } else V.toast('Заказ отправлен! Ответы водителей — в «Мои заказы»', 4000);
    }, function (e) { b.disabled = false; b.innerHTML = '<svg><use href="#i-feed"/></svg>Отправить водителям'; fail(e.message); });
  });

  // ---------- мои водители ----------
  function drawFavs() {
    var a = F.list(), box = $('#favl');
    box.innerHTML = a.length ? a.map(function (x) {
      return '<article class="fav glass' + (x.pin ? ' pinned' : '') + '"><a class="fav-top" href="' + esc(C.shortUrl(x.slug)) + '"><i class="cat-av">' + (x.photo ? '<img src="' + esc(x.photo) + '" alt="" onerror="this.remove()">' : '') + '<b>' + esc(V.initials(x.n)) + '</b></i>' +
        '<span><b>' + (x.pin ? '📌 ' : '') + esc(x.n) + '</b><small>' + esc([x.c, x.w, x.t].filter(Boolean).join(' · ')) + '</small><em class="fav-st" data-st="' + esc(x.slug) + '"></em></span></a>' +
        '<div class="fav-b">' + (x.p ? '<a class="btn btn-wa btn-sm" href="#" data-wa="' + esc(x.p) + '" data-n="' + esc(x.n) + '"><svg><use href="#i-wa"/></svg>WhatsApp</a><a class="btn btn-glass btn-sm" href="tel:+' + esc(x.p) + '"><svg><use href="#i-phone"/></svg></a>' : '') +
        '<button type="button" class="btn btn-glass btn-sm" data-pin="' + esc(x.slug) + '">' + (x.pin ? 'Открепить' : 'Закрепить') + '</button><button type="button" class="btn btn-glass btn-sm" data-rm="' + esc(x.slug) + '" aria-label="Убрать">✕</button></div></article>';
    }).join('') + '<a class="btn btn-grad btn-block" href="#order"><svg><use href="#i-feed"/></svg>Заказ «Только избранным»</a>' :
      '<div class="empty glass"><h2>Пока пусто</h2><p class="muted">Нажмите ☆ «В избранное» на визитке или в каталоге — водитель появится здесь.</p><a class="btn btn-grad" href="catalog.html">Найти водителя</a></div>';
    // статус «Свободен / Занят» — свежий из облака
    a.forEach(function (x) {
      C.rpc('vz_card', { p_slug: x.slug }).then(function (r) {
        if (!r) return; var si = V.statusInfo(r.status), el = box.querySelector('[data-st="' + x.slug + '"]');
        if (el) el.innerHTML = (si ? '<span class="st-' + si.s + '"><i></i>' + esc(si.short) + '</span>' : '') + (V.reviewsOn() && r.rating && r.rating.n ? ' ★ ' + String(r.rating.avg).replace('.', ',') : '');
      }, function () {});
    });
  }
  $('#favl').addEventListener('click', function (e) {
    if (e.target.closest('a[href="#order"]')) { target = 'fav'; form.querySelectorAll('[data-tg] .qchip').forEach(function (x) { x.classList.toggle('on', x.dataset.t === 'fav'); }); return; }
    var b = e.target.closest('[data-pin],[data-rm],[data-wa]'); if (!b) return;
    e.preventDefault();
    if (b.dataset.pin) F.pin(b.dataset.pin);
    else if (b.dataset.rm) { if (!confirm('Убрать водителя из избранного?')) return; F.remove(b.dataset.rm); }
    else return V.openWA(b.dataset.wa, 'Здравствуйте, ' + b.dataset.n.split(' ')[0] + '! Нужна перевозка.');
    drawFavs();
  });

  // ---------- мои заказы ----------
  var LABEL = { open: 'Отправлен', resp: 'Есть отклики', taken: 'В работе', done: 'Выполнен', cancelled: 'Отменён', expired: 'Истёк' };
  function stateOf(o) { return o.state === 'open' && o.responses.length ? 'resp' : o.state; }
  function respWhen(r) { return r.at ? ago(r.at) : ''; }
  function respHtml(o, r, i) {
    var chosen = o.taken === r.slug;
    return '<div class="resp' + (chosen ? ' chosen' : '') + '"><div class="resp-pos"><b>#' + (i + 1) + '</b><small>' + esc(respWhen(r) || 'очередь') + '</small></div><a class="resp-h" href="' + esc(C.shortUrl(r.slug)) + '"><i class="cat-av">' + (r.photo ? '<img src="' + esc(C.photoUrl(r.photo)) + '" alt="" onerror="this.remove()">' : '') + '<b>' + esc(V.initials(r.n)) + '</b></i>' +
      '<span><b>' + esc(r.n) + (r.v ? ' <em class="vf-b">✓ Проверен</em>' : '') + (chosen ? ' · выбран' : '') + (i === 0 && o.state === 'open' ? ' · первый отклик' : '') + '</b><small>' + esc([r.c, r.w].filter(Boolean).join(' · ')) + (V.reviewsOn() && r.rating && r.rating.n ? ' · ★ ' + String(r.rating.avg).replace('.', ',') : '') + '</small></span>' +
      (r.price ? '<em class="resp-p"><small>могу за</small>' + V.fmtNum(r.price) + ' ₸</em>' : '<em class="resp-p resp-np"><small>цена</small>договорная</em>') + '</a>' +
      (r.comment ? '<p class="resp-c">«' + esc(r.comment) + '»</p>' : '') +
      '<div class="resp-b"><a class="btn btn-wa btn-sm" href="#" data-wa="' + esc(r.p) + '" data-n="' + esc(r.n) + '"><svg><use href="#i-wa"/></svg>WhatsApp</a><a class="btn btn-glass btn-sm" href="tel:+' + esc(r.p) + '"><svg><use href="#i-phone"/></svg>Звонок</a>' +
      (o.state === 'open' ? '<button type="button" class="btn btn-grad' + (o.responses.length === 1 ? '' : '') + ' btn-block btn-confirm" data-pick="' + esc(r.slug) + '" data-o="' + o.id + '">Подтвердить заказ' + (r.price ? ' за ' + V.fmtNum(r.price) + ' ₸' : '') + '</button>' : '') + '</div></div>';
  }
  var lastOrders = null;
  function loadOrders(quiet) {
    var box = $('#ordl');
    if (!quiet && !lastOrders) box.innerHTML = '<p class="muted">Загружаю…</p>';
    if (!C.ls('vezu-otok')) { lastOrders = []; return drawOrders(); }
    C.rpc('vz_my_orders', { p_dev: dev() }).then(function (a) { lastOrders = a || []; drawOrders(); seenOrders(); }, function (e) { if (!quiet) box.innerHTML = '<p class="err-msg">' + esc(e.message) + '</p>'; });
  }
  // очередь откликов: кто откликнулся раньше — выше (как пришло на сервер)
  function offers(o) {
    return (o.responses || []).slice().sort(function (x, y) { return new Date(x.at || 0) - new Date(y.at || 0); });
  }
  function drawOrders() {
    var a = lastOrders || [], box = $('#ordl');
    box.innerHTML = a.length ? a.map(function (o) {
      var s = stateOf(o);
      return '<article class="ord glass st-o-' + s + '"><div class="ord-h"><span class="ost ost-' + s + '">' + LABEL[s] + (s === 'resp' ? ' · ' + o.responses.length : '') + '</span><span class="muted">' + esc(ago(o.at)) + '</span></div>' +
        '<h3>' + cargoTag(o) + esc(o.what || V.cargoLabel(o.cargo) || 'Перевозка') + '</h3>' + route(o) + facts(o) + (est(o.calc) ? '<p class="o-est">' + est(o.calc) + '</p>' : '') +
        (o.scope === 'picked' ? '<p class="fine">Только для: ' + esc((o.targets || []).join(', ')) + '</p>' : '') +
        (o.agreed ? '<p class="o-agreed">Договорная цена: <b>' + V.fmtNum(o.agreed) + ' ₸</b></p>' : '') +
        (o.responses.length ? (o.state === 'open' ? '<p class="fine">Отклики в порядке очереди: кто откликнулся первым — сверху. Когда договоритесь, нажмите «Подтвердить заказ» и укажите цену. Заказ перейдёт в статус «В работе».</p>' : '') + offers(o).map(function (r, i) { return respHtml(o, r, i); }).join('') : o.state === 'open' ? '<p class="muted wait">Ждём отклики водителей… Страница обновляется сама.</p>' : '') +
        (o.state === 'taken' ? '<button type="button" class="btn btn-glass btn-block" data-done="' + o.id + '">Отметить выполненным</button>' : '') +
        (V.reviewsOn() && (o.state === 'taken' || o.state === 'done') && !o.review_issued ? '<button type="button" class="btn btn-glass btn-block" data-rev="' + o.id + '"><svg><use href="#i-star"/></svg>Оставить отзыв водителю</button>' : '') +
        (o.state === 'open' || o.state === 'taken' ? '<button type="button" class="lnk" data-cancel="' + o.id + '">Отменить заказ</button>' : '') + '</article>';
    }).join('') : '<div class="empty glass"><h2>Заказов пока нет</h2><p class="muted">Опишите груз — водители ответят здесь со своей ценой.</p><a class="btn btn-grad" href="#order">Новый заказ</a></div>';
  }
  $('#ordl').addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick],[data-cancel],[data-rev],[data-wa],[data-done]'); if (!b) return;
    e.preventDefault();
    if (b.dataset.wa) return V.openWA(b.dataset.wa, 'Здравствуйте, ' + b.dataset.n.split(' ')[0] + '! Это по моему заказу в ВЕЗУ.');
    if (b.dataset.pick) {
      var po = (lastOrders || []).filter(function (x) { return String(x.id) === String(b.dataset.o); })[0],
        pr = po && po.responses.filter(function (x) { return x.slug === b.dataset.pick; })[0];
      if (!po || !pr) return;
      var sh = V.sheet('Подтвердить заказ', '<p class="muted">Водитель <b>' + esc(pr.n) + '</b>' + (pr.price ? ' предложил ' + V.fmtNum(pr.price) + ' ₸' : ' откликнулся без цены') + '. Укажите договорённую цену и подтвердите. Заказ перейдёт в «В работе», другие водители больше не смогут откликнуться.</p>' +
        '<label class="fld"><span>Договорённая цена</span><input class="inp" name="ap" inputmode="numeric" placeholder="' + (pr.price ? V.fmtNum(pr.price) : '10 000') + '" value="' + (pr.price ? V.fmtNum(pr.price) : '') + '"><b class="suffix">₸</b></label>' +
        '<button type="button" class="btn btn-grad btn-lg btn-block" data-go>Подтвердить заказ</button>', 'confirm-sheet');
      var ap = sh.el.querySelector('[name=ap]');
      ap.addEventListener('input', function () { ap.value = V.fmtNum(ap.value.replace(/\D/g, '').slice(0, 8)); });
      sh.el.querySelector('[data-go]').addEventListener('click', function () {
        var price = +ap.value.replace(/\D/g, '') || null;
        C.rpc('vz_order_pick', { p_dev: dev(), p_id: po.id, p_slug: pr.slug, p_price: price }).then(function () {
          sh.close(); V.toast('Заказ в работе. Можно написать водителю в WhatsApp'); loadOrders();
          if (pr.p) V.openWA(pr.p, 'Здравствуйте, ' + String(pr.n || '').split(' ')[0] + '! Подтверждаю заказ в ВЕЗУ: ' + (po.what || V.cargoLabel(po.cargo) || 'перевозка') +
            (po.from ? ', ' + po.from : '') + (po.to ? ' → ' + po.to : '') + (price ? '. Цена: ' + V.fmtNum(price) + ' ₸' : '') + '. Когда сможете?');
        }, function (er) { V.toast(er.message); });
      });
    } else if (b.dataset.done) {
      if (!confirm('Отметить заказ выполненным?')) return;
      C.rpc('vz_order_finish', { p_dev: dev(), p_id: b.dataset.done }).then(function () { V.toast('Заказ выполнен'); loadOrders(); }, function (er) { V.toast(er.message); });
    } else if (b.dataset.cancel) {
      if (!confirm('Отменить заказ?')) return;
      C.rpc('vz_order_cancel', { p_dev: dev(), p_id: b.dataset.cancel }).then(function () { loadOrders(); }, function (er) { V.toast(er.message); });
    } else if (b.dataset.rev) {
      C.rpc('vz_order_review', { p_dev: dev(), p_id: b.dataset.rev }).then(function (r) { location.href = 'card.html?u=' + encodeURIComponent(r.slug) + '&r=' + r.token; }, function (er) { V.toast(er.message); });
    }
  });


  // ---------- звук новых заказов (колокольчик + короткий голос) ----------
  var SND_K = 'vezu-feed-sound', ANN_K = 'vezu-announced';
  var soundOn = C.ls(SND_K) === true, audioCtx = null, soundUnlocked = false, soundPrimed = false;

  function ruHund(n) {
    var h = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
    var t = ['', 'десять', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
    var u = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
    var teen = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
    var s = [];
    if (n >= 100) { s.push(h[Math.floor(n / 100)]); n %= 100; }
    if (n >= 10 && n < 20) s.push(teen[n - 10]);
    else { if (n >= 20) { s.push(t[Math.floor(n / 10)]); n %= 10; } if (n) s.push(u[n]); }
    return s.join(' ');
  }
  function ruNum(n) {
    n = Math.round(Math.abs(+n || 0));
    if (!n) return 'ноль';
    var out = [], th = Math.floor(n / 1000), r = n % 1000;
    if (th) {
      var last = th % 100, last1 = th % 10, word;
      if (last >= 11 && last <= 14) word = 'тысяч';
      else if (last1 === 1) word = 'тысяча';
      else if (last1 >= 2 && last1 <= 4) word = 'тысячи';
      else word = 'тысяч';
      var parts = ruHund(th).split(' ');
      if (last1 === 1 && !(last >= 11 && last <= 14)) parts[parts.length - 1] = 'одна';
      if (last1 === 2 && !(last >= 11 && last <= 14)) parts[parts.length - 1] = 'две';
      out.push(parts.join(' '), word);
    }
    if (r) out.push(ruHund(r));
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }
  function briefWhat(o) {
    var s = String((o && (o.what || (V.cargoLabel && V.cargoLabel(o.cargo)))) || '').replace(/\s+/g, ' ').trim();
    var w = s.split(' ').filter(Boolean);
    if (w.length > 6) s = w.slice(0, 6).join(' ');
    if (s.length > 42) s = s.slice(0, 42).replace(/\s+\S*$/, '').replace(/[.,;:]+$/, '');
    return s;
  }
  function announceText(o) {
    var what = briefWhat(o);
    var price = (o.calc && o.calc.price) || o.agreed || null;
    return 'Новый заказ. ' + (what ? what + '. ' : '') + (price ? ruNum(price) + ' тенге' : 'Цена договорная');
  }
  function announcedIds() {
    var a = C.ls(ANN_K);
    return Array.isArray(a) ? a.map(String) : [];
  }
  function markAnnounced(ids) {
    var a = announcedIds();
    (ids || []).forEach(function (id) { id = String(id); if (a.indexOf(id) < 0) a.push(id); });
    if (a.length > 400) a = a.slice(-300);
    C.ls(ANN_K, a);
  }
  function pickRuVoice() {
    if (!window.speechSynthesis) return null;
    var list = speechSynthesis.getVoices() || [];
    var ru = list.filter(function (v) { return /^ru(-|_|$)/i.test(v.lang || ''); });
    var male = ru.filter(function (v) {
      return /male|муж|pavel|pavel|yuri|yuriy|yury|dmitr|georg|andrey|andrei|microsoft.*(pavel|dmitry)|ivan/i.test((v.name || '') + ' ' + (v.voiceURI || ''));
    });
    return male[0] || ru[0] || null;
  }
  function unlockSound() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !audioCtx) audioCtx = new AC();
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      if (audioCtx) {
        var b = audioCtx.createBuffer(1, 1, 22050), src = audioCtx.createBufferSource();
        src.buffer = b; src.connect(audioCtx.destination); src.start(0);
      }
    } catch (e) {}
    try {
      if (window.speechSynthesis) {
        speechSynthesis.getVoices();
        var warm = new SpeechSynthesisUtterance(' ');
        warm.volume = 0; warm.lang = 'ru-RU';
        speechSynthesis.speak(warm); speechSynthesis.cancel();
      }
    } catch (e) {}
    soundUnlocked = true;
  }
  function playChime() {
    return new Promise(function (resolve) {
      try {
        if (!audioCtx) { resolve(); return; }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        var t0 = audioCtx.currentTime + 0.02;
        // короткий «дин-дон», как объявление в аэропорту: четыре чистых тона
        var notes = [
          { f: 659.25, at: 0,    d: 0.22 },
          { f: 783.99, at: 0.14, d: 0.22 },
          { f: 987.77, at: 0.28, d: 0.26 },
          { f: 1318.5, at: 0.48, d: 0.55 }
        ];
        var master = audioCtx.createGain();
        master.gain.value = 0.22;
        master.connect(audioCtx.destination);
        notes.forEach(function (n) {
          var osc = audioCtx.createOscillator(), g = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.value = n.f;
          var a = t0 + n.at;
          g.gain.setValueAtTime(0.0001, a);
          g.gain.exponentialRampToValueAtTime(0.9, a + 0.03);
          g.gain.exponentialRampToValueAtTime(0.0001, a + n.d);
          osc.connect(g); g.connect(master);
          osc.start(a); osc.stop(a + n.d + 0.02);
        });
        setTimeout(resolve, 1100);
      } catch (e) { resolve(); }
    });
  }
  function speakLine(text) {
    return new Promise(function (resolve) {
      if (!window.speechSynthesis || !text) { resolve(); return; }
      try { speechSynthesis.cancel(); } catch (e) {}
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'ru-RU';
      u.rate = 0.95;
      u.volume = 1;
      var v = pickRuVoice();
      if (v) u.voice = v;
      else u.pitch = 0.85;
      var done = false;
      function end() { if (done) return; done = true; resolve(); }
      u.onend = end; u.onerror = end;
      setTimeout(end, 8000);
      try { speechSynthesis.speak(u); } catch (e) { end(); }
    });
  }
  function announce(orders) {
    var list = (orders || []).slice(0, 2);
    if (!list.length) return;
    playChime().then(function () {
      var i = 0;
      function next() {
        if (i >= list.length) return;
        speakLine(announceText(list[i++])).then(next);
      }
      next();
    });
  }
  function noticeNew(orders) {
    var ids = (orders || []).map(function (o) { return o.id; }).filter(Boolean);
    if (!soundPrimed) { markAnnounced(ids); soundPrimed = true; return; }
    var seen = announcedIds();
    var fresh = (orders || []).filter(function (o) { return o.status === 'open' && o.id && seen.indexOf(String(o.id)) < 0; });
    fresh.sort(function (a, b) { return new Date(b.at || 0) - new Date(a.at || 0); });
    markAnnounced(ids);
    if (!soundOn || !soundUnlocked || !fresh.length) return;
    announce(fresh);
  }
  function paintSoundBtn() {
    var b = document.getElementById('feedsnd');
    if (!b) return;
    var on = soundOn && soundUnlocked;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.textContent = on ? '🔔 Звук заказов: вкл' : (soundOn ? '🔔 Звук заказов: нажмите, чтобы включить' : '🔔 Звук заказов: выкл');
  }
  function ensureSoundUi() {
    var sec = document.querySelector('[data-tab="feed"]');
    if (!sec) return;
    var b = document.getElementById('feedsnd');
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      b.id = 'feedsnd';
      b.className = 'feed-sound';
      var h = sec.querySelector('h1');
      if (h && h.nextSibling) h.parentNode.insertBefore(b, h.nextSibling);
      else sec.insertBefore(b, sec.firstChild);
      var hint = document.createElement('p');
      hint.className = 'fine feed-sound-h';
      hint.textContent = 'Звук работает, пока приложение открыто. Если свернёте телефон — придёт уведомление в Telegram.';
      b.after(hint);
      b.addEventListener('click', function () { toggleSound(); });
    }
    b.hidden = !C.key();
    var h2 = sec.querySelector('.feed-sound-h');
    if (h2) h2.hidden = !C.key();
    paintSoundBtn();
    if (window.VEZU && VEZU.paintSettingsSound) {}
  }
  function toggleSound() {
    if (!soundOn || !soundUnlocked) {
      soundOn = true;
      C.ls(SND_K, true);
      unlockSound();
      paintSoundBtn();
      playChime();
    } else {
      soundOn = false;
      C.ls(SND_K, false);
      soundUnlocked = false;
      try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
      paintSoundBtn();
    }
    var sb = document.getElementById('setsnd');
    if (sb) { sb.textContent = soundOn && soundUnlocked ? '🔔 Звук заказов: вкл' : (soundOn ? '🔔 Звук заказов: нажмите, чтобы включить' : '🔔 Звук заказов: выкл'); sb.setAttribute('aria-pressed', soundOn && soundUnlocked ? 'true' : 'false'); }
  }
  window.VEZU_SOUND = {
    isOn: function () { return soundOn; },
    unlocked: function () { return soundUnlocked; },
    label: function () { return soundOn && soundUnlocked ? '🔔 Звук заказов: вкл' : (soundOn ? '🔔 Звук заказов: нажмите, чтобы включить' : '🔔 Звук заказов: выкл'); },
    toggle: toggleSound,
    paint: paintSoundBtn
  };
  if (window.speechSynthesis) speechSynthesis.addEventListener('voiceschanged', function () {});

  // ---------- лента водителя ----------
  var lastFeed = null, myCard = null, feedMeta = null;
  function proNote() {
    var m = feedMeta; if (!m || m.pro) return '';
    return '<a class="pro-note glass" href="new.html#pro"><b>' + (m.later ? 'Ещё ' + m.later + ' ' + V.plural(m.later, 'новый заказ', 'новых заказа', 'новых заказов') + ' в вашем городе — ' + (m.later === 1 ? 'появится' : 'появятся') + ' у вас в течение 10 минут' : 'Новые заказы вашего города вы видите через 10 минут после публикации') +
      '</b><span>С «Про» — сразу, и в Telegram тоже первым. Подключить →</span></a>';
  }
  function cityNeed() {
    if (V.getCity && V.getCity()) return '';
    return '<div class="empty glass city-need"><p class="muted">Чтобы видеть заказы своего города, выберите город в шапке сверху.</p><button type="button" class="btn btn-grad" data-open-city>Выбрать город</button></div>';
  }
  function loadFeed(quiet) {
    var box = $('#feedl');
    if (!C.key()) { box.innerHTML = '<div class="empty glass"><h2>Лента — для водителей</h2><p class="muted">Сохраните визитку в облаке ВЕЗУ — и здесь появятся заказы клиентов. Откликайтесь «Беру» со своей ценой.</p><a class="btn btn-grad" href="new.html">Создать визитку</a></div>'; $('#feedst').innerHTML = ''; return; }
    if (!quiet && !lastFeed) box.innerHTML = '<p class="muted">Загружаю заказы…</p>';
    if (!myCard) C.rpc('vz_me', { p_key: C.key() }).then(function (c) { myCard = c; var st = $('#feedst'); if (c && CAB) { st.innerHTML = '<section class="glass cab-sec">' + CAB.statusHtml(c.status) + '</section>'; } }, function () {});
    C.rpc('vz_feed_meta', { p_key: C.key() }).then(function (m) { feedMeta = m; if (m && m.needs_city && V.getCity && V.getCity() && V.setCity) V.setCity(V.getCity()); if (lastFeed) drawFeed(); }, function () {});
    C.rpc('vz_feed', { p_key: C.key() }).then(function (a) { lastFeed = a || []; drawFeed(); seenFeed(); noticeNew(a || []); }, function (e) { if (!quiet) box.innerHTML = '<p class="err-msg">' + esc(e.message) + '</p>'; });
  }
  function drawFeed() {
    var a = lastFeed || [], box = $('#feedl');
    box.innerHTML = cityNeed() + proNote() + (a.length ? a.map(function (o) {
      var tag = o.status === 'done' ? '<span class="ost ost-done">Выполнен' + (o.agreed ? ' · ' + V.fmtNum(o.agreed) + ' ₸' : '') + '</span>'
        : o.status === 'taken' ? '<span class="ost ost-taken">' + (o.mine ? 'Ваш заказ в работе' : 'В работе') + (o.agreed ? ' · ' + V.fmtNum(o.agreed) + ' ₸' : '') + '</span>'
        : o.mine ? '<span class="ost ost-taken">Клиент выбрал вас</span>' : o.personal ? '<span class="ost ost-me">Лично вам</span>' : '<span class="ost">Город: ' + esc(o.city || '—') + '</span>';
      var ml = mapLink(o.calc);
      return '<article class="ord glass' + (o.personal ? ' personal' : '') + (o.mine ? ' mine' : '') + (o.status === 'taken' ? ' in-work' : '') + (o.status === 'done' ? ' is-done' : '') + '"><div class="ord-h">' + tag + '<span class="muted">' + esc(ago(o.at)) + (o.responses ? ' · откликов: ' + o.responses : '') + '</span></div>' +
        '<h3>' + cargoTag(o) + esc(o.what || V.cargoLabel(o.cargo) || 'Перевозка') + '</h3>' + route(o) + facts(o) + (est(o.calc) ? '<p class="o-est">Калькулятор: ' + est(o.calc) + '</p>' : '') +
        (o.note ? '<p class="resp-c">' + esc(o.note) + '</p>' : '') +
        (o.phone ? '<p class="fine">Клиент: ' + esc(o.name || 'без имени') + ' · +' + esc(o.phone) + '</p>' : '<p class="fine">' + (o.status === 'taken' || o.status === 'done' ? 'Клиент уже выбрал водителя. Телефон и имя видит только он.' : (o.my ? 'Телефон появится, когда клиент выберет вас. Клиент видит ваш отклик и может написать вам в WhatsApp.' : 'Телефон клиента увидит только водитель, которого клиент выберет.')) + '</p>') +
        (ml ? '<a class="lnk" href="' + esc(ml) + '" target="_blank" rel="noopener">Маршрут на карте</a>' : '') +
        (o.my ? '<p class="my-resp">Ваше предложение: ' + (o.my.price ? 'могу за ' + V.fmtNum(o.my.price) + ' ₸' : 'без цены') + (o.my.comment ? ' · ' + esc(o.my.comment) : '') + '</p>' : '') +
        '<div class="resp-b">' + (o.phone ? '<a class="btn btn-wa btn-sm" href="#" data-wa="' + esc(o.phone) + '" data-id="' + o.id + '"><svg><use href="#i-wa"/></svg>WhatsApp</a><a class="btn btn-glass btn-sm" href="tel:+' + esc(o.phone) + '"><svg><use href="#i-phone"/></svg>Звонок</a>' : '') +
        (o.status === 'open' ? '<button type="button" class="btn ' + (o.my ? 'btn-glass' : 'btn-grad') + ' btn-sm" data-take="' + o.id + '">' + (o.my ? 'Изменить цену' : 'Могу за … ₸') + '</button>' : '') +
        (o.mine && o.status === 'taken' ? '<button type="button" class="btn btn-glass btn-sm" data-finish="' + o.id + '">Отметить выполненным</button>' : '') + '</div></article>';
    }).join('') : (feedMeta && feedMeta.needs_city ? '' : '<div class="empty glass"><h2>Пока заказов' + (feedMeta && feedMeta.city ? ' в городе «' + esc(feedMeta.city) + '»' : '') + ' нет</h2><p class="muted">Здесь появляются только заказы вашего города. Лента обновляется каждые 20 секунд. Поставьте статус «Свободен», чтобы клиенты видели вас первым.</p></div>'));
  }
  $('#feedst').addEventListener('click', function () {});
  if (CAB) CAB.bindStatus($('#feedst'), function (s) { if (myCard) myCard.status = s; });
  $('#feedl').addEventListener('click', function (e) {
    var b = e.target.closest('[data-take],[data-wa],[data-finish]'); if (!b) return;
    e.preventDefault();
    var o = (lastFeed || []).filter(function (x) { return x.id === (b.dataset.take || b.dataset.id || b.dataset.finish); })[0]; if (!o) return;
    if (b.dataset.finish) {
      if (!confirm('Отметить заказ выполненным?')) return;
      C.rpc('vz_driver_finish', { p_key: C.key(), p_id: o.id }).then(function () { V.toast('Заказ выполнен'); loadFeed(); }, function (er) { V.toast(er.message); });
      return;
    }
    if (b.dataset.wa) return V.openWA(o.phone, 'Здравствуйте' + (o.name ? ', ' + o.name : '') + '! Я водитель с ВЕЗУ, по вашему заказу: ' + (o.what || 'перевозка') + (o.from ? ', ' + o.from : '') + (o.to ? ' → ' + o.to : '') + '.' + (o.agreed ? ' Цена: ' + V.fmtNum(o.agreed) + ' ₸.' : (o.my && o.my.price ? ' Цена: ' + V.fmtNum(o.my.price) + ' ₸.' : '')));
    var sug = o.calc && o.calc.lo ? [o.calc.lo, Math.round((o.calc.lo + (o.calc.hi || o.calc.lo)) / 2 / 500) * 500, o.calc.hi].filter(function (v, i, a) { return v && a.indexOf(v) === i; }) : [];
    var s = V.sheet('Могу за … ₸', '<p class="muted">' + esc(o.what || V.cargoLabel(o.cargo) || 'Перевозка') + '</p>' +
      (sug.length ? '<div class="qchips">' + sug.map(function (v) { return '<button type="button" class="qchip" data-sug="' + v + '">' + V.fmtNum(v) + ' ₸</button>'; }).join('') + '</div><p class="fine">Подсказки — из примерного расчёта клиента. Ставьте свою цену.</p>' : '') +
      '<label class="fld"><span>Ваша цена</span><input class="inp" name="tp" inputmode="numeric" placeholder="' + (o.calc && o.calc.lo ? V.fmtNum(o.calc.lo) : '10 000') + '" value="' + (o.my && o.my.price ? V.fmtNum(o.my.price) : '') + '"><b class="suffix">₸</b></label>' +
      '<label class="fld"><span>Комментарий</span><input class="inp" name="tc" maxlength="200" placeholder="Буду через 30 минут" value="' + esc(o.my ? o.my.comment : '') + '"></label>' +
      '<button type="button" class="btn btn-grad btn-block" data-go>Откликнуться без цены</button><p class="fine">Клиент увидит ваш отклик и сможет написать вам в WhatsApp. Когда клиент выберет вас, здесь появится его телефон; заказ закроется для остальных.</p>', 'take-sheet');
    var tp = s.el.querySelector('[name=tp]'), go = s.el.querySelector('[data-go]');
    function lbl() { var v = +tp.value.replace(/\D/g, ''); go.textContent = v ? 'Могу за ' + V.fmtNum(v) + ' ₸ — предложить' : 'Откликнуться без цены'; }
    tp.addEventListener('input', function () { tp.value = V.fmtNum(tp.value.replace(/\D/g, '').slice(0, 8)); lbl(); });
    s.el.addEventListener('click', function (ev) { var c = ev.target.closest('[data-sug]'); if (c) { tp.value = V.fmtNum(c.dataset.sug); lbl(); } });
    lbl();
    s.el.querySelector('[data-go]').addEventListener('click', function () {
      C.rpc('vz_order_respond', { p_key: C.key(), p_id: o.id, p_price: +tp.value.replace(/\D/g, '') || null, p_comment: s.el.querySelector('[name=tc]').value }).then(function () {
        s.close(); V.toast('Предложение отправлено! Клиент увидит его и напишет вам'); loadFeed();
      }, function (er) { V.toast(er.message); });
    });
  });

  // ---------- счётчики на нижней панели ----------
  function setBadge(t, n) { var el = document.querySelector('.bnav a[href="#' + t + '"] em'); if (el) { el.textContent = n > 9 ? '9+' : n; el.hidden = !n; } }
  function respCount(a) { return (a || []).reduce(function (s, o) { return s + (o.state === 'open' || o.state === 'taken' ? o.responses.length : 0); }, 0); }
  function seenOrders() { C.ls('vezu-seen-resp', String(respCount(lastOrders))); setBadge('orders', 0); }
  function seenFeed() { C.ls('vezu-seen-feed', (lastFeed || []).map(function (o) { return o.id; }).slice(0, 200)); setBadge('feed', 0); }
  function badges() {
    if (C.ls('vezu-otok') && cur !== 'orders') C.rpc('vz_my_orders', { p_dev: dev() }).then(function (a) { setBadge('orders', Math.max(0, respCount(a) - (+C.ls('vezu-seen-resp') || 0))); }, function () {});
    if (C.key() && cur !== 'feed') C.rpc('vz_feed', { p_key: C.key() }).then(function (a) {
      var seen = C.ls('vezu-seen-feed'); if (!Array.isArray(seen)) seen = [];
      setBadge('feed', (a || []).filter(function (o) { return o.status === 'open' && !o.my && seen.indexOf(o.id) < 0; }).length);
      noticeNew(a || []);
    }, function () {});
  }
  if (C.key()) document.body.classList.add('is-driver');
  F.on(function () { if (cur === 'favs') drawFavs(); });
  C.ready().then(function (ok) {
    if (!ok) { $('#app').insertAdjacentHTML('afterbegin', '<p class="err-msg">Нет связи с сервером ВЕЗУ — заказ можно отправить сразу в WhatsApp.</p>'); }
    show(location.hash.slice(1) || 'order'); badges();
    setInterval(function () { if (!document.hidden) badges(); }, POLL * 3);
  });
})();
