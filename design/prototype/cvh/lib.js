/* CVH prototype helpers. Pure functions over CVH_DATA and CVH_STRINGS; no UI is built here.
   Screens call these from renderVals() and bind the results into their markup. */
(function () {
  var W = window;
  W.CVH_STRINGS = W.CVH_STRINGS || {};

  function D() { return W.CVH_DATA || {}; }
  function byId(list, id) { list = list || []; for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  // Merge a language table over English. A key missing in the language is shown with a
  // visible "[EN]" marker rather than silently falling back (brief 3.2.2). Phase 1 only
  // ships interface strings for the shell and components in all fifteen languages.
  var cache = {};
  function mergeMarked(en, tr, code) {
    var out = {};
    for (var k in en) {
      var e = en[k], t = tr ? tr[k] : undefined;
      if (isObj(e)) out[k] = mergeMarked(e, isObj(t) ? t : null, code);
      else if (t !== undefined && t !== null && t !== '') out[k] = t;
      else out[k] = (code === 'en') ? e : (Array.isArray(e) ? e : '[EN] ' + e);
    }
    if (tr) for (var k2 in tr) if (!(k2 in out)) out[k2] = tr[k2];
    return out;
  }
  function strings(code) {
    code = code || 'en';
    if (!cache[code]) {
      var en = W.CVH_STRINGS.en || {};
      cache[code] = code === 'en' ? en : mergeMarked(en, W.CVH_STRINGS[code] || {}, code);
    }
    return cache[code];
  }
  function missingCount(code) {
    var n = 0; var en = W.CVH_STRINGS.en || {}; var tr = W.CVH_STRINGS[code] || {};
    (function walk(e, t) { for (var k in e) { if (isObj(e[k])) walk(e[k], isObj(t && t[k]) ? t[k] : null); else if (!t || t[k] === undefined) n++; } })(en, tr);
    return n;
  }
  function fill(str, vars) {
    if (typeof str !== 'string') return str;
    return str.replace(/\{(\w+)\}/g, function (m, k) { return (vars && vars[k] !== undefined && vars[k] !== null) ? vars[k] : m; });
  }

  function lang(code) { return byId((D().languages || []).map(function (l) { return Object.assign({ id: l.code }, l); }), code) || { code: 'en', bcp47: 'en', dir: 'ltr', native: 'English', english: 'English' }; }
  function dir(code) { return lang(code).dir || 'ltr'; }
  function bcp(code) { return lang(code).bcp47 || code; }

  // Whole units, never decimals: "3 hours 20 minutes ago" (brief 3.1.1, Section 7)
  function duration(mins, code) {
    var t = strings(code).time || {};
    mins = Math.max(0, Math.round(mins));
    var d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    function unit(n, one, many) { return fill(n === 1 ? one : many, { n: n }); }
    var parts = [];
    if (d) { parts.push(unit(d, t.day, t.days)); if (h) parts.push(unit(h, t.hour, t.hours)); }
    else if (h) { parts.push(unit(h, t.hour, t.hours)); if (m) parts.push(unit(m, t.minute, t.minutes)); }
    else parts.push(unit(m, t.minute, t.minutes));
    return parts.join(t.join || ' ');
  }
  function ago(mins, code) {
    var t = strings(code).time || {};
    if (mins < 1) return t.justNow || 'Just now';
    return fill(t.ago || '{t} ago', { t: duration(mins, code) });
  }
  function seconds(secs, code) {
    var t = strings(code).time || {};
    if (secs < 60) return fill(secs === 1 ? t.second : t.seconds, { n: secs });
    var m = Math.floor(secs / 60), s = secs % 60;
    var out = fill(m === 1 ? t.minute : t.minutes, { n: m });
    if (s) out += (t.join || ' ') + fill(s === 1 ? t.second : t.seconds, { n: s });
    return out;
  }

  // Phone numbers: accept any common format, show back as (416) 555-0123 (brief 3.2.1)
  function phone(input) {
    var digits = String(input || '').replace(/\D/g, '');
    if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
    if (digits.length !== 10) return { ok: false, digits: digits, formatted: null };
    return { ok: true, digits: digits, formatted: '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6) };
  }

  var DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  function toMins(hhmm) { var p = hhmm.split(':'); return (+p[0]) * 60 + (+p[1]); }
  function clock(scenario) { var s = (D().scenarios || {})[scenario || D().defaultScenario] || { clock: { day: 'tue', time: '14:30' } }; return s.clock; }
  function openNow(hours, scenario) {
    if (!hours || hours === 'unknown') return 'unknown';
    var c = clock(scenario), today = hours[c.day];
    if (!today) return false;
    var n = toMins(c.time);
    return n >= toMins(today[0]) && n < toMins(today[1]);
  }
  function spaceState(space) {
    if (!space) return null;
    var after = D().unconfirmedAfterMins || 240;
    if (space.status === 'open' && space.confirmedMinsAgo > after) return 'unconfirmed';
    if (space.confirmedMinsAgo > after) return 'unconfirmed';
    return space.status;
  }

  // Content text: English source lives in CVH_DATA; other languages in each string table
  // under content[recordId][field]. Returns { text, lang, translated, unavailable }.
  function content(record, field, code) {
    if (!record) return { text: '', unavailable: true };
    var src = record.sourceLang || 'en';
    code = code || 'en';
    if ((record.untranslated || []).indexOf(code) >= 0) return { text: record[field], lang: 'en', unavailable: true };
    if (code === 'en' || code === src) return { text: record[field], lang: src, translated: false };
    var tr = ((W.CVH_STRINGS[code] || {}).content || {})[record.id];
    if (tr && tr[field]) return { text: tr[field], lang: code, translated: true, machine: true, from: src };
    return { text: record[field], lang: src, unavailable: true };
  }

  W.CVH = {
    data: function () { if (W.CVH && W.CVH.session && W.CVH_DATA) W.CVH.session.ensure(); return D(); }, strings: strings, fill: fill, missingCount: missingCount,
    lang: lang, dir: dir, bcp: bcp, duration: duration, ago: ago, seconds: seconds, phone: phone,
    openNow: openNow, clock: clock, spaceState: spaceState, content: content, days: DAYS,
    byId: byId,
    building: function (id) { return byId(D().buildings, id); },
    listing: function (id) { return byId(D().listings, id); },
    asset: function (id) { return byId(D().assets, id); },
    space: function (id) { return byId(D().spaces, id); },
    alert: function (id) { return byId(D().alerts, id); },
    org: function (id) { return byId(D().orgs, id); },
    person: function (id) { return byId(D().people, id); },
    persona: function (id) { return byId(D().personas, id); },
    screen: function (id) { return byId((W.CVH_INVENTORY || {}).screens, id); },
    flow: function (id) { return byId((W.CVH_INVENTORY || {}).flows, id); },
    // Logos from the design system (copied into this canvas's asset store; brief: one mark in the header, the Hub)
    logo: { hub: 'assets/logos/hub.png', hubWhite: 'assets/logos/hub-white.png', symbol: 'assets/logos/symbol.png', sprout: 'assets/logos/sprout.png' }
  };
})();

/* ---------------------------------------------------------------------------------------
   Phase 2 helpers: scenarios and alert snapshots, listings, search and filters, distance,
   hours, text-message composition. Pure functions; screens bind the results. */
(function () {
  var W = window, C = W.CVH;
  function D() { return W.CVH_DATA || {}; }
  var DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  function toMins(hhmm) { var p = hhmm.split(':'); return (+p[0]) * 60 + (+p[1]); }
  function hhmm12(t) { var m = toMins(t), h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return h + (mm ? ':' + (mm < 10 ? '0' : '') + mm : '') + ' ' + ap; }

  /* ---- Alerts ------------------------------------------------------------------------ */
  function snap(ref, scn) {
    if (typeof ref === 'string') ref = scn ? refFor(ref, scn) : { id: ref };
    var a = C.alert(ref.id); if (!a) return null;
    var oldest = a.entries.slice().reverse();
    var cut = oldest.length;
    if (ref.upto) { for (var i = 0; i < oldest.length; i++) if (oldest[i].id === ref.upto) cut = i + 1; }
    else if (a.entries.some(function (e) { return e.resolvedState; })) cut = oldest.filter(function (e) { return !e.resolvedState; }).length;
    var status = ref.status || a.status;
    var list = oldest.slice(0, cut);
    if (status === 'resolved') {
      var fin = oldest.filter(function (e) { return e.kind === 'final'; })[0];
      if (fin && list.indexOf(fin) < 0) list.push(fin);
    } else list = list.filter(function (e) { return e.kind !== 'final'; });
    var shift = ref.shift || 0;   // the same alert seen from a later scenario happened earlier
    var resolvedMins = (a.resolvedMinsAgo != null ? a.resolvedMinsAgo : 30) + shift;
    var entries = list.map(function (e) { var x = Object.assign({}, e); if (x.minsAgo === null || x.minsAgo === undefined) x.minsAgo = resolvedMins; else x.minsAgo += shift; return x; }).reverse();
    var hasCorr = entries.some(function (e) { return e.kind === 'correction'; });
    var first = entries[entries.length - 1], latest = entries[0];
    var nyk = a.notYetKnown; entries.forEach(function (e) { if (e.notYetKnown && !nyk) nyk = e.notYetKnown; });
    var latestNyk = null; for (var j = 0; j < entries.length; j++) if (entries[j].notYetKnown) { latestNyk = entries[j].notYetKnown; break; }
    var corrections = entries.filter(function (e) { return e.kind === 'correction'; });
    return { id: a.id, a: a, status: status, entries: entries, first: first, latest: latest,
      isAck: entries.length === 1 && first.kind === 'ack', corrected: hasCorr, corrections: corrections,
      where: (!hasCorr && first && first.whereAtTime) ? first.whereAtTime : a.where,
      notYetKnown: status === 'resolved' ? null : (latestNyk || a.notYetKnown),
      postedMins: first ? first.minsAgo : 0, updatedMins: latest ? latest.minsAgo : 0,
      expiredMins: (a.expiredMinsAgo || 60) + shift, resolvedMins: resolvedMins, day: ref.day || null, days: a.ongoingDays || null };
  }
  function scenarioAlerts(scn) {
    var s = (D().scenarioAlerts || {})[scn] || { active: [], archive: [] };
    return { active: s.active.map(function (r) { return snap(r, scn); }).filter(Boolean), archive: s.archive.map(function (r) { return snap(r, scn); }).filter(Boolean) };
  }
  function refFor(id, scn) {
    var s = (D().scenarioAlerts || {})[scn] || { active: [], archive: [] };
    var all = s.active.concat(s.archive);
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return { id: id };
  }
  function affectsBuilding(a, building, floor) {
    if (!building) return false;
    if (a.origin && a.origin.type === 'ambassador' && a.origin.building === building) return true;
    var pl = a.audience && a.audience.place; if (!pl || !pl.buildings) return (a.where || '').indexOf((C.building(building) || {}).name || '@@') >= 0;
    if (pl.buildings.indexOf(building) < 0) return false;
    return true;
  }
  function checkinCovered(building, floor) {
    var amb = D().ambassadors || [];
    for (var i = 0; i < amb.length; i++) if (((amb[i].floors || {})[building] || []).indexOf(floor) >= 0) return true;
    return false;
  }

  /* ---- Listings: one object, many doors ---------------------------------------------- */
  var CAT_BY_SUB = { 'Food Collaboratives': 'food', 'Food Security & Climate Resilience': 'food', 'Health Clinics': 'health', 'Dental Clinics': 'health', 'Midwives Clinic': 'health',
    'Legal Services': 'legal', 'Housing & Tenant Supports': 'housing', 'Newcomer Supports': 'settlement', 'Government Documentation': 'settlement',
    'Employment & Skills Training': 'jobs', 'Schools': 'children', 'Childminding & EarlyON': 'children', 'Family & Parenting Support': 'children' };
  var cache = {};
  function listingFor(id) {
    if (cache[id]) return cache[id];
    var l = C.listing(id);
    if (l) return (cache[id] = l);
    var a = C.asset(id); if (!a) return null;
    if (a.listings && a.listings.length) return (cache[id] = C.listing(a.listings[0]));
    var s = C.strings('en').subcats || {};
    var sub = s[a.subcats[0]] || a.subcats[0];
    var nb = (C.strings('en').neighbourhoods || {})[a.nbhd] || '';
    var cats = []; a.subcats.forEach(function (x) { if (CAT_BY_SUB[x] && cats.indexOf(CAT_BY_SUB[x]) < 0) cats.push(CAT_BY_SUB[x]); });
    return (cache[id] = { id: a.id, assetId: a.id, derived: true, name: a.name, kind: a.kind, categories: cats,
      firstLine: sub + (nb ? ', ' + nb : '') + '.', serviceTypes: a.subcats.map(function (x) { return s[x] || x; }).join(', '),
      hours: 'unknown', languages: 'unknown', cost: 'unknown', bring: 'unknown', idRequired: 'unknown', stepFree: 'unknown', appointment: 'unknown',
      costNote: null, idNote: null, accessNote: null, address: a.address, place: a.place, nbhd: a.nbhd, phone: a.phone, email: a.email, web: a.web,
      helps: a.helps || {}, kit: !!a.kit, utilities: a.utilities || [], confirmed: { source: 'public' }, needs: [], sourceLang: a.sourceLang || 'en',
      communityOffer: a.kind === 'communityOffer', untranslated: [], illustrative: true });
  }
  function assetOf(l) { return C.asset(l.assetId); }
  function spaceOf(l) { var a = assetOf(l); return a && a.space ? C.space(a.space) : null; }

  /* ---- Place, distance, hours -------------------------------------------------------- */
  function home(choices) {
    var b = choices && choices.building ? C.building(choices.building) : null;
    if (b && b.lat) return { lat: b.lat, lng: b.lng };
    var nb = choices && choices.nbhd === 'FP' ? { lat: 43.7142, lng: -79.3300 } : { lat: 43.7052, lng: -79.3445 };
    return nb;
  }
  function km(p, q) {
    var R = 6371, dLat = (q.lat - p.lat) * Math.PI / 180, dLng = (q.lng - p.lng) * Math.PI / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(p.lat * Math.PI / 180) * Math.cos(q.lat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function distOf(l, choices) { var a = assetOf(l); if (!a) return null; return km(home(choices), { lat: a.lat, lng: a.lng }); }
  function clockOf(scn) { return C.clock(scn); }
  function hoursToday(hours, scn) {
    if (!hours || hours === 'unknown') return null;
    var t = hours[clockOf(scn).day]; return t ? hhmm12(t[0]) + ' to ' + hhmm12(t[1]) : 'closed';
  }
  function nextOpen(hours, scn) {
    if (!hours || hours === 'unknown') return null;
    var c = clockOf(scn), di = DAYS.indexOf(c.day), now = toMins(c.time);
    for (var k = 0; k < 8; k++) {
      var d = DAYS[(di + k) % 7], t = hours[d]; if (!t) continue;
      if (k === 0 && now >= toMins(t[0])) continue;
      return { k: k, day: d, time: t[0], text: (k === 0 ? 'today at ' : k === 1 ? 'tomorrow at ' : 'on ' + (C.strings('en').time.days7[d]) + ' at ') + hhmm12(t[0]) };
    }
    return null;
  }
  function openInfo(l, scn) {
    var o = C.openNow(l.hours, scn);
    if (o === 'unknown') return { state: 'unknown', text: 'Hours not known' };
    if (o) { var t = l.hours[clockOf(scn).day]; return { state: 'open', text: 'Open now, until ' + hhmm12(t[1]) }; }
    var n = nextOpen(l.hours, scn); return { state: 'closed', text: 'Closed now' + (n ? '. Opens ' + n.text : '') };
  }

  /* ---- Filters ----------------------------------------------------------------------- */
  var FILTER = {
    openNow: function (l, v, ctx) { return C.openNow(l.hours, ctx.scn) === true; },
    nbhdTP: function (l) { return l.nbhd === 'TP'; }, nbhdFP: function (l) { return l.nbhd === 'FP'; },
    language: function (l, v) { return Array.isArray(l.languages) && l.languages.indexOf(v) >= 0; },
    free: function (l) { return l.cost === 'free'; }, lowCost: function (l) { return l.cost === 'free' || l.cost === 'lowCost'; },
    noId: function (l) { return l.idRequired === 'no'; }, stepFree: function (l) { return l.stepFree === 'yes'; },
    noAppointment: function (l) { return l.appointment === 'no'; }
  };
  function filterLabel(f, lang) {
    var sh = C.strings(lang || 'en').filters.short;
    if (f.id === 'language') return C.fill(sh.language, { lang: C.lang(f.value).native });
    return sh[f.id] || f.id;
  }
  function applyFilters(list, filters, ctx) {
    return list.filter(function (r) { return (filters || []).every(function (f) { return FILTER[f.id] ? FILTER[f.id](r.listing, f.value, ctx) : true; }); });
  }
  function tailorFilters(choices) {
    var out = [], g = (choices && choices.groups) || [];
    if (g.indexOf('newcomers') >= 0) out.push({ id: 'noId', fromChoices: true });
    if (g.indexOf('seniors') >= 0) out.push({ id: 'stepFree', fromChoices: true });
    return out;
  }

  /* ---- Search (scripted for the demonstrations, keyword match otherwise) ------------ */
  var STOP = ['a','an','the','i','my','me','to','for','of','and','in','on','is','it','need','want','help','with','some','so','can','he','she','out','get','where'];
  function norm(q) { return String(q || '').toLowerCase().replace(/[.,!?;:"']/g, '').replace(/\s+/g, ' ').trim(); }
  function search(o) {
    var q = norm(o.q), lang = o.lang || 'en', ctx = { scn: o.scn };
    var demo = null; (D().searchDemos || []).forEach(function (d) { if (norm(d.query) === q && q) demo = d; });
    var results = [];
    var seen = {};
    function add(l, reason, extra) { if (!l || seen[l.id]) return; seen[l.id] = 1; results.push(Object.assign({ listing: l, reason: reason }, extra || {})); }
    if (o.hazard) {
      var assets = (D().assets || []).filter(function (a) { return a.helps && a.helps[o.hazard]; });
      assets.forEach(function (a) { var l = listingFor(a.id); add(l, null, { help: a.helps[o.hazard] }); });
    } else if (demo && demo.kind === 'noMatchFilters') {
      (D().listings || []).forEach(function (l) { if ((l.categories || []).indexOf('food') >= 0) add(l, null); });
    } else if (demo) {
      demo.results.forEach(function (id) { add(C.listing(id), (demo.reasons || {})[id]); });
    } else if (q) {
      var toks = q.split(' ').filter(function (t) { return t.length > 2 && STOP.indexOf(t) < 0; });
      var scored = (D().listings || []).map(function (l) {
        var sc = 0, why = null;
        (l.needs || []).forEach(function (n) { var nn = norm(n); if (q.indexOf(nn) >= 0 || nn === q) { sc += 5; why = why || n; } else toks.forEach(function (t) { if (nn.indexOf(t) >= 0) { sc += 2; why = why || n; } }); });
        var hay = norm(l.firstLine + ' ' + l.serviceTypes + ' ' + l.name);
        toks.forEach(function (t) { if (hay.indexOf(t) >= 0) sc += 1; });
        return { l: l, sc: sc, why: why };
      }).filter(function (x) { return x.sc > 0; }).sort(function (a, b) { return b.sc - a.sc; });
      scored.forEach(function (x) { add(x.l, x.why ? 'Matched: ' + x.why : null); });
    } else if (o.cat) {
      (D().listings || []).forEach(function (l) { add(l, null); });
    }
    if (o.cat) results = results.filter(function (r) { return (r.listing.categories || []).indexOf(o.cat) >= 0; });
    results.forEach(function (r) {
      var l = r.listing;
      r.cross = lang !== (l.sourceLang || 'en') && (demo && demo.lang !== 'en' ? true : l.sourceLang !== 'en');
      if (demo && demo.kind === 'crossLanguage') r.cross = true;
      r.contributed = !!l.communityOffer;
      r.open = openInfo(l, o.scn); r.dist = distOf(l, o.choices);
      var cf = l.confirmed || {}; r.confirmedDate = cf.date || null;
    });
    if (o.hazard) {
      results.sort(function (a, b) {
        var oa = a.open.state === 'open' ? 0 : 1, ob = b.open.state === 'open' ? 0 : 1; if (oa !== ob) return oa - ob;
        var da = a.dist == null ? 99 : a.dist, db = b.dist == null ? 99 : b.dist; if (Math.abs(da - db) > 0.05) return da - db;
        return (b.confirmedDate || '').localeCompare(a.confirmedDate || '');
      });
    }
    var shown = applyFilters(results, o.filters, ctx);
    var suggestion = null;
    if (!shown.length && results.length && (o.filters || []).length) {
      var best = null;
      o.filters.forEach(function (f) {
        var rest = o.filters.filter(function (g) { return g !== f; });
        var n = applyFilters(results, rest, ctx);
        if (!best || n.length > best.n.length) best = { f: f, n: n };
      });
      if (best && best.n.length) {
        var soon = null;
        best.n.forEach(function (r) { var no = nextOpen(r.listing.hours, o.scn); if (no && (!soon || no.k < soon.no.k || (no.k === soon.no.k && toMins(no.time) < toMins(soon.no.time)))) soon = { r: r, no: no }; });
        suggestion = { filter: best.f, count: best.n.length, when: soon ? soon.no.text : null };
      }
    }
    // when the demonstration names a specific combination with no match, prefer its scripted wording
    return { demo: demo, all: results, shown: shown, hidden: results.length - shown.length, suggestion: suggestion };
  }

  /* ---- Text messages (R-04, R-06, R-30): composed from the alert, fixed order -------- */
  function sms(sn, o) {
    o = o || {}; var s = C.strings(o.lang || 'en'), a = sn.a, lines = [];
    var x13 = s.x13, types = (a.types || []).map(function (t) { return x13[t] || t; }).join(', ');
    if (o.exercise) lines.push(s.x10.sms);
    if (o.kind === 'update' || o.kind === 'correction' || o.kind === 'resolved') {
      var e = o.entry || sn.latest;
      if (o.kind === 'update') lines.push(C.fill(s.R04.update, { headline: a.headline }), e.text);
      if (o.kind === 'correction') lines.push(C.fill(s.R04.correction, { headline: a.headline, changed: e.text }));
      if (o.kind === 'resolved') lines.push(C.fill(s.R04.resolved, { headline: a.headline, final: e.text }));
      lines.push(level(sn, s));
    } else {
      lines.push(types + ': ' + a.headline + '.');
      if (sn.notYetKnown) lines.push(sn.notYetKnown + '.');
      lines.push(level(sn, s));
      if (sn.isAck) lines.push(s.R04.ackMore);
      lines.push(sn.where + '.');
      lines.push(a.action);
      if (o.nearest) { var sp = C.space(o.nearest), as = C.asset(sp.assetId); lines.push(C.fill(s.R04.nearestSpace, { space: as.name, hours: sp.hoursToday ? 'until ' + hhmm12(sp.hoursToday[1]) : '' })); }
      if (o.tailored) lines.push(s.x12.checkin);
    }
    if (o.link !== false) lines.push(C.fill(s.R04.link, { url: 'cvh.example/a/' + a.id.replace('AL-', '') }));
    lines.push(s.R04.stop);
    return lines;
  }
  function level(sn, s) {
    var a = sn.a;
    if (a.level === 'official') return C.fill(s.R04.levelOfficial, { source: s.x02.sources[a.origin.source] });
    if (a.origin.type === 'ambassador') return sn.promoted ? 'Community alert from a building ambassador. Verified by the Hub.' : s.R04.levelAmbassador;
    if (a.origin.type === 'partner') return 'Community alert from ' + (C.org(a.origin.org) || {}).name + '. Verified by ' + (C.org(a.origin.org) || {}).name + '.';
    return s.R04.levelCommunity;
  }

  Object.assign(C, { snap: snap, scenarioAlerts: scenarioAlerts, refFor: refFor, affectsBuilding: affectsBuilding, checkinCovered: checkinCovered,
    listingFor: listingFor, assetOf: assetOf, spaceOf: spaceOf, home: home, km: km, distOf: distOf, hoursToday: hoursToday, nextOpen: nextOpen,
    openInfo: openInfo, hhmm12: hhmm12, FILTER: FILTER, filterLabel: filterLabel, applyFilters: applyFilters, tailorFilters: tailorFilters,
    search: search, norm: norm, sms: sms, smsLevel: level, resetListingCache: function () { cache = {}; } });
})();

/* ---------------------------------------------------------------------------------------
   Phase 2: a stand-in app for screens shown on their own artboard. Screens read the same
   app object whether they are routed inside ResidentApp or shown alone with a demo preset. */
(function () {
  var C = window.CVH;
  function D() { return window.CVH_DATA || {}; }
  C.choicesFor = function (persona) {
    persona = persona || {};
    return { groups: (persona.groups || []).slice(), building: persona.building || null, floor: persona.floor || null, nbhd: persona.nbhd || null,
      checkin: persona.checkin || null, subscribed: !!persona.subscribed, headsUp: !!persona.headsUp, phone: persona.phone || null };
  };
  C.demoApp = function (preset, flash) {
    preset = preset || {};
    var persona = C.persona(preset.persona || 'new') || { id: 'new' };
    var basic = preset.basic !== undefined ? !!preset.basic : !!persona.basic;
    var choices = Object.assign(C.choicesFor(persona), preset.choices || {});
    var noop = function () { if (flash) flash(); };
    return { demo: true, screen: preset.screen || null, params: preset.params || {}, visit: 0, lang: preset.lang || 'en', basic: basic,
      basicState: preset.basicState || (basic ? 'on' : 'off'), persona: persona, personaId: persona.id,
      scenario: preset.scenario || D().defaultScenario, exercise: !!preset.exercise, choices: choices, flags: preset.flags || {},
      w: 360, h: 640, go: noop, back: noop, setLang: noop, toggleBasic: noop, setBasicByHelper: noop, setChoices: noop,
      openLang: noop, openChoices: noop, openControls: null, openAbout: noop, closeOverlay: noop, notInPrototype: noop,
      toggleExercise: noop, flash: noop, confirm: noop };
  };
})();

/* Phase 2: props for X-02 from an alert snapshot, shared by home, alert detail, archive, share. */
(function () {
  var C = window.CVH;
  C.originProps = function (sn, opt) {
    opt = opt || {};
    var a = sn.a, o = a.origin || {};
    var promoted = opt.unverified ? false : !!a.promotedMinsAgo;
    var state = o.type === 'official' ? 'official' : ((a.verified === 'verified' || promoted) ? (sn.corrected ? 'corrected' : 'verified') : 'unverified');
    return { origin: o.type || 'hub', state: state, source: o.source || 'ECCC', org: o.org || 'HUB', building: o.building || 'SA',
      correctedMins: sn.corrected && sn.corrections[0] ? sn.corrections[0].minsAgo : 0, promoted: o.type === 'ambassador' && promoted };
  };
  /* A space is a property of one listing: open it through the listing, or the asset when no full listing exists. */
  C.spaceKey = function (sp) { return sp ? (sp.listing || sp.assetId) : null; };
  C.spaceListing = function (sp) { return sp ? C.listingFor(C.spaceKey(sp)) : null; };
})();

/* ---------------------------------------------------------------------------------------
   Phase 3: the session. Actions taken in the Hub and partner space, or by an ambassador,
   are kept as a log and replayed over the sample data, so resident screens change within
   the session. The log lives in this browser only (localStorage, shared between artboards
   of the same canvas through a BroadcastChannel); nothing leaves the device.
   Action vocabulary (C.session.act(action)):
     {t:'incident', incident:{id, type, types, buildings, floors, where, nbhd}}
     {t:'publish', incident?, alert:{id, ...fields}, entry:{kind:'ack'|'alert', text, whereAtTime?, notYetKnown?}}
     {t:'entry', alert, entry:{kind:'update'|'correction'|'final', text, notYetKnown?, supportOffer?, changed?, where?}}
     {t:'promote', alert}                       verify an ambassador post (or approve-and-verify)
     {t:'withdraw', alert, reason}
     {t:'ambPost', post:{id, by, building, types, floors:[a,b]|'all', line?, photo?}}  direct or moderated by type
     {t:'approvePost', post, edited?}  {t:'declinePost', post, reason}
     {t:'moderate', sub, decision:'accepted'|'declined', reason?, fields?}
     {t:'checkin', id, status, category?}      {t:'addDoor', door:{building, floor, door, method}}
     {t:'official', alert, state:'incoming'|'relayed'|'activated'|'dismissed', reason?}
     {t:'signal', on:true|false}               ambassador phone: queued posts go out when signal returns
   Any action may carry exercise:true; exercise actions never reach resident screens. */
(function () {
  var W = window, C = W.CVH, KEY = 'cvh-session-v1';
  var listeners = [], chan = null, orig = null, model = null, timer = null;
  var st = { rev: 0, live: null, scenario: 'A', log: [] };
  // Ambassador post rule per disruption type (brief 3.1.4, decided in Section 13 O11)
  var DIRECT = { power: true, water: true, elevator: true, flood: true, fire: false, other: false };
  var POST_WORDS = { power: 'Power is out', water: 'Water is off', elevator: 'Elevator is out', flood: 'Water is leaking', fire: 'Fire alarm', other: 'Building update' };
  var POST_ACTIONS = { power: 'Keep your fridge and freezer closed. Use a flashlight, not candles.', water: 'Ask a neighbour on a lower floor for water if you need it.',
    elevator: 'Use the stairs with care.', flood: 'Stay away from the water and move things off the floor.', fire: 'If you hear the alarm, leave by the stairs. Do not use the elevator.',
    other: 'Stay safe. If someone is in danger, call 911.' };
  function D() { return W.CVH_DATA; }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function byId(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i]; return null; }
  function load() { try { var raw = W.localStorage.getItem(KEY); if (raw) { var o = JSON.parse(raw); if (o && o.log) st = o; } } catch (e) {} }
  function save() { try { W.localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} try { if (chan) chan.postMessage(st.rev); } catch (e) {} }
  function emit() { listeners.slice().forEach(function (fn) { try { fn(st); } catch (e) {} }); }
  function mins(at, now) { return Math.max(0, Math.round((now - at) / 60000)); }
  function isDirect(types) { return (types || []).every(function (t) { return DIRECT[t] !== false; }); }

  function postAlert(post, m, verified) {
    var b = C.building(post.building) || { name: post.building };
    var fl = post.floors === 'all' || !post.floors ? null : post.floors;
    var floorsText = fl ? (fl[0] === fl[1] ? 'floor ' + fl[0] : 'floors ' + fl[0] + ' to ' + fl[1]) : 'all floors';
    // Rashid's elevator-and-water post in Sample Tower A continues the drawn Scenario A alert (AL-07)
    var sameAsDrawn = post.building === 'SA' && (post.types || []).indexOf('elevator') >= 0 && (post.types || []).indexOf('water') >= 0;
    var id = sameAsDrawn ? 'AL-07' : 'AL-' + post.id;
    var base = sameAsDrawn ? clone(byId(orig.alerts, 'AL-07')) : {};
    var words = (post.types || []).map(function (t, i) { var w = POST_WORDS[t] || t; return i ? w.charAt(0).toLowerCase() + w.slice(1) : w; });
    var a = Object.assign(base, {
      id: id, scenario: st.scenario, level: 'community', origin: { type: 'ambassador', building: post.building }, verified: verified ? 'verified' : 'unverified',
      types: post.types, hazard: post.types[0], status: 'active', validUntil: 'until resolved',
      where: b.name + ', ' + floorsText, audience: { place: { buildings: [post.building], floors: fl }, groups: [] },
      audioSecs: base.audioSecs || 30, _session: true, _post: post.id, _entries: [{ id: 'e1', kind: 'ambassador', text: '', at: post.sentAt || post.at }] });
    if (!sameAsDrawn) {
      a.headline = post.types.indexOf('other') >= 0 && post.line ? (post.line.en || post.line.text) : words.join(' and ');
      a.notYetKnown = 'When it will be fixed'; a.action = POST_ACTIONS[post.types[0]] || POST_ACTIONS.other;
      a.ambassadorLine = post.line && post.line.text ? { lang: post.line.lang || 'en', text: post.line.text, mt: post.line.mt || {} } : null;
    } else if (post.line && post.line.text) {
      a.ambassadorLine = { lang: post.line.lang || 'en', text: post.line.text, mt: post.line.mt || {} };
    }
    if (verified) a.promotedAt = verified;
    m.alerts[id] = a; delete m.hidden[id];
    post.alert = id;
    return a;
  }
  function seed(m, id, at) {
    // A drawn alert the Hub acts on: start from what residents currently see
    if (m.alerts[id]) return m.alerts[id];
    var o = byId(orig.alerts, id); if (!o) return null;
    var a = clone(o), ref = null;
    var sa = orig.scenarioAlerts[st.scenario] || { active: [], archive: [] };
    sa.active.concat(sa.archive).forEach(function (r) { if (r.id === id) ref = r; });
    var oldest = a.entries.slice().reverse(), cut = oldest.length;
    if (ref && ref.upto) oldest.forEach(function (e, i) { if (e.id === ref.upto) cut = i + 1; });
    else if (oldest.some(function (e) { return e.resolvedState; })) cut = oldest.filter(function (e) { return !e.resolvedState; }).length;
    a._entries = oldest.slice(0, cut).filter(function (e) { return e.kind !== 'final'; })
      .map(function (e) { return Object.assign({}, e, { at: at - (e.minsAgo || 0) * 60000 }); });
    a.status = 'active'; a._session = true;
    if (o.promotedMinsAgo) a.promotedAt = at - o.promotedMinsAgo * 60000;
    m.alerts[id] = a; delete m.hidden[id];
    return a;
  }
  function derive() {
    var m = { alerts: {}, hidden: {}, incidents: [], posts: [], mod: {}, checkins: {}, doors: [], official: {}, signal: true, n: 0, exercise: [],
      spaces: [], closed: {}, partner: [], spaceStatus: {}, run: null, runs: [] };
    if (st.live === 'A') { m.hidden['AL-05'] = 1; m.hidden['AL-07'] = 1; }
    st.log.forEach(function (a) {
      m.n++;
      if (a.exercise && ['openSpace', 'closeSpace', 'partner', 'exercise'].indexOf(a.t) < 0) { m.exercise.push(a); return; }
      var al;
      switch (a.t) {
        case 'incident':
          var inc = Object.assign({ status: 'active', alert: null }, a.incident, { firstAt: a.at, lastAt: a.at });
          m.incidents = m.incidents.filter(function (x) { return x.id !== inc.id; }).concat([inc]); break;
        case 'publish':
          var base = clone(byId(orig.alerts, a.alert.id)) || {};
          al = Object.assign(base, a.alert, { status: 'active', _session: true });
          al._entries = [Object.assign({ id: 'e1' }, a.entry, { at: a.at })];
          m.alerts[al.id] = al; delete m.hidden[al.id];
          m.incidents.forEach(function (x) { if (x.id === a.incident) { x.alert = al.id; x.lastAt = a.at; } }); break;
        case 'entry':
          al = seed(m, a.alert, a.at) || m.alerts[a.alert]; if (!al) break;
          var e = Object.assign({ id: 's' + m.n }, a.entry, { at: a.at });
          al._entries.push(e);
          if (e.notYetKnown) al.notYetKnown = e.notYetKnown;
          if (e.validUntil) al.validUntil = e.validUntil;
          if (e.officialLink) al.officialLink = e.officialLink;
          if (e.kind === 'correction' && e.where) al.where = e.where;
          if (e.kind === 'final') { al.status = 'resolved'; al.resolvedAt = a.at; }
          m.incidents.forEach(function (x) { if (x.alert === al.id) { x.lastAt = a.at; if (e.kind === 'final') x.status = 'resolved'; } }); break;
        case 'promote':
          al = seed(m, a.alert, a.at) || m.alerts[a.alert]; if (!al) break;
          al.verified = 'verified'; al.promotedAt = a.at;
          m.posts.forEach(function (p) { if (p.alert === a.alert) p.state = 'verified'; }); break;
        case 'withdraw':
          al = seed(m, a.alert, a.at) || m.alerts[a.alert]; if (!al) break;
          al.status = 'withdrawn'; al.withdrawnReason = a.reason; al.withdrawnAt = a.at;
          m.posts.forEach(function (p) { if (p.alert === a.alert) { p.state = 'withdrawn'; p.reason = a.reason; } }); break;
        case 'ambPost':
          var post = Object.assign({ by: 'AMB-RASHID', floors: 'all' }, clone(a.post), { at: a.at });
          post.direct = isDirect(post.types);
          if (!m.signal) post.state = 'queued';
          else { post.sentAt = a.at; post.state = post.direct ? 'live' : 'waiting'; if (post.direct) postAlert(post, m, null); }
          m.posts.push(post); break;
        case 'signal':
          m.signal = !!a.on;
          if (a.on) Object.keys(m.checkins).forEach(function (k) { m.checkins[k].queued = false; });
          if (a.on) m.posts.forEach(function (p) {
            if (p.state !== 'queued') return;
            p.sentAt = a.at; p.state = p.direct ? 'live' : 'waiting'; if (p.direct) postAlert(p, m, null);
          }); break;
        case 'approvePost':
          var pp = byId(m.posts, a.post);
          if (!pp) { var op = byId(orig.ambassadorPosts, a.post); if (op) { pp = Object.assign(clone(op), { at: a.at - (op.minsAgo || 0) * 60000, sentAt: a.at - (op.minsAgo || 0) * 60000, direct: false }); m.posts.push(pp); } }
          if (!pp) break;
          if (a.edited) Object.assign(pp, a.edited);
          pp.state = 'approved'; pp.approvedAt = a.at; postAlert(pp, m, a.at); break;
        case 'declinePost':
          var dp = byId(m.posts, a.post);
          if (!dp) { var od = byId(orig.ambassadorPosts, a.post); if (od) { dp = Object.assign(clone(od), { at: a.at - (od.minsAgo || 0) * 60000 }); m.posts.push(dp); } }
          if (dp) { dp.state = 'declined'; dp.reason = a.reason; dp.declinedAt = a.at; } break;
        case 'moderate':
          m.mod[a.sub] = { decision: a.decision, reason: a.reason || null, fields: a.fields || null, at: a.at }; break;
        case 'checkin':
          m.checkins[a.id] = { status: a.status, category: a.category || null, at: a.at, queued: !m.signal }; break;
        case 'addDoor':
          m.doors.push(Object.assign({ id: 'CI-S' + m.n, status: 'waiting', addedAtRequest: true, at: a.at }, a.door)); break;
        case 'exercise':
          if (a.state === 'running') { m.run = { state: 'running', name: a.name || 'Exercise', scenario: a.scenario || null, hazard: a.hazard || null, level: a.level || null,
            enrolled: a.enrolled || [], startedAt: a.at, by: a.by || null }; m.runs.push(m.run); }
          else if (m.run) { m.run.state = 'ended'; m.run.endedAt = a.at; }
          break;
        case 'openSpace':
          m.spaces = m.spaces.filter(function (x) { return x.id !== a.space.id; }).concat([Object.assign({}, a.space, { openedAt: a.at, exercise: !!a.exercise, openedBy: a.by || a.space.openedBy || null, _session: true })]);
          delete m.closed[a.space.id]; break;
        case 'closeSpace':
          m.closed[a.space] = { at: a.at, reason: a.reason || null }; break;
        case 'spaceStatus':
          m.spaceStatus[a.spaceId] = { status: a.status, capacity: a.capacity || null, at: a.at, by: a.by || null }; break;
        case 'partner':
          m.partner.push(Object.assign({ id: 'PI-' + m.n, kind: a.kind, sp: a.space || null, at: a.at, by: a.by || null, exercise: !!a.exercise }, clone(a.item || {}))); break;
        case 'official':
          m.official[a.alert] = { state: a.state, reason: a.reason || null, at: a.at, activated: a.state === 'activated' || (m.official[a.alert] || {}).activated,
            relayed: a.state === 'relayed' || (m.official[a.alert] || {}).relayed };
          if (a.state === 'relayed') delete m.hidden[a.alert]; break;
      }
    });
    return m;
  }
  function locate(text, nbhd) {
    text = String(text || '');
    var bs = D().buildings || [], as = orig.assets || [];
    for (var i = 0; i < bs.length; i++) if (bs[i].lat && text.indexOf(bs[i].name) >= 0) return { lat: bs[i].lat + 0.0003, lng: bs[i].lng + 0.0003, nbhd: bs[i].nbhd };
    for (var j = 0; j < as.length; j++) if (as[j].lat && text.indexOf(as[j].name) >= 0) return { lat: as[j].lat + 0.0003, lng: as[j].lng - 0.0003, nbhd: as[j].nbhd };
    if (/Burgess/.test(text)) return { lat: 43.7063, lng: -79.3465, nbhd: 'TP' };
    if (/Gateway/.test(text)) return { lat: 43.7127, lng: -79.3326, nbhd: 'FP' };
    if (/Overlea/.test(text)) return { lat: 43.7054, lng: -79.3447, nbhd: 'TP' };
    return nbhd === 'FP' ? { lat: 43.7142, lng: -79.3300, nbhd: 'FP' } : { lat: 43.7052, lng: -79.3445, nbhd: 'TP' };
  }
  function materialize() {
    if (!orig) return;
    var d = D(), now = Date.now(), m = derive(), S = st.scenario;
    // Alerts: drawn ones, with the session's versions laid over them
    var alerts = clone(orig.alerts), sa = clone(orig.scenarioAlerts);
    var list = sa[S] || (sa[S] = { active: [], archive: [] });
    Object.keys(m.hidden).forEach(function (id) { list.active = list.active.filter(function (r) { return r.id !== id; }); });
    Object.keys(m.alerts).forEach(function (id) {
      var a = m.alerts[id], out = clone(a);
      out.entries = a._entries.slice().reverse().map(function (e) { var x = Object.assign({}, e); x.minsAgo = mins(e.at, now); delete x.at; return x; });
      if (a.status === 'resolved') { out.resolvedMinsAgo = mins(a.resolvedAt, now); out.entries.forEach(function (e) { if (e.kind === 'final') e.minsAgo = out.resolvedMinsAgo; }); }
      if (a.promotedAt) out.promotedMinsAgo = mins(a.promotedAt, now); else delete out.promotedMinsAgo;
      delete out._entries;
      var k = -1; alerts.forEach(function (x, i) { if (x.id === id) k = i; });
      if (k >= 0) alerts[k] = out; else alerts.push(out);
      list.active = list.active.filter(function (r) { return r.id !== id; });
      list.archive = list.archive.filter(function (r) { return r.id !== id; });
      if (a.status === 'active') list.active.unshift({ id: id, day: (orig.scenarioAlerts[S] && (byId(orig.scenarioAlerts[S].active, id) || {}).day) || null });
      else if (a.status === 'resolved') list.archive.unshift({ id: id, status: 'resolved' });
    });
    Object.keys(m.official).forEach(function (id) {
      if (m.official[id].relayed && !byId(list.active, id)) list.active.push({ id: id });
    });
    d.alerts = alerts; d.scenarioAlerts = sa;
    // Incidents on O-01
    var alertScn = function (id) { var a = byId(orig.alerts, id); return a ? a.scenario : null; };
    var incs = st.live ? [] : clone(orig.incidents);
    if (st.explicit) incs = incs.filter(function (x) { return alertScn(x.alert) === S; });
    incs.forEach(function (x) { var a = m.alerts[x.alert]; if (a && a._entries.length) { x.lastUpdateMinsAgo = mins(a._entries[a._entries.length - 1].at, now); if (a.status === 'resolved') x.status = 'resolved'; } });
    m.incidents.forEach(function (x) { incs.unshift(Object.assign(clone(x), { firstLoggedMinsAgo: mins(x.firstAt, now), lastUpdateMinsAgo: mins(x.lastAt, now), _session: true })); });
    d.incidents = incs;
    // Ambassador posts
    var posts = st.live || (st.explicit && S !== 'A') ? [] : clone(orig.ambassadorPosts);
    posts.forEach(function (p) { var a = m.alerts[p.alert]; if (a && a.verified === 'verified') p.state = 'verified'; if (a && a.status === 'withdrawn') p.state = 'withdrawn'; });
    m.posts.forEach(function (p) {
      var x = clone(p); x.minsAgo = mins(p.at, now); if (p.sentAt) x.sentMinsAgo = mins(p.sentAt, now); x._session = true;
      posts = posts.filter(function (q) { return q.id !== x.id; }); posts.unshift(x);
    });
    d.ambassadorPosts = posts;
    // Moderation and the listings it adds or corrects
    var mods = clone(orig.moderation), listings = clone(orig.listings), assets = clone(orig.assets);
    mods.forEach(function (s) {
      var dec = m.mod[s.id]; if (!dec) return;
      s.decision = dec.decision; s.decisionReason = dec.reason; s.decidedMinsAgo = mins(dec.at, now);
      if (dec.decision !== 'accepted') return;
      var f = Object.assign({}, s.fields, dec.fields || {});
      if (s.type === 'correction' && f.correctionOf) {
        var l = byId(listings, f.correctionOf);
        if (l) { l.correctionNote = f.whatEn || f.what; l.confirmed = { source: 'contribution', date: '2026-09-30' }; if (s.id === 'SUB-03' && l.hours && typeof l.hours === 'object') l.hours.sat = ['10:00', '13:00']; }
        return;
      }
      var where = locate((f.location || {}).textEn || (f.location || {}).text, 'TP');
      var aid = 'M-' + s.id, lid = 'L-' + s.id, offer = s.type === 'communityOffer';
      assets.push({ id: aid, name: f.name, kind: offer ? 'communityOffer' : 'grassroots', subcats: [], categories: [], address: null, street: null,
        place: (f.location || {}).textEn || (f.location || {}).text || null, lat: where.lat, lng: where.lng, nbhd: where.nbhd, sourceLang: s.sourceLang,
        contributedBy: s.lane === 'ambassador' ? 'ambassador' : 'resident', acceptedDaysAgo: 0, helps: {}, utilities: [], informal: true, kit: false,
        source: 'contribution', listings: [lid], sessionAdded: true });
      listings.push({ id: lid, assetId: aid, name: f.name, kind: offer ? 'communityOffer' : 'grassroots', categories: f.category ? [f.category] : [],
        firstLine: f.whatEn || f.what, serviceTypes: offer ? 'Community offer, from neighbours' : 'Run by neighbours',
        hours: f.hours && typeof f.hours === 'object' ? Object.assign({ mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }, f.hours) : 'unknown',
        languages: f.languages || 'unknown', cost: f.cost || 'unknown', idRequired: f.idRequired || 'unknown', stepFree: f.stepFree || 'unknown', appointment: 'unknown',
        bring: 'unknown', confirmed: { source: 'contribution', date: '2026-09-30' }, communityOffer: offer, sourceLang: s.sourceLang, needs: [f.name.toLowerCase()],
        address: null, place: (f.location || {}).textEn || (f.location || {}).text || null, nbhd: where.nbhd, helps: {}, kit: false, utilities: [],
        illustrative: true, untranslated: [], sessionAdded: true, justAdded: true });
    });
    d.moderation = mods; d.listings = listings; d.assets = assets;
    // Check-in round
    var cis = clone(orig.checkins);
    cis.forEach(function (c) { var x = m.checkins[c.id]; if (x) { c.status = x.status; if (x.category) c.category = x.category; c.queued = x.queued; } });
    m.doors.forEach(function (dd) { cis.push(clone(dd)); });
    d.checkins = cis;
    // Official alerts waiting at the top of O-01
    var incoming = st.live ? [] : clone(orig.incomingOfficial || []);
    if (st.explicit) incoming = incoming.filter(function (id) { return alertScn(id) === S; });
    Object.keys(m.official).forEach(function (id) {
      var o = m.official[id];
      if (o.state === 'incoming' && incoming.indexOf(id) < 0) incoming.push(id);
      if (o.state !== 'incoming') incoming = incoming.filter(function (x) { return x !== id; });
    });
    d.incomingOfficial = incoming;
    // Spaces open for residents (X-09): a partner's status change reaches every resident screen
    var sps = clone(orig.spaces || []);
    Object.keys(m.spaceStatus).forEach(function (id) { var x = m.spaceStatus[id], sp = byId(sps, id); if (sp) { sp.status = x.status; sp.confirmedMinsAgo = mins(x.at, now); if (x.capacity) sp.capacity = x.capacity; } });
    d.spaces = sps;
    // Partner space: drawn items, then the session's
    var P = clone(orig.partner || {});
    var shared = (P.sharedSpaces || []).filter(function (x) { return !(st.live && x.scenario === st.live) && !(st.explicit && x.scenario !== S); });
    m.spaces.forEach(function (x) { shared = shared.filter(function (y) { return y.id !== x.id; }); shared.unshift(Object.assign(clone(x), { openedMinsAgo: mins(x.openedAt, now) })); });
    shared.forEach(function (x) { if (m.closed[x.id]) { x.closed = true; x.closedMinsAgo = mins(m.closed[x.id].at, now); x.closedReason = m.closed[x.id].reason; } });
    P.sharedSpaces = shared;
    var put = { statement: 'statements', decision: 'decisions', message: 'conversation', handover: 'handovers', action: 'actions' };
    m.partner.forEach(function (it) {
      var x = clone(it); x.minsAgo = mins(it.at, now); x._session = true;
      if (x.person == null && it.by) x.person = it.by;
      if (put[it.kind]) { P[put[it.kind]] = (P[put[it.kind]] || []).concat([x]); return; }
      if (it.kind === 'claim') {
        (P.statements || []).forEach(function (s) { if (s.id === it.statement) { s.claimedBy = it.org; s.claimedMinsAgo = x.minsAgo; s.claimedExercise = !!it.exercise; } }); return;
      }
      if (it.kind === 'supply') {
        var sp = byId(P.supplies, it.supplyId);
        if (sp) Object.assign(sp, it.changes || {}, { updatedMinsAgo: x.minsAgo }); else P.supplies = (P.supplies || []).concat([Object.assign({ id: 'SUP-S' + it.id, updatedMinsAgo: x.minsAgo, _session: true }, it.changes || {})]);
        return;
      }
      if (it.kind === 'capacity') { P.capacity = Object.assign({}, P.capacity || {}); P.capacity[it.org] = it.level; return; }
      if (it.kind === 'commitment') {
        var cm = byId(P.commitments, it.commitmentId);
        if (cm && it.changes && it.changes.space) { cm.forSpace = Object.assign({}, cm.forSpace || {}); cm.forSpace[it.changes.space] = { state: it.changes.state, minsAgo: x.minsAgo, by: it.by }; Object.assign(cm, { state: it.changes.state, space: it.changes.space }); }
        else if (cm) Object.assign(cm, it.changes || {}, { confirmedMinsAgo: x.minsAgo }); else P.commitments = (P.commitments || []).concat([Object.assign({ id: 'COM-S' + it.id, _session: true }, it.changes || {})]);
        return;
      }
      P.other = (P.other || []).concat([x]);   // team, playbook and indicator notes: screens read them by kind
    });
    P.run = m.run ? Object.assign(clone(m.run), { startedMinsAgo: mins(m.run.startedAt, now), endedMinsAgo: m.run.endedAt ? mins(m.run.endedAt, now) : null }) : null;
    d.partner = P;
    model = m;
    if (C.resetListingCache) C.resetListingCache();
  }
  function ensure() {
    if (orig || !D()) return;
    var d = D();
    orig = clone({ alerts: d.alerts, scenarioAlerts: d.scenarioAlerts, incidents: d.incidents, ambassadorPosts: d.ambassadorPosts, moderation: d.moderation,
      listings: d.listings, assets: d.assets, checkins: d.checkins, incomingOfficial: d.incomingOfficial, partner: d.partner, spaces: d.spaces });
    load(); materialize();
    try { chan = new BroadcastChannel('cvh-session'); chan.onmessage = function () { load(); materialize(); emit(); }; } catch (e) {}
    try { W.addEventListener('storage', function (ev) { if (ev.key === KEY) { load(); materialize(); emit(); } }); } catch (e) {}
    timer = setInterval(function () { if (st.log.length) { materialize(); emit(); } }, 30000);
  }
  C.session = {
    ensure: ensure,
    get: function () { ensure(); return st; },
    model: function () { ensure(); return model; },
    active: function () { ensure(); return st.log.length > 0 || !!st.live; },
    on: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
    act: function (a) {
      ensure(); a = Object.assign({}, a, { at: a.at || Date.now() });
      st = Object.assign({}, st, { log: st.log.concat([a]), rev: st.rev + 1 });
      save(); materialize(); emit(); return a;
    },
    reset: function (opts) {
      ensure(); opts = opts || {};
      st = { rev: st.rev + 1, live: opts.live || null, scenario: opts.scenario || opts.live || 'A', explicit: !!(opts.scenario || opts.live), log: [] };
      save(); materialize(); emit();
    },
    isDirect: isDirect, DIRECT: DIRECT,
    run: function () { ensure(); return model && model.run && model.run.state === 'running' ? model.run : null; },
    exerciseFor: function (who) { var r = this.run(); return !!r && (!who || who === 'PRIYA' || r.enrolled.indexOf(who) >= 0); },
    label: function (a) {
      var t = { incident: 'Disruption logged', publish: 'Alert published', entry: 'Alert entry posted', promote: 'Verified by the Hub', withdraw: 'Alert withdrawn',
        ambPost: 'Ambassador post', approvePost: 'Ambassador post approved', declinePost: 'Ambassador post declined', moderate: 'Submission reviewed',
        checkin: 'Check-in marked', addDoor: 'Door added to a round', official: 'Official alert', signal: 'Ambassador signal' }[a.t] || a.t;
      if (a.t === 'entry' && a.entry) t = { update: 'Update posted', correction: 'Correction posted', final: 'Resolved with a final entry' }[a.entry.kind] || t;
      if (a.t === 'moderate') t = a.decision === 'accepted' ? 'Submission accepted' : 'Submission declined';
      if (a.t === 'official') t = 'Official alert ' + a.state;
      if (a.t === 'signal') t = a.on ? 'Ambassador back in signal' : 'Ambassador lost signal';
      if (a.t === 'exercise') t = a.state === 'running' ? 'Exercise started' : 'Exercise ended';
      if (a.t === 'openSpace') t = 'Shared space opened'; if (a.t === 'closeSpace') t = 'Shared space closed'; if (a.t === 'spaceStatus') t = 'Space status set: ' + a.status;
      if (a.t === 'partner') t = ({ statement: 'Statement posted', claim: 'Gap taken on', decision: 'Decision recorded', message: 'Message sent', handover: 'Handover written',
        supply: 'Supplies updated', capacity: 'Capacity updated', commitment: 'Commitment confirmed', action: 'Action with an owner added' })[a.kind] || ('Partner: ' + a.kind);
      return (a.exercise ? 'Exercise: ' : '') + t;
    }
  };
})();

/* Phase 3: a stand-in Hub app for Hub screens shown on their own artboard. */
(function () {
  var C = window.CVH;
  C.demoHubApp = function (preset, flash) {
    preset = preset || {};
    var noop = function () { if (flash) flash(); };
    var w = preset.w || 1280;
    return { demo: true, screen: preset.screen || null, params: preset.params || {}, visit: 0, persona: preset.persona || 'PRIYA', exercise: !!preset.exercise,
      narrow: w < 700, w: w, h: preset.h || 800, inDisruption: !!preset.inDisruption, canBack: false,
      go: noop, back: noop, replace: noop, openMenu: noop, openControls: null, closeOverlay: noop, notInPrototype: noop, flash: noop,
      act: function (a) { return C.session.act(Object.assign({ exercise: !!preset.exercise }, a)); } };
  };
})();
