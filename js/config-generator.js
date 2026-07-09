/**
 * Cookie Consent Manager - CONFIG GENERATOR (self-serve onboarding tool)
 *
 * DOM-vrije, ES5-compatibele PURE generator-logica. Een klant vult zijn
 * tenant-config in (via config-generator.html) en krijgt twee strings terug:
 *   1) een ready-to-paste CookieConsent.init({...}) snippet (serializeConfig)
 *   2) de volledige embed (script-tag + init) (buildEmbedSnippet)
 *
 * SECURITY-KERN: elke gebruiker-afgeleide string-waarde wordt veilig als
 * JS-string-literal geserialiseerd via JSON.stringify per waarde, plus een
 * extra escape-laag voor </script>, U+2028/U+2029 en control-chars. Hierdoor
 * is uitbreken uit de literal of script-injectie onmogelijk, ook met vijandige
 * input zoals '); alert(1); // of </script><script>.
 *
 * Gebruik (browser):
 *   <script src="cookie-consent.js"></script>
 *   <script src="config-generator.js"></script>
 *   <script>var cfg = CookieConsentConfigGen.buildConfigObject(form); ...</script>
 *
 * Gebruik (node/test):
 *   var G = require('./config-generator.js');
 *   G.serializeConfig(G.buildConfigObject({ gtmId: 'GTM-ABC' }))
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;             // node / test
  } else {
    root.CookieConsentConfigGen = api; // browser
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function (root) {
  'use strict';

  // ============================================================
  // VEILIGE CHECKS
  //
  // We hergebruiken de exact-zelfde validatie-semantiek als de core. In node
  // proberen we de core te require-en en CC._internals te gebruiken; lukt dat
  // niet (browser, of core niet aanwezig) dan vallen we terug op lokale,
  // gedrag-identieke herimplementaties. Zo blijft het DRY waar het kan, en
  // werkt het standalone in de browser (geen runtime-require daar).
  // ============================================================

  var coreInternals = null;
  if (typeof module === 'object' && module.exports && typeof require === 'function') {
    try {
      var CC = require('./cookie-consent.js');
      if (CC && CC._internals) coreInternals = CC._internals;
    } catch (e) { coreInternals = null; }
  }

  /** Veilige URL: alleen relatief (/pad, niet //host) of expliciet https://. */
  function localIsSafeUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    if (url.charAt(0) === '/') return url.charAt(1) !== '/';
    return /^https:\/\//i.test(url);
  }

  var SAFE_COLOR_KEYWORDS = {
    'transparent': 1, 'white': 1, 'black': 1, 'currentcolor': 1, 'inherit': 1
  };

  /** Veilige CSS-kleur (hex/rgb/rgba/whitelist-keyword). Gedrag-identiek aan core. */
  function localIsSafeColor(value) {
    if (typeof value !== 'string') return false;
    var v = value.replace(/^\s+|\s+$/g, '');
    if (!v) return false;
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return true;
    if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/.test(v)) return true;
    if (/^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\)$/.test(v)) return true;
    if (Object.prototype.hasOwnProperty.call(SAFE_COLOR_KEYWORDS, v.toLowerCase())) return true;
    return false;
  }

  /** Bevat de string een control-char (incl. CR/LF/null/DEL)? ES5, geen escapes. */
  function hasControlChar(s) {
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 32 || c === 127) return true;
    }
    return false;
  }
  function isSafeUrl(url) {
    // Weiger eerst control-chars (newline/CR/null): die zouden anders letterlijk in
    // het src="..."-attribuut van de embed-snippet belanden en malformed HTML geven.
    if (typeof url === 'string' && hasControlChar(url)) return false;
    return coreInternals ? coreInternals.isSafeUrl(url) : localIsSafeUrl(url);
  }
  function isSafeColor(value) {
    return coreInternals ? coreInternals.isSafeColor(value) : localIsSafeColor(value);
  }

  // Defaults voor theme + taal, byte-identiek aan core DEFAULTS waar relevant.
  var THEME_DEFAULTS = { accent: '#2563EB', bg: '#0D0D0D', text: '#FFFFFF' };
  var DEFAULT_LANGUAGE = 'en';
  // Placeholder/CDN-achtige bron voor de embed (klant vervangt dit pad evt.).
  var DEFAULT_SCRIPT_SRC = 'https://cdn.cookieconsent.example/cookie-consent.js';

  // ============================================================
  // STRING-LITERAL SERIALISATIE (security-kern)
  // ============================================================

  // Bouw de separator-regexes uit char-codes zodat er GEEN onzichtbare
  // U+2028/U+2029-tekens in de broncode staan (die zouden de bron zelf breken).
  var RE_LS = new RegExp(String.fromCharCode(0x2028), 'g');  // U+2028 line separator
  var RE_PS = new RegExp(String.fromCharCode(0x2029), 'g');  // U+2029 paragraph separator

  /**
   * Serialiseer EEN waarde veilig als JS-literal voor inbedding in een
   * <script>-context. JSON.stringify handelt quoting/escaping van quotes,
   * backslashes en control-chars af. Daarbovenop escapen we expliciet:
   *   - '<' en '>' zodat de sequentie </script> nooit letterlijk in de output
   *     verschijnt (de HTML-parser zou anders het script-blok vroeg sluiten);
   *   - U+2028 / U+2029 (line/paragraph separator) die in een JS-string-literal
   *     - anders dan in JSON - een echte line-break zijn en de literal breken.
   * Alles wordt als \uXXXX-escape geschreven; JSON.parse en de JS-engine
   * herleiden die weer tot exact het oorspronkelijke teken (round-trip-veilig).
   */
  function safeLiteral(value) {
    var json = JSON.stringify(value);
    if (typeof json !== 'string') return 'null';
    return json
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(RE_LS, '\\u2028')
      .replace(RE_PS, '\\u2029');
  }

  /** Indenteer elke regel met de gegeven prefix (voor nette nesting). */
  function indentLines(str, prefix) {
    return str.split('\n').join('\n' + prefix);
  }

  /** Defensieve HTML-attribuut-escaping (voor src/integrity in de embed). */
  function attrEscape(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Geldige SRI-integrity-waarde voor de hosted embed: exact "sha384-" plus
   * 64 base64-tekens (sha384 = 48 bytes = precies 64 base64-chars, zonder
   * padding). Alles anders (andere algoritmes, rommel, injectie-pogingen)
   * wordt geweigerd zodat er nooit een onverwachte waarde in het
   * integrity-attribuut belandt.
   */
  function isValidSri(sri) {
    return typeof sri === 'string' && /^sha384-[A-Za-z0-9+\/]{64}$/.test(sri);
  }

  /**
   * Is dit een muterend "latest"-alias-pad? SRI pint exacte bytes, maar de
   * latest-alias verandert per release; src + integrity op een latest-pad zou
   * de banner op elke klant-site blokkeren zodra wij een nieuwe versie
   * publiceren. Matcht zowel het volledige alias-bestand
   * (cookie-consent.latest.js) als elk pad dat ".latest." bevat.
   */
  function isLatestAlias(src) {
    if (typeof src !== 'string') return false;
    var lower = src.toLowerCase();
    if (lower.indexOf('.latest.') !== -1) return true;
    return /(^|\/)cookie-consent\.latest\.js(\?|#|$)/.test(lower);
  }

  // ============================================================
  // CONFIG-OPBOUW (validatie + normalisatie)
  // ============================================================

  /** GTM-id-check (gelijk aan core isValidGtmId). */
  function isValidGtmId(id) {
    return typeof id === 'string' && /^GTM-[A-Z0-9]+$/i.test(id);
  }

  /**
   * GA4 measurement-id-check (quick-connect, item 12). Anchored regex:
   * exact 'G-' plus 4 tot 20 alfanumerieke tekens (in de praktijk 10, bv.
   * G-1A2B3C4D5E). Alles anders (GTM-id, UA-id, injectie-pogingen, lege
   * string) wordt geweigerd zodat er nooit een onverwachte waarde in de
   * gegenereerde snippet belandt.
   */
  function isValidGa4Id(id) {
    return typeof id === 'string' && /^G-[A-Z0-9]{4,20}$/i.test(id);
  }

  /** Veilige cookienaam: alleen [A-Za-z0-9_]. Leeg/ongeldig -> null. */
  function normalizeCookieName(name) {
    if (typeof name !== 'string') return null;
    var trimmed = name.replace(/^\s+|\s+$/g, '');
    if (!trimmed) return null;
    // moet VOLLEDIG uit veilige tekens bestaan, anders weigeren (niet stilletjes strippen).
    if (!/^[A-Za-z0-9_]+$/.test(trimmed)) return null;
    return trimmed;
  }

  /** Positief geheel getal -> number, anders null. Accepteert "2" en 2. */
  function normalizeVersion(v) {
    if (typeof v === 'number') {
      if (isFinite(v) && v > 0 && Math.floor(v) === v) return v;
      return null;
    }
    if (typeof v === 'string') {
      var t = v.replace(/^\s+|\s+$/g, '');
      if (/^[0-9]+$/.test(t)) {
        var n = parseInt(t, 10);
        if (n > 0) return n;
      }
    }
    return null;
  }

  /** Lees een trimmed string-veld, leeg -> null. */
  function readStr(form, key) {
    if (!form || typeof form !== 'object') return null;
    var v = form[key];
    if (typeof v !== 'string') return null;
    var t = v.replace(/^\s+|\s+$/g, '');
    return t ? t : null;
  }

  /**
   * Bouw een gesaniteerd, plain config-object uit ruwe form-waarden.
   *
   * Validatie/normalisatie per veld:
   *   - gtmId: moet GTM-patroon matchen; anders weggelaten + warning.
   *   - ga4Id: moet G-XXXXXXX-patroon matchen (isValidGa4Id, anchored);
   *     anders weggelaten + warning. Geldig -> genormaliseerd naar uppercase.
   *   - autoLoadGTM: true zodra er een geldige gtmId is, zodat de snippet
   *     expliciet maakt dat de core de consent-defaults VOOR GTM zet en GTM
   *     daarna zelf laadt (quick-connect, item 12).
   *   - consentCookieName: alleen [A-Za-z0-9_]; anders weggelaten.
   *   - consentVersion: positief geheel getal (string of number); anders weggelaten.
   *   - privacyUrl: door isSafeUrl; onveilig -> weggelaten.
   *   - geo: alleen 'always' of 'eu-only'; anders weggelaten (core-default = 'always').
   *   - theme.{accent,bg,text}: door isSafeColor; onveilig/ontbrekend -> default.
   *   - defaultLanguage: korte taalcode [A-Za-z-] (max 8); anders 'en'.
   * Onbekende/lege velden worden weggelaten. Het theme-object wordt altijd
   * teruggegeven (met defaults waar nodig) zodat de snippet voorspelbaar is.
   *
   * WARNINGS-MECHANISME: het resultaat draagt altijd een 'warnings'-array
   * (strings) voor de UI: ingevulde-maar-geweigerde waarden worden daar
   * gemeld in plaats van stil te verdwijnen. serializeConfig kent 'warnings'
   * bewust NIET (KEY_ORDER-whitelist), dus het lekt nooit de snippet in.
   */
  function buildConfigObject(form) {
    var out = {};
    var warnings = [];
    var f = (form && typeof form === 'object') ? form : {};

    var gtm = readStr(f, 'gtmId');
    if (gtm && isValidGtmId(gtm)) {
      out.gtmId = gtm;
      out.autoLoadGTM = true;  // expliciet: defaults denied VOOR GTM laadt
    } else if (gtm) {
      warnings.push('gtmId ongeldig (verwacht formaat GTM-XXXXXXX) en weggelaten: ' + gtm);
    }

    var ga4 = readStr(f, 'ga4Id');
    if (ga4 && isValidGa4Id(ga4)) {
      out.ga4Id = ga4.toUpperCase();
    } else if (ga4) {
      warnings.push('ga4Id ongeldig (verwacht formaat G-XXXXXXXXXX) en weggelaten: ' + ga4);
    }

    var cookieName = normalizeCookieName(f.consentCookieName);
    if (cookieName) out.consentCookieName = cookieName;

    var version = normalizeVersion(f.consentVersion);
    if (version !== null) out.consentVersion = version;

    var privacy = readStr(f, 'privacyUrl');
    if (privacy && isSafeUrl(privacy)) out.privacyUrl = privacy;

    // geo (item 8): alleen de twee bekende waarden; al het andere weggelaten
    // ('always' is toch al het core-default, dus weglaten is gedrag-identiek).
    var geo = readStr(f, 'geo');
    if (geo === 'always' || geo === 'eu-only') out.geo = geo;

    var lang = readStr(f, 'defaultLanguage');
    if (lang && /^[A-Za-z]{2}(-[A-Za-z]{2,4})?$/.test(lang) && lang.length <= 8) {
      out.defaultLanguage = lang.toLowerCase();
    } else {
      out.defaultLanguage = DEFAULT_LANGUAGE;
    }

    // theme: lees per-kleur, val terug op default bij onveilig/leeg.
    var theme = {};
    var accent = readStr(f, 'accent');
    theme.accent = (accent && isSafeColor(accent)) ? accent : THEME_DEFAULTS.accent;
    var bg = readStr(f, 'bg');
    theme.bg = (bg && isSafeColor(bg)) ? bg : THEME_DEFAULTS.bg;
    var text = readStr(f, 'text');
    theme.text = (text && isSafeColor(text)) ? text : THEME_DEFAULTS.text;
    out.theme = theme;

    out.warnings = warnings;  // altijd aanwezig; nooit geserialiseerd (zie KEY_ORDER)

    return out;
  }

  // Vaste sleutel-volgorde voor een leesbare, stabiele snippet.
  // 'warnings' staat hier bewust NIET in: dat is UI-feedback, geen config.
  var KEY_ORDER = ['gtmId', 'ga4Id', 'autoLoadGTM', 'consentCookieName', 'consentVersion', 'privacyUrl', 'geo', 'defaultLanguage', 'theme'];

  /**
   * Serialiseer een config-object naar de CookieConsent.init({...}) snippet
   * als STRING. Alle string-waarden lopen door safeLiteral (JSON.stringify +
   * extra escapes); nummers worden als nummer geschreven. Het theme-object
   * wordt expliciet veld-voor-veld opgebouwd uit gevalideerde kleuren.
   *
   * Er wordt NOOIT naief geconcateneerd met rauwe gebruiker-input; elke waarde
   * gaat door safeLiteral, zodat hostile input nooit uit de literal kan breken.
   */
  function serializeConfig(configObj) {
    var cfg = (configObj && typeof configObj === 'object') ? configObj : {};
    var lines = [];

    for (var i = 0; i < KEY_ORDER.length; i++) {
      var key = KEY_ORDER[i];
      if (!Object.prototype.hasOwnProperty.call(cfg, key)) continue;
      var val = cfg[key];

      if (key === 'theme') {
        if (!val || typeof val !== 'object') continue;
        var accent = isSafeColor(val.accent) ? val.accent : THEME_DEFAULTS.accent;
        var bg = isSafeColor(val.bg) ? val.bg : THEME_DEFAULTS.bg;
        var text = isSafeColor(val.text) ? val.text : THEME_DEFAULTS.text;
        var themeStr = [
          '  theme: {',
          '    accent: ' + safeLiteral(accent) + ',',
          '    bg: ' + safeLiteral(bg) + ',',
          '    text: ' + safeLiteral(text),
          '  }'
        ].join('\n');
        lines.push(themeStr);
      } else if (key === 'consentVersion') {
        // numeriek: schrijf als getal (genormaliseerd in buildConfigObject).
        var n = normalizeVersion(val);
        if (n !== null) lines.push('  consentVersion: ' + n);
      } else {
        lines.push('  ' + key + ': ' + safeLiteral(val));
      }
    }

    if (!lines.length) {
      return 'CookieConsent.init({});';
    }
    return 'CookieConsent.init({\n' + lines.join(',\n') + '\n});';
  }

  /**
   * Bouw de VOLLEDIGE embed: een <script src="..."> tag voor de core, plus een
   * tweede <script> met de init-snippet. Geeft een string terug.
   *
   * opts.scriptSrc overschrijft de standaard CDN-achtige bron; die override
   * loopt door isSafeUrl (geen javascript:/data:/http://protocol-relatief).
   * Onveilige src -> terugval op de veilige default (nooit de hostile waarde).
   * De src wordt bovendien defensief attribuut-ge-escaped; na isSafeUrl kan er
   * sowieso geen quote of < in zitten, maar we vertrouwen nooit op een laag.
   *
   * HOSTED DISTRIBUTIE (item 9): opts.hosted = { src, sri } genereert een
   * script-tag met src + integrity + crossorigin="anonymous" (Subresource
   * Integrity, matcht dist/manifest.json uit build.cjs). Poorten:
   *   - hosted.src moet door isSafeUrl (zelfde regels als scriptSrc);
   *   - hosted.sri moet door isValidSri ("sha384-" + 64 base64-chars).
   * Faalt EEN van beide -> het hele hosted-blok wordt genegeerd en we vallen
   * terug op het bestaande (niet-hosted) gedrag. Nooit een hostile src en
   * nooit een malformed integrity-waarde in de output. Zonder opts.hosted is
   * de output byte-identiek aan het gedrag van voor dit item.
   *
   * QUICK-CONNECT (item 12): een config uit buildConfigObject met geldige
   * gtmId/ga4Id levert hier een compleet, direct plakbaar snippet op. De
   * init-call bevat dan gtmId + autoLoadGTM: true, zodat de core de Consent
   * Mode v2 defaults (alles denied) zet VOORDAT GTM geladen wordt.
   *
   * LATEST-GUARD: wijst hosted.src naar de latest-alias (isLatestAlias) dan
   * wordt de hosted tag ZONDER integrity/crossorigin geemit (src blijft wel
   * door isSafeUrl). SRI pint bytes; latest verandert per release, dus die
   * combinatie zou klant-sites breken bij onze eerstvolgende release.
   */
  function buildEmbedSnippet(configObj, opts) {
    var o = (opts && typeof opts === 'object') ? opts : {};
    var hosted = (o.hosted && typeof o.hosted === 'object') ? o.hosted : null;

    var scriptTag = null;
    if (hosted && typeof hosted.src === 'string' && isSafeUrl(hosted.src)) {
      if (isLatestAlias(hosted.src)) {
        // latest-alias: bewust GEEN integrity (zou bij de volgende release breken)
        scriptTag = '<script src="' + attrEscape(hosted.src) + '"></script>';
      } else if (isValidSri(hosted.sri)) {
        scriptTag = '<script src="' + attrEscape(hosted.src) + '"' +
          ' integrity="' + attrEscape(hosted.sri) + '"' +
          ' crossorigin="anonymous"></script>';
      }
      // versioned src met ongeldige sri -> scriptTag blijft null -> fallback
    }
    if (scriptTag === null) {
      var src = (typeof o.scriptSrc === 'string' && isSafeUrl(o.scriptSrc)) ? o.scriptSrc : DEFAULT_SCRIPT_SRC;
      scriptTag = '<script src="' + attrEscape(src) + '"></script>';
    }

    var initSnippet = serializeConfig(configObj);
    var initIndented = indentLines(initSnippet, '  ');

    return [
      scriptTag,
      '<script>',
      '  ' + initIndented,
      '</script>'
    ].join('\n');
  }

  return {
    buildConfigObject: buildConfigObject,
    serializeConfig: serializeConfig,
    buildEmbedSnippet: buildEmbedSnippet,
    // intern blootgesteld voor tests + hergebruik
    _internals: {
      safeLiteral: safeLiteral,
      attrEscape: attrEscape,
      isValidSri: isValidSri,
      isLatestAlias: isLatestAlias,
      normalizeCookieName: normalizeCookieName,
      normalizeVersion: normalizeVersion,
      isValidGtmId: isValidGtmId,
      isValidGa4Id: isValidGa4Id,
      isSafeUrl: isSafeUrl,
      isSafeColor: isSafeColor,
      THEME_DEFAULTS: THEME_DEFAULTS,
      DEFAULT_SCRIPT_SRC: DEFAULT_SCRIPT_SRC,
      DEFAULT_LANGUAGE: DEFAULT_LANGUAGE
    }
  };
});
