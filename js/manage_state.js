/**
 * Cookie Consent Manager - MANAGE-STATE (config-in-URL, "My PlainConsent")
 *
 * DOM-vrije, ES5-compatibele PURE (de)serialisatie van de beheer-pagina-state
 * naar en van de URL-hash. Het idee: de volledige banner-configuratie leeft
 * als base64url-gecodeerde JSON in de hash, zodat een klant zijn instellingen
 * kan bewaren en delen zonder login ("je link is je account"). Geen PII, geen
 * opslag aan onze kant.
 *
 * SECURITY-KERN (hash = onvertrouwde input, iedereen kan een link smeden):
 *   - WHITELIST-LEZEN: bij het teruglezen worden UITSLUITEND de keys uit
 *     STATE_KEYS overgenomen. We itereren nooit over de keys van het geparste
 *     object, dus prototype-pollution-keys (__proto__/constructor/prototype)
 *     en onbekende keys worden per constructie nooit gelezen of gekopieerd.
 *   - GROOTTE-GRENZEN: een hash langer dan MAX_HASH_CHARS wordt geweigerd
 *     (null); een individuele waarde langer dan MAX_VALUE_CHARS wordt
 *     afgekapt. Zo kan een gesmede mega-hash de pagina nooit belasten.
 *   - TYPE-DISCIPLINE: alleen string-waarden (plus eindige nummers, die naar
 *     string genormaliseerd worden, voor consentVersion). Objecten, arrays,
 *     booleans en null worden genegeerd.
 *   - CONTROL-CHARS worden uit waarden gestript; kapotte base64 of kapotte
 *     JSON geeft null (nooit een exception naar de UI).
 *   De waarden zelf blijven "ruwe form-input": de daadwerkelijke validatie
 *   (GTM-formaat, veilige kleuren, veilige URLs) gebeurt daarna in
 *   config-generator.js (buildConfigObject) en in de product-core zelf.
 *
 * Gebruik (browser):
 *   <script src="manage_state.js"></script>
 *   <script>
 *     var state = PlainConsentManageState.deserializeState(location.hash);
 *     location.hash = PlainConsentManageState.serializeState(state);
 *   </script>
 *
 * Gebruik (node/test):
 *   var MS = require('./manage_state.js');
 *   MS.deserializeState(MS.serializeState({ locale: 'nl' }))
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;                     // node / test
  } else {
    root.PlainConsentManageState = api;       // browser
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  // De ENIGE keys die de beheer-pagina beheert. Alles buiten deze lijst wordt
  // bij het teruglezen genegeerd. DANGEROUS_KEYS (__proto__/constructor/
  // prototype) staan hier per definitie niet in; omdat we uitsluitend deze
  // lijst lezen is dat de structurele guard, niet een aparte blocklist.
  var STATE_KEYS = [
    'locale', 'geo',
    'accent', 'bg', 'text',
    'gtmId', 'ga4Id',
    'privacyUrl', 'consentVersion'
  ];

  // Grenzen tegen gesmede mega-hashes (zie SECURITY-KERN hierboven).
  var MAX_HASH_CHARS = 4096;   // totale hash-lengte: langer -> geweigerd (null)
  var MAX_VALUE_CHARS = 200;   // per waarde: langer -> afgekapt

  /** Strip control-chars (incl. CR/LF/null/DEL) uit een waarde. ES5-loop. */
  function stripControlChars(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 32 || c === 127) continue;
      out += s.charAt(i);
    }
    return out;
  }

  /** Standaard base64 -> base64url (URL/fragment-veilig, geen padding). */
  function toBase64Url(b64) {
    return String(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /**
   * base64url -> standaard base64, met charset-check en padding-herstel.
   * Ongeldige tekens of een onmogelijke lengte (rest 1) -> null.
   */
  function fromBase64Url(u) {
    var s = String(u);
    if (!/^[A-Za-z0-9\-_]+$/.test(s)) return null;
    var b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    var rest = b64.length % 4;
    if (rest === 1) return null;              // kan nooit geldige base64 zijn
    if (rest === 2) b64 += '==';
    else if (rest === 3) b64 += '=';
    return b64;
  }

  /**
   * UTF-8-veilige base64url-encode van een string. Browser: btoa op een
   * UTF-8 byte-string (het klassieke encodeURIComponent/unescape-patroon,
   * ES5-compatibel); node: Buffer. Geen van beide beschikbaar -> null.
   */
  function encodeBase64(str) {
    try {
      if (typeof btoa === 'function') {
        return toBase64Url(btoa(unescape(encodeURIComponent(str))));
      }
      if (typeof Buffer !== 'undefined' && Buffer.from) {
        return toBase64Url(Buffer.from(str, 'utf8').toString('base64'));
      }
    } catch (e) { return null; }
    return null;
  }

  /**
   * base64url-decode terug naar een UTF-8 string. Kapotte input (verkeerde
   * tekens, kapotte padding, malformed UTF-8) -> null, nooit een exception.
   */
  function decodeBase64(u) {
    var b64 = fromBase64Url(u);
    if (b64 === null) return null;
    try {
      if (typeof atob === 'function') {
        return decodeURIComponent(escape(atob(b64)));
      }
      if (typeof Buffer !== 'undefined' && Buffer.from) {
        return Buffer.from(b64, 'base64').toString('utf8');
      }
    } catch (e) { return null; }
    return null;
  }

  /**
   * Neem uit een bron-object uitsluitend de STATE_KEYS over, genormaliseerd:
   * eindige nummers -> string; alleen strings verder; trim + control-chars
   * strippen; leeg -> overslaan; langer dan MAX_VALUE_CHARS -> afkappen.
   * Geeft { state: {...}, any: boolean } terug (any = minstens 1 key over).
   */
  function pickKnownKeys(source) {
    var out = {};
    var any = false;
    for (var i = 0; i < STATE_KEYS.length; i++) {
      var k = STATE_KEYS[i];
      if (!Object.prototype.hasOwnProperty.call(source, k)) continue;
      var v = source[k];
      if (typeof v === 'number' && isFinite(v)) v = String(v);
      if (typeof v !== 'string') continue;
      v = stripControlChars(v).replace(/^\s+|\s+$/g, '');
      if (!v) continue;
      if (v.length > MAX_VALUE_CHARS) v = v.slice(0, MAX_VALUE_CHARS);
      out[k] = v;
      any = true;
    }
    return { state: out, any: any };
  }

  /**
   * Serialiseer een state-object naar een base64url-string voor de URL-hash
   * (ZONDER leidende '#'). Alleen bekende keys met bruikbare waarden gaan
   * mee; is er niets bruikbaars, dan is het resultaat '' (lege hash).
   */
  function serializeState(state) {
    if (!state || typeof state !== 'object') return '';
    var picked = pickKnownKeys(state);
    if (!picked.any) return '';
    var encoded = encodeBase64(JSON.stringify(picked.state));
    return (encoded === null) ? '' : encoded;
  }

  /**
   * Lees een URL-hash (met of zonder leidende '#') terug naar een state-
   * object. Elke faalroute geeft null: lege hash, te lange hash (geweigerd),
   * kapotte base64, kapotte JSON, JSON die geen plain object is, of een
   * object zonder een enkele bruikbare bekende key. Zie SECURITY-KERN in de
   * bestandsheader voor de volledige hardening-lijst.
   */
  function deserializeState(hash) {
    if (typeof hash !== 'string') return null;
    var h = (hash.charAt(0) === '#') ? hash.slice(1) : hash;
    if (!h) return null;
    if (h.length > MAX_HASH_CHARS) return null;   // gesmede mega-hash: weigeren
    var json = decodeBase64(h);
    if (json === null) return null;
    var parsed;
    try { parsed = JSON.parse(json); } catch (e) { return null; }
    if (!parsed || typeof parsed !== 'object') return null;
    if (Object.prototype.toString.call(parsed) === '[object Array]') return null;
    var picked = pickKnownKeys(parsed);
    return picked.any ? picked.state : null;
  }

  return {
    serializeState: serializeState,
    deserializeState: deserializeState,
    // intern blootgesteld voor tests + hergebruik
    _internals: {
      STATE_KEYS: STATE_KEYS,
      MAX_HASH_CHARS: MAX_HASH_CHARS,
      MAX_VALUE_CHARS: MAX_VALUE_CHARS,
      encodeBase64: encodeBase64,
      decodeBase64: decodeBase64,
      stripControlChars: stripControlChars
    }
  };
});
