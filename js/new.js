(function () {
  'use strict';
  var V = window.VEZU, f = document.getElementById('f'), KEY = 'vezu-card', PKEY = 'vezu-photo';
  var build = document.getElementById('build');
  var state = { w: '1,5 т', s: '012', pu: 0, f: 0, th: 0 };

  // начальные данные: ?c=… / ?d=… (из «Редактировать визитку») → localStorage → по умолчанию
  var q = new URLSearchParams(location.search), init = null, fromLink = false;
  if (q.get('c') || q.get('d')) { init = V.readCard(); fromLink = !!init; }
  if (!init) try { init = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (init) { init = V.clean(init); delete init.x; state = Object.assign(state, init); if (!init.s) state.s = ''; if (!init.w) state.w = ''; }

  var TEXT = ['n', 't', 'c', 'i', 'm', 'z', 'tg'];
  TEXT.forEach(function (k) { if (state[k] && f.elements[k]) f.elements[k].value = state[k]; });
  function syncCabCity() {
    var city = (V.getCity && V.getCity()) || '';
    if (city) { state.t = city; if (f.elements.t) f.elements.t.value = city; }
    var lab = f.querySelector('[data-city-label]');
    if (lab) lab.textContent = city || 'не выбран';
  }
  if (!state.t && V.getCity) state.t = V.getCity() || state.t;
  syncCabCity();
  if (V.onCityChange) V.onCityChange(syncCabCity);
  document.addEventListener('vezu-city', syncCabCity);
  if (state.tg) f.elements.tg.value = '@' + state.tg;
  if (state.p) f.elements.p.value = V.fmtPhone(state.p);
  if (state.pr) f.elements.pr.value = V.fmtNum(state.pr);
  // тарифы калькулятора: rt = «мин,км город,км межгород,грузчик,этаж,км в минимуме»
  var CALC = window.VEZU_CALC, rtv = String(state.rt || '').split(',');
  if (CALC) CALC.KEYS.forEach(function (k, i) { var el = f.elements['rt' + i]; if (!el) return; el.placeholder = CALC.RATES[k] != null ? String(CALC.RATES[k]) : ''; el.value = rtv[i] || ''; });
  var ratesEl = document.getElementById('rates'); if (ratesEl && state.rt) ratesEl.open = true;
  if (CALC && CALC.onRates) CALC.onRates(function () { CALC.KEYS.forEach(function (k, i) { var el = f.elements['rt' + i]; if (el) el.placeholder = CALC.RATES[k] != null ? String(CALC.RATES[k]) : ''; }); });
  var rtr = document.getElementById('rtreset'); if (rtr) rtr.addEventListener('click', function () { for (var i = 0; i < 6; i++) f.elements['rt' + i].value = ''; update(); });
  var tgphoto = document.getElementById('tgphoto');
  tgphoto.checked = !!(state.f & V.TG_PHOTO);
  // раскрыть «Ещё», если там уже что-то заполнено
  var d1 = f.querySelector('[data-step="1"] details'); if (d1 && (state.tg || state.i || state.m)) d1.open = true;
  var d2 = f.querySelector('[data-step="2"] details'); if (d2 && (state.hs != null || state.z || (state.f & 63))) d2.open = true;

  function chips(el, items, attr) {
    el.innerHTML = items.map(function (x) { return '<button type="button" class="qchip" ' + attr + '="' + V.esc(x.v) + '" aria-pressed="false">' + V.esc(x.l) + '</button>'; }).join('');
  }
  var cap = document.getElementById('cap'), svc = document.getElementById('svc'), ex = document.getElementById('ex'), pay = document.getElementById('pay'),
    pu = document.getElementById('pu'), themes = document.getElementById('themes'), veh = document.getElementById('veh');
  chips(cap, V.CAPACITY.map(function (c) { return { v: c, l: 'до ' + c }; }), 'data-v');
  chips(svc, V.SERVICES.map(function (s, i) { return { v: i, l: s }; }), 'data-i');
  chips(ex, V.EXTRAS.map(function (k, i) { return { v: 1 << i, l: V.t(k) }; }), 'data-bit');
  chips(pay, V.PAYMENTS.map(function (k, i) { return { v: 1 << (i + 3), l: V.t(k) }; }), 'data-bit');
  themes.innerHTML = V.THEMES.map(function (n, i) { return '<button type="button" class="sw th-' + i + '" data-th="' + i + '" aria-pressed="false"><i></i><span>' + V.esc(n) + '</span></button>'; }).join('');

  var hs = f.elements.hs, he = f.elements.he, h24 = document.getElementById('h24');
  var opt = function (h) { return '<option value="' + h + '">' + ('0' + h).slice(-2) + ':00</option>'; };
  var o1 = '<option value="">с …</option>', o2 = '<option value="">до …</option>';
  for (var h = 0; h < 24; h++) o1 += opt(h);
  for (h = 1; h <= 24; h++) o2 += opt(h);
  hs.innerHTML = o1; he.innerHTML = o2;
  if (state.hs != null) { hs.value = state.hs; he.value = state.he; }

  veh.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    f.elements.c.value = b.dataset.c; state.w = b.dataset.w; update();
  });
  cap.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; state.w = state.w === b.dataset.v ? '' : b.dataset.v; update(); });
  svc.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var i = b.dataset.i, s = state.s || '';
    state.s = s.indexOf(i) >= 0 ? s.replace(i, '') : (s + i).split('').sort().join('');
    update();
  });
  [ex, pay].forEach(function (el) { el.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; state.f = (state.f || 0) ^ +b.dataset.bit; update(); }); });
  pu.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; state.pu = +b.dataset.v; update(); });
  themes.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; state.th = +b.dataset.th; update(); });
  tgphoto.addEventListener('change', function () { state.f = (state.f || 0) & ~V.TG_PHOTO | (tgphoto.checked ? V.TG_PHOTO : 0); update(); });
  h24.addEventListener('click', function () {
    if (hs.value === '0' && he.value === '24') { hs.value = ''; he.value = ''; } else { hs.value = '0'; he.value = '24'; }
    update();
  });

  var phone = f.elements.p;
  phone.addEventListener('input', function () {
    var d = phone.value.replace(/\D/g, '');
    if (d[0] === '8') d = '7' + d.slice(1);
    if (d && d[0] !== '7') d = '7' + d;
    d = d.slice(0, 11);
    var o = d ? '+7' : '';
    if (d.length > 1) o += ' ' + d.slice(1, 4);
    if (d.length > 4) o += ' ' + d.slice(4, 7);
    if (d.length > 7) o += ' ' + d.slice(7, 9);
    if (d.length > 9) o += ' ' + d.slice(9, 11);
    phone.value = o;
  });
  f.elements.pr.addEventListener('input', function () { f.elements.pr.value = V.fmtNum(f.elements.pr.value.replace(/\D/g, '').slice(0, 9)); });
  f.addEventListener('input', update);
  f.addEventListener('change', update);
  f.addEventListener('submit', function (e) { e.preventDefault(); });

  // ---- фото с телефона: хранится только на этом устройстве ----
  var phav = document.getElementById('phav'), phdel = document.getElementById('phdel');
  function photo() { try { return JSON.parse(localStorage.getItem(PKEY) || 'null'); } catch (e) { return null; } }
  var lastPhotoFile = null;
  function onPhotoFile(e) {
    var file = e.target.files && e.target.files[0]; if (!file) return;
    lastPhotoFile = file;
    V.resizePhoto(file, 256).then(function (img) {
      try { localStorage.setItem(PKEY, JSON.stringify({ p: V.normPhone(phone.value), img: img })); localStorage.removeItem('vezu-photo-del'); } catch (er) { V.toast('Не удалось сохранить фото'); return; }
      V.toast('Фото сохранено на этом телефоне'); update();
    }, function () { V.toast('Не получилось открыть фото — попробуйте другое'); });
    e.target.value = '';
  }
  ['photo-cam', 'photo-gal', 'photo'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', onPhotoFile);
  });
  phdel.addEventListener('click', function () { var x = photo(); localStorage.removeItem(PKEY); if (x && x.up) localStorage.setItem('vezu-photo-del', '1'); update(); });


  // ---- шаги ----
  var STEPS = ['Фото', 'Имя', 'Телефон', 'Машина', 'Услуги', 'Город', 'Отправка'];
  var step = 1, cloud = null, sending = false;
  var link = '', d = {}, seq = 0, short = '', pvwrap = document.getElementById('pvwrap');
  var Cld = window.VZC;

  function cabCity() { return V.normCity((V.getCity && V.getCity()) || (f.elements.t && f.elements.t.value) || state.t || ''); }
  function hasPhoto() { var p = photo(); return !!(p && p.img); }
  function validStep(n) {
    if (n <= 1) return hasPhoto();
    if (n <= 2) return !!(hasPhoto() && f.elements.n.value.trim());
    if (n <= 3) return !!(hasPhoto() && f.elements.n.value.trim() && V.normPhone(phone.value));
    if (n <= 5) return validStep(3);
    if (n <= 6) return !!(validStep(3) && cabCity());
    return !!(validStep(6));
  }
  function paintBar() {
    var el = document.querySelector('[data-wizbar] i');
    var tot = step >= 8 ? 7 : step;
    if (el) el.style.width = Math.round((tot / 7) * 100) + '%';
    var i = document.querySelector('[data-wizi]'), t = document.querySelector('[data-wizt]');
    if (i) i.textContent = step >= 8 ? '7' : String(step);
    if (t) t.textContent = step >= 8 ? 'Готово' : STEPS[step - 1];
    var top = document.querySelector('.wiz-top');
    if (top) top.hidden = step >= 8;
  }
  function go(n) {
    n = +n;
    if (n > step && n <= 7) {
      if (n > 1 && !hasPhoto()) { n = 1; V.toast('Сначала добавьте фото машины'); }
      else if (n > 2 && !f.elements.n.value.trim()) { n = 2; f.elements.n.classList.add('bad'); f.elements.n.focus(); }
      else if (n > 3 && !V.normPhone(phone.value)) { n = 3; phone.classList.add('bad'); phone.focus(); }
      else if (n > 6 && !cabCity()) { n = 6; if (V.openCitySheet) V.openCitySheet(); V.toast('Выберите город в шапке'); }
    }
    step = n; build.dataset.step = n;
    var proEl = document.getElementById('pro');
    if (proEl) proEl.hidden = n !== 8 || location.hash !== '#pro';
    document.querySelectorAll('.step[data-step]').forEach(function (s) { s.hidden = +s.dataset.step !== n; });
    paintBar();
    if (n === 7) paintSum();
    var bar = document.querySelector('.wiz-top') || build;
    try { bar.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-next],[data-go]'); if (!b) return;
    e.preventDefault();
    go(+(b.dataset.next || b.dataset.go));
  });

  function on(el, test) { if (!el) return; el.querySelectorAll('button').forEach(function (b) { var v = test(b); b.classList.toggle('on', v); b.setAttribute('aria-pressed', v); }); }
  function update() {
    TEXT.forEach(function (k) { if (f.elements[k]) state[k] = f.elements[k].value.trim(); });
    state.p = V.normPhone(phone.value);
    if (f.elements.pr) state.pr = f.elements.pr.value;
    var rt = []; for (var ri = 0; ri < 6; ri++) { var re = f.elements['rt' + ri]; if (re) { re.value = re.value.replace(/\D/g, '').slice(0, 6); rt.push(re.value); } }
    state.rt = rt.join('').length ? rt.join(',') : '';
    if (hs) state.hs = hs.value; if (he) state.he = he.value;
    d = V.clean(state);
    var err = document.getElementById('err1'); if (err) err.hidden = true;
    f.elements.n.classList.remove('bad'); phone.classList.remove('bad');
    var cnt = document.getElementById('cnt'); if (cnt) cnt.textContent = (state.m || '').length + '/80';
    on(cap, function (b) { return b.dataset.v === state.w; });
    on(svc, function (b) { return (state.s || '').indexOf(b.dataset.i) >= 0; });
    on(ex, function (b) { return !!((state.f || 0) & +b.dataset.bit); });
    on(pay, function (b) { return !!((state.f || 0) & +b.dataset.bit); });
    on(pu, function (b) { return +b.dataset.v === (state.pu || 0); });
    on(themes, function (b) { return +b.dataset.th === (state.th || 0); });
    on(veh, function (b) { return V.vehicle(d) === b.dataset.k; });
    var ph = photo(), src = ph && ph.img;
    if (ph && d.p && ph.p !== d.p) { ph.p = d.p; try { localStorage.setItem(PKEY, JSON.stringify(ph)); } catch (e) {} }
    if (phav) phav.innerHTML = src ? '<img src="' + src + '" alt="">' : '<span>' + V.esc(V.initials(d.n || '?')) + '</span>';
    if (phdel) phdel.hidden = !src;
    if (pvwrap) V.applyTheme(pvwrap, d.th);
    var pv = document.getElementById('pv'); if (pv) pv.innerHTML = V.cardHero(d, true, { local: true });
    var det = V.cardDetails(d), pvd = document.getElementById('pvd');
    if (pvd) { pvd.innerHTML = det; pvd.hidden = !det; }
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
    if (window.VEZU_PRO && VEZU_PRO.changed) window.VEZU_PRO.changed(d);
    var ok = !!(d.n && d.p);
    var rb = document.getElementById('rbody'); if (rb) rb.classList.toggle('locked', !ok);
    if (!ok) { setLink(''); paintSum(); return; }
    var my = ++seq;
    if (short) { setLink(short); paintSum(); return; }
    setLink(V.cardUrl(d));
    paintSum();
    if (V.cardUrlAsync) V.cardUrlAsync(d).then(function (u) { if (my === seq && !short) setLink(u); });
  }
  function paintSum() {
    var box = document.getElementById('sendsum'); if (!box) return;
    var svc = V.services(d).join(', ');
    box.innerHTML = '<ul class="sum-list">' +
      '<li><b>Фото:</b> ' + (hasPhoto() ? 'есть' : 'нет') + '</li>' +
      '<li><b>Имя:</b> ' + V.esc(d.n || '—') + '</li>' +
      '<li><b>Телефон:</b> ' + V.esc(d.p ? V.fmtPhone(d.p) : '—') + '</li>' +
      '<li><b>Машина:</b> ' + V.esc([d.c, d.w].filter(Boolean).join(' · ') || '—') + '</li>' +
      '<li><b>Услуги:</b> ' + V.esc(svc || '—') + '</li>' +
      '<li><b>Город:</b> ' + V.esc(cabCity() || '—') + '</li></ul>';
  }
  window.VEZU_B = {
    data: function () { return d; }, photo: photo, refresh: update,
    setShort: function (u) { if (short !== (u || '')) { short = u || ''; update(); } },
    setForm: function (x) { if (f.elements.n.value.trim()) return false; init = V.clean(x); location.replace('new.html?c=' + V.encodeSync(init)); return true; }
  };
  function setLink(u) {
    link = u || '';
    var inp = document.getElementById('link'); if (inp) inp.value = u || '';
    var a = document.getElementById('open'); if (a) a.href = u || '#';
    var q = document.getElementById('qr'); if (q && V.qrSvg) q.innerHTML = u ? V.qrSvg(u) : '';
  }

  function moderation(c) {
    if (!c) return { k: 'none', l: 'Не отправлена' };
    if (c.verify_pending) return { k: 'pending', l: 'На проверке' };
    if (c.verified_at) return { k: 'ok', l: 'Одобрена' };
    if (c.verify_note) return { k: 'fix', l: 'Нужно исправить' };
    return { k: 'none', l: 'Не отправлена' };
  }
  function statusHtml(c, justSent) {
    var m = moderation(c);
    var title = justSent || m.k === 'pending' ? '✅ Ваша визитка отправлена на проверку' : m.k === 'ok' ? '✅ Визитка одобрена' : m.k === 'fix' ? 'Нужно исправить визитку' : 'Черновик визитки';
    var text = m.k === 'pending' ? 'Админ посмотрит данные и фото. Статус «На проверке» уже здесь; когда решение будет готово, он обновится. Если подключите Telegram в настройках — придёт сообщение.' :
      m.k === 'ok' ? 'Визитка одобрена. Её можно открывать, делиться ссылкой и QR.' :
      m.k === 'fix' ? ('Комментарий админа: ' + (c.verify_note || 'Проверьте данные и фото, затем отправьте ещё раз.')) :
      'Заполните шаги и нажмите «Отправить» — визитка уйдёт на проверку.';
    return '<div class="sent-st st-' + m.k + '"><p class="st-badge ' + m.k + '">' + V.esc(m.l) + '</p><h2>' + title + '</h2><p class="muted">' + V.esc(text) + '</p>' +
      (link ? '<div class="res-btns" style="margin-top:12px"><a class="btn btn-grad btn-block" href="app.html#mycard">Открыть мою визитку</a><a class="btn btn-glass btn-block" href="' + V.esc(link) + '" target="_blank" rel="noopener">Открыть как клиент</a></div>' : '') +
      '</div>';
  }
  function paintStatus(c, justSent) {
    cloud = c || cloud;
    var box = document.getElementById('sentbox');
    if (box) box.innerHTML = statusHtml(cloud, justSent);
  }

  function syncPhotoIfAny() {
    if (!Cld || !Cld.uploadPhoto) return Promise.resolve();
    var x = photo();
    if (!x || !x.img) return Promise.resolve();
    return Cld.uploadPhoto(x.img).then(function (path) {
      if (path && cloud) cloud.photo = path;
      x.up = '1'; try { localStorage.setItem(PKEY, JSON.stringify(x)); } catch (e) {}
    }, function () { /* фото в облако — если нет Про, останется на телефоне */ });
  }
  function submitVerify(key) {
    var plate = (f.elements.plate && f.elements.plate.value || '').trim();
    var run = function (im) { return Cld.verifyCall({ key: key, plate: plate, car: im || '', consent: V.CONSENT.verify.v }); };
    if (lastPhotoFile && Cld.shrinkJpeg) return Cld.shrinkJpeg(lastPhotoFile).then(run, function () { return run(''); });
    return run('');
  }
  function sendCard() {
    if (sending) return;
    update();
    if (!hasPhoto()) { go(1); V.toast('Добавьте фото машины'); return; }
    if (!d.n) { go(2); V.toast('Укажите имя'); return; }
    if (!d.p) { go(3); V.toast('Укажите номер WhatsApp'); return; }
    if (!cabCity()) { go(6); V.toast('Выберите город в шапке'); return; }
    var cons = consentV && consentV();
    if (!cons) { V.toast('Поставьте галочку согласия на обработку данных'); return; }
    sending = true;
    var btn = document.getElementById('sendcard');
    if (btn) { btn.disabled = true; btn.textContent = 'Отправляю…'; }
    var first = !(Cld.key && Cld.key());
    var k = Cld.key() || Cld.newKey();
    Cld.rpc('vz_save_card', {
      p_key: k, p_data: d, p_slug: null, p_veh: V.vehicle(d) || '',
      p_published: true, p_ref: first ? (Cld.ls('vezu-ref') || null) : null, p_consent: cons
    }).then(function (c) {
      cloud = c;
      try { Cld.ls('vezu-consent-driver', cons); document.body.classList.add('is-driver'); } catch (e) {}
      if (c && c.slug) { short = Cld.shortUrl(c.slug); setLink(short); }
      return syncPhotoIfAny().then(function () { return submitVerify(k); });
    }).then(function (st) {
      sending = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Отправить'; }
      if (cloud) cloud.verify_pending = !st || st.state === 'pending' || st === 'pending';
      if (st && st.state === 'already' && cloud) { cloud.verify_pending = false; cloud.verified_at = cloud.verified_at || new Date().toISOString(); }
      paintStatus(cloud, true);
      go(8);
      V.toast('Отправлено на проверку');
    }, function (e) {
      sending = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Отправить'; }
      var msg = (e && e.message) || 'Не удалось отправить';
      if (/already|уже проверен/i.test(msg) && cloud) { cloud.verified_at = cloud.verified_at || new Date().toISOString(); paintStatus(cloud, false); go(8); return; }
      var err = document.getElementById('err1'); if (err) { err.hidden = false; err.textContent = msg; }
      V.toast(msg);
    });
  }

  var consentV = null;
  var consbox = document.getElementById('consbox');
  if (consbox) {
    consbox.innerHTML = V.consentHtml('driver', Cld.ls && Cld.ls('vezu-consent-driver') === V.CONSENT.driver.v);
    var sendBtn = document.getElementById('sendcard');
    consentV = V.consentGate(consbox, 'driver', sendBtn);
  }
  if (document.getElementById('sendcard')) document.getElementById('sendcard').addEventListener('click', sendCard);

  var copyB = document.getElementById('copy'); if (copyB) copyB.addEventListener('click', function () { if (link) V.copy(link); });
  var shareB = document.getElementById('share'); if (shareB) shareB.addEventListener('click', function () { if (link) V.share('Моя визитка — ' + d.n, 'Грузоперевозки: ' + d.n + '. Заказ в WhatsApp:', link); });
  if (document.getElementById('install')) V.bindInstall(document.getElementById('install'));

  update();

  function bootStatus() {
    if (!Cld || !Cld.key || !Cld.key() || !Cld.rpc) { go(fromLink && validStep(3) ? 7 : 1); return; }
    Cld.rpc('vz_me', { p_key: Cld.key() }).then(function (c) {
      cloud = c;
      if (c && c.slug) { short = Cld.shortUrl(c.slug); setLink(short); }
      paintStatus(c, false);
      var m = moderation(c);
      if (location.hash === '#pro') { go(8); var pro = document.getElementById('pro'); if (pro) pro.hidden = false; return; }
      if (m.k === 'pending' || m.k === 'ok' || m.k === 'fix') go(8);
      else go(1);
    }, function () { go(1); });
  }
  bootStatus();
})();
