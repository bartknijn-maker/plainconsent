/**
 * Cookie Consent Manager - INSTALL-VERIFIER (quick-connect onboarding, item 12)
 *
 * DOM-vrije, ES5-compatibele PURE analyse-logica. Een klant vult zijn URL in
 * op de demo/beheer-pagina; de pagina fetcht de HTML (client-side) en geeft
 * de string aan analyzeInstallation(). Deze module doet UITSLUITEND
 * string-analyse: geen netwerk, geen DOM, geen externe dependencies.
 * Daardoor is de volledige logica in node testbaar met HTML-fixtures.
 *
 * ReDoS-HARDENING (fix-ronde na security-review):
 *   - de input wordt gecapt op MAX_ANALYZE_BYTES (500 KB); langere input
 *     wordt geknipt en gemeld via truncated:true + warning;
 *   - de script-tag-scan is een HANDMATIGE, begrensde indexOf-loop (geen
 *     regex over de volledige input), zodat catastrofale backtracking
 *     onmogelijk is; ook de src-attribuut-extractie is een lineaire scan.
 *   Regexes worden alleen nog losgelaten op korte, reeds begrensde strings
 *   (een enkele src-waarde of een enkele tag).
 *
 * Rapport-vorm (altijd exact deze velden):
 *   {
 *     scriptFound:     boolean  - is er een PlainConsent script-tag gevonden?
 *     scriptSrc:       string|null - de src van die tag
 *     versionDetected: string|null - versie uit de bestandsnaam
 *                       ('1.0.0' uit cookie-consent.v1.0.0.js,
 *                        'latest' uit cookie-consent.latest.js, anders null)
 *     sriPresent:      boolean  - heeft de tag een integrity-attribuut?
 *     beforeGtm:       boolean|null - staat het PlainConsent-script VOOR de
 *                       GTM-snippet? null als script of GTM niet gevonden is
 *                       (dan valt er niets te vergelijken).
 *     truncated:       boolean  - is de input geknipt op de analyse-limiet?
 *     warnings:        string[] - mens-leesbare bevindingen voor de UI
 *   }
 *
 * Gebruik (browser):
 *   <script src="install_check.js"></script>
 *   <script>var report = PlainConsentInstallCheck.analyzeInstallation(html);</script>
 *
 * Gebruik (node/test):
 *   var IC = require('./install_check.js');
 *   IC.analyzeInstallation('<html>...</html>')
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;                    // node / test
  } else {
    root.PlainConsentInstallCheck = api;     // browser
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  // Analyse-limiet: ruim genoeg voor elke reele <head> (het consent-script en
  // GTM horen bovenin te staan), klein genoeg om de scan altijd snel te houden.
  var MAX_ANALYZE_BYTES = 500 * 1024;

  /** Is dit teken HTML-whitespace? (voor de lineaire scans, geen regex) */
  function isWs(c) {
    return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
  }

  /**
   * Is deze script-src een PlainConsent-bestand? STRIKT (fix-ronde): na het
   * strippen van query/hash moet de bestandsnaam (met padscheiding ervoor of
   * aan het begin van de src) exact een van deze vormen zijn:
   *   cookie-consent.js
   *   cookie-consent.v{major}.{minor}.{patch}.js
   *   cookie-consent.latest.js
   * Dus 'cookie-consent-fork.js' en 'my-cookie-consent.js' matchen NIET.
   * De regex draait op een enkele, al begrensde src-waarde en is anchored
   * zonder geneste kwantoren (geen ReDoS-risico).
   */
  function isPlainConsentSrc(src) {
    if (typeof src !== 'string' || !src) return false;
    var clean = src.split('?')[0].split('#')[0];
    return /(^|\/)cookie-consent(\.v[0-9]+\.[0-9]+\.[0-9]+|\.latest)?\.js$/i.test(clean);
  }

  /**
   * Versie uit de bestandsnaam van de src:
   *   - cookie-consent.v{semver}.js -> '{semver}' (immutable hosted release)
   *   - cookie-consent.latest.js    -> 'latest' (muterende alias)
   *   - anders (bv. kaal cookie-consent.js) -> null
   */
  function detectVersionFromSrc(src) {
    if (typeof src !== 'string') return null;
    var clean = src.split('?')[0].split('#')[0];
    var m = /(^|\/)cookie-consent\.v([0-9]+\.[0-9]+\.[0-9]+)\.js$/i.exec(clean);
    if (m) return m[2];
    if (/(^|\/)cookie-consent\.latest\.js$/i.test(clean)) return 'latest';
    return null;
  }

  /**
   * Extraheer de waarde van het src-ATTRIBUUT uit een enkele script-tag via
   * een lineaire scan (geen regex over de tag). Attribuut-grens (fix-ronde):
   * 'src' telt alleen als het voorafgegaan wordt door whitespace (dus
   * 'data-src=' matcht NIET: daar staat een '-' voor) en gevolgd wordt door
   * optionele whitespace + '=' + een gequote waarde ('srcset' valt af op de
   * '='-check). Geeft de eerste geldige src-waarde terug, of null.
   */
  function extractSrcFromTag(tag) {
    var lower = tag.toLowerCase();
    var from = 0;
    while (true) {
      var p = lower.indexOf('src', from);
      if (p === -1) return null;
      from = p + 3;
      // grens VOOR 'src': moet whitespace zijn (weert data-src, mijn-src, enz.)
      if (p === 0 || !isWs(tag.charAt(p - 1))) continue;
      // grens NA 'src': optionele whitespace, dan '='
      var j = p + 3;
      while (j < tag.length && isWs(tag.charAt(j))) j++;
      if (tag.charAt(j) !== '=') continue;  // bv. 'srcset' of los woord 'src'
      j++;
      while (j < tag.length && isWs(tag.charAt(j))) j++;
      var quote = tag.charAt(j);
      if (quote !== '"' && quote !== "'") continue;  // ongequote src: overslaan
      var end = tag.indexOf(quote, j + 1);
      if (end === -1) return null;  // onafgesloten attribuut
      return tag.slice(j + 1, end);
    }
  }

  /**
   * Vind de eerste GTM-indicator in de HTML (case-insensitief, op een
   * lowercased kopie; alleen indexOf, geen regex). Twee betrouwbare
   * signaturen:
   *   1. de gtm.js-bron zelf (zowel in een <script src> als in de standaard
   *      inline loader-snippet staat 'googletagmanager.com/gtm.js' letterlijk);
   *   2. het 'gtm.start'-dataLayer-signaal uit de officiele inline snippet.
   * Geeft de laagste gevonden index terug, of -1 als er geen GTM in zit.
   */
  function findGtmIndex(lowerHtml) {
    var candidates = [
      lowerHtml.indexOf('googletagmanager.com/gtm.js'),
      lowerHtml.indexOf("'gtm.start'"),
      lowerHtml.indexOf('"gtm.start"')
    ];
    var best = -1;
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] !== -1 && (best === -1 || candidates[i] < best)) {
        best = candidates[i];
      }
    }
    return best;
  }

  /**
   * PURE install-verifier: analyseer de HTML van een klant-pagina en
   * rapporteer of PlainConsent correct geinstalleerd lijkt. Zie de
   * bestandsheader voor de exacte rapport-vorm.
   *
   * Aanpak: begrensde handmatige scan over de (gecapte) input. We zoeken
   * '<script'-openingen via indexOf, nemen de tag tot de eerstvolgende '>'
   * (geen '>' meer -> stoppen: onafgesloten tag, niets meer te parsen) en
   * extraheren de src lineair. De EERSTE tag met een PlainConsent-src telt.
   * De positie daarvan vergelijken we met de eerste GTM-indicator:
   * consent-defaults moeten gezet zijn VOORDAT GTM laadt, dus het
   * PlainConsent-script hoort eerder in het document te staan.
   */
  function analyzeInstallation(htmlString) {
    var report = {
      scriptFound: false,
      scriptSrc: null,
      versionDetected: null,
      sriPresent: false,
      beforeGtm: null,
      truncated: false,
      warnings: []
    };

    if (typeof htmlString !== 'string' || !htmlString) {
      report.warnings.push('Geen HTML ontvangen om te analyseren (lege of ongeldige input).');
      return report;
    }

    var html = htmlString;
    if (html.length > MAX_ANALYZE_BYTES) {
      html = html.slice(0, MAX_ANALYZE_BYTES);
      report.truncated = true;
      report.warnings.push('Pagina groter dan ' + (MAX_ANALYZE_BYTES / 1024) + ' KB; alleen het eerste deel is geanalyseerd (het consent-script hoort in de <head> te staan).');
    }

    var lower = html.toLowerCase();
    var gtmIndex = findGtmIndex(lower);

    // Begrensde scan langs alle <script ...>-openingstags in document-volgorde.
    var pos = 0;
    var scriptIndex = -1;
    var scriptTag = null;
    while (true) {
      var start = lower.indexOf('<script', pos);
      if (start === -1) break;
      // tag-grens: het teken na '<script' moet whitespace, '>' of '/' zijn
      // (weert '<scripty' en custom elements).
      var boundary = lower.charAt(start + 7);
      if (boundary !== '' && boundary !== '>' && boundary !== '/' && !isWs(boundary)) {
        pos = start + 7;
        continue;
      }
      var close = html.indexOf('>', start);
      if (close === -1) break;  // onafgesloten tag: veilig stoppen (begrensd)
      var tag = html.slice(start, close + 1);
      pos = close + 1;
      var src = extractSrcFromTag(tag);
      if (src !== null && isPlainConsentSrc(src)) {
        scriptIndex = start;
        scriptTag = tag;
        report.scriptSrc = src;
        break;  // de eerste PlainConsent-tag telt
      }
    }

    if (scriptIndex === -1) {
      report.warnings.push('PlainConsent script-tag niet gevonden op de pagina.');
      if (gtmIndex !== -1) {
        report.warnings.push('Er laadt wel GTM op deze pagina; zonder consent-script staan de Consent Mode defaults niet op denied.');
      }
      return report;
    }

    report.scriptFound = true;
    report.versionDetected = detectVersionFromSrc(report.scriptSrc);
    // integrity-check op de ENKELE, al begrensde tag: 'integrity' met een
    // attribuut-grens (whitespace ervoor), gevolgd door optionele ws + '='.
    report.sriPresent = /\sintegrity\s*=/i.test(scriptTag);

    if (gtmIndex !== -1) {
      report.beforeGtm = scriptIndex < gtmIndex;
      if (!report.beforeGtm) {
        report.warnings.push('Het PlainConsent-script staat NA de GTM-snippet; GTM laadt dan zonder denied-defaults. Verplaats het consent-script naar boven in de <head>, voor GTM.');
      }
    }
    // gtmIndex === -1: beforeGtm blijft null (geen GTM op de pagina, niets te vergelijken)

    if (report.versionDetected !== null && report.versionDetected !== 'latest' && !report.sriPresent) {
      report.warnings.push('Versioned script zonder integrity-attribuut (SRI); gebruik het embed-snippet uit de config-generator voor byte-gepinde integriteit.');
    }

    return report;
  }

  return {
    analyzeInstallation: analyzeInstallation,
    // intern blootgesteld voor tests + hergebruik
    _internals: {
      isPlainConsentSrc: isPlainConsentSrc,
      detectVersionFromSrc: detectVersionFromSrc,
      extractSrcFromTag: extractSrcFromTag,
      findGtmIndex: findGtmIndex,
      MAX_ANALYZE_BYTES: MAX_ANALYZE_BYTES
    }
  };
});
