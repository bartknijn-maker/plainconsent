/*! Cookie Consent Manager v1.2.0 | bron: cookie-consent.js (PlainConsent product-core) */
/**
 * Cookie Consent Manager — PRODUCT core (multi-tenant, config-driven)
 *
 * Commerciële versie van de CMP die oorspronkelijk voor bartknijnenberg.com is
 * gebouwd. Waar de single-site versie alles hardcodeerde, is dit een config-driven
 * core die per klant (tenant) geconfigureerd wordt — de basis voor een verkoopbaar
 * Cookiebot-alternatief.
 *
 * Gebruik (browser):
 *   <script src="cookie-consent.js"></script>
 *   <script>CookieConsent.init({ gtmId: 'GTM-XXXX', consentVersion: 2, ... });</script>
 *
 * Gebruik (test/node):
 *   const CC = require('./cookie-consent.js');
 *   CC._internals.needsReconsent(stored, 2)
 *
 * Pure logica (detectLanguage, needsReconsent, (de)serialiseren) raakt geen DOM en
 * is daardoor in node testbaar; DOM-rendering draait alleen in de browser.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // node / test
  } else {
    root.CookieConsent = api;         // browser
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var VERSION = '1.2.0';
  var DANGEROUS_KEYS = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };

  /** Veilige URL voor een href: alleen relatief (/) of expliciet https://.
   *  Een protocol-relatieve URL (//host) wordt geweigerd: die zou op een https-
   *  pagina naar https://host resolven (data-exfiltratie naar een willekeurige
   *  host), terwijl een echte relatieve URL maar EEN leidende slash heeft. */
  function isSafeUrl(url) {
    if (typeof url !== 'string' || !url) return false;
    if (url.charAt(0) === '/') return url.charAt(1) !== '/';  // '/pad' ok, '//host' niet
    return /^https:\/\//i.test(url);
  }

  /** Geldige GTM-container-id (voorkomt injectie van willekeurige URLs). */
  function isValidGtmId(id) {
    return typeof id === 'string' && /^GTM-[A-Z0-9]+$/i.test(id);
  }

  /** Geldige GA4 measurement-id (anchored: 'G-' + 4-20 alfanumeriek).
   *  Zelfde semantiek als isValidGa4Id in de config-generator; voorkomt
   *  injectie van willekeurige strings in de gtag.js-URL. */
  function isValidGa4Id(id) {
    return typeof id === 'string' && /^G-[A-Z0-9]{4,20}$/i.test(id);
  }

  /** Veilige https-script-bron voor een marketingpixel. */
  function isSafePixelSrc(src) {
    return typeof src === 'string' && /^https:\/\//i.test(src);
  }

  // Kleine whitelist van CSS-kleurkeywords die we expliciet toestaan.
  var SAFE_COLOR_KEYWORDS = {
    'transparent': 1, 'white': 1, 'black': 1, 'currentcolor': 1, 'inherit': 1
  };

  /**
   * Veilige CSS-kleur voor tenant-gedreven theming. Voorkomt CSS-injectie:
   * accepteert ALLEEN hex (#rgb, #rgba, #rrggbb, #rrggbbaa), rgb()/rgba() met
   * numerieke argumenten, en een kleine whitelist van keywords. Alles anders
   * (bv. 'red;}body{display:none', '</style>', 'url(...)', 'expression(...)',
   * 'javascript:') wordt geweigerd zodat de caller terugvalt op de default.
   */
  function isSafeColor(value) {
    if (typeof value !== 'string') return false;
    var v = value.trim();
    if (!v) return false;
    // hex: 3, 4, 6 of 8 hex-tekens
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return true;
    // rgb(r,g,b): 3 numerieke argumenten
    if (/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/.test(v)) return true;
    // rgba(r,g,b,a): 3 ints + 1 alpha (int of decimaal)
    if (/^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\)$/.test(v)) return true;
    // whitelist-keyword (case-insensitive)
    if (Object.prototype.hasOwnProperty.call(SAFE_COLOR_KEYWORDS, v.toLowerCase())) return true;
    return false;
  }

  /** Pak een gevalideerde kleur uit theme[key], anders de DEFAULTS-waarde. */
  function safeThemeColor(theme, key) {
    var fallback = DEFAULTS.theme[key];
    if (theme && isSafeColor(theme[key])) return theme[key];
    return fallback;
  }

  /**
   * Bouw de scoped CSS-string voor de widget (gedreven door config.theme).
   * Alle kleuren lopen door isSafeColor; onveilige waarden vallen terug op
   * DEFAULTS.theme. De CSS wordt uitsluitend uit gevalideerde waarden opgebouwd,
   * zodat een aanvaller-gestuurde theme-waarde nooit verbatim in de output komt.
   * Selectors zijn ge-prefixed met cc- (matcht renderBanner).
   */
  function buildStyleCss(theme) {
    var accent = safeThemeColor(theme, 'accent');
    var bg = safeThemeColor(theme, 'bg');
    var text = safeThemeColor(theme, 'text');
    return [
      '#cc-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:99999;',
      'display:flex;align-items:flex-end;justify-content:center;padding:16px;',
      'animation:cc-fadeIn 0.3s ease;backdrop-filter:blur(2px);',
      "font-family:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif;}",
      '#cc-overlay.cc-hiding{animation:cc-fadeOut 0.3s ease forwards;}',
      '#cc-banner{width:100%;max-width:520px;background:', bg, ';',
      'border:1px solid rgba(255,255,255,0.1);border-radius:16px;',
      'box-shadow:0 -4px 40px rgba(0,0,0,0.4);overflow:hidden;',
      'animation:cc-slideUp 0.3s ease;}',
      '#cc-overlay.cc-hiding #cc-banner{animation:cc-slideDown 0.3s ease forwards;}',
      '.cc-inner{padding:28px 28px 20px;}',
      '#cc-banner h2{font-size:20px;font-weight:700;color:', text, ';',
      'margin:0 0 8px;line-height:1.3;}',
      '#cc-banner p{font-size:14px;font-weight:400;color:', text, ';opacity:0.7;',
      'margin:0 0 20px;line-height:1.6;}',
      '.cc-actions{display:flex;gap:10px;margin-bottom:4px;}',
      '#cc-accept,#cc-reject{font-size:14px;font-weight:600;padding:10px 20px;',
      'border:none;border-radius:8px;cursor:pointer;transition:all 0.15s ease;',
      'flex:1;text-align:center;}',
      '#cc-accept{background:', accent, ';color:', text, ';}',
      '#cc-accept:hover{transform:translateY(-1px);filter:brightness(0.92);}',
      '#cc-reject{background:rgba(255,255,255,0.1);color:', text, ';',
      'border:1px solid rgba(255,255,255,0.2);}',
      '#cc-reject:hover{transform:translateY(-1px);background:rgba(255,255,255,0.15);}',
      '#cc-banner input[type="checkbox"]:checked{accent-color:', accent, ';}',
      '#cc-customize{font-size:14px;font-weight:600;padding:10px 20px;',
      'border:1px solid rgba(255,255,255,0.2);border-radius:8px;cursor:pointer;',
      'transition:all 0.15s ease;flex:1;text-align:center;',
      'background:rgba(255,255,255,0.1);color:', text, ';}',
      '#cc-customize:hover{transform:translateY(-1px);background:rgba(255,255,255,0.15);}',
      '#cc-save{font-size:14px;font-weight:600;padding:10px 20px;border:none;',
      'border-radius:8px;cursor:pointer;transition:all 0.15s ease;flex:1;',
      'text-align:center;background:', accent, ';color:', text, ';}',
      '#cc-save:hover{transform:translateY(-1px);filter:brightness(0.92);}',
      '.cc-categories{margin:0 0 16px;}',
      '.cc-category{display:flex;align-items:flex-start;gap:12px;padding:12px 0;',
      'border-top:1px solid rgba(255,255,255,0.06);}',
      '.cc-category:first-child{border-top:none;}',
      '.cc-category-body{flex:1;}',
      '.cc-category-label{font-size:14px;font-weight:600;color:', text, ';',
      'margin:0 0 2px;display:block;}',
      '.cc-category-desc{font-size:12px;font-weight:400;color:', text, ';',
      'opacity:0.6;margin:0;line-height:1.5;}',
      '.cc-category input[type="checkbox"]{width:18px;height:18px;margin-top:2px;',
      'cursor:pointer;flex-shrink:0;}',
      '.cc-category input[type="checkbox"]:disabled{cursor:not-allowed;opacity:0.5;}',
      '.cc-footer{text-align:center;margin-top:16px;padding-top:12px;',
      'border-top:1px solid rgba(255,255,255,0.06);}',
      '.cc-footer a{font-size:12px;color:', text, ';opacity:0.5;text-decoration:none;}',
      '.cc-footer a:hover{opacity:0.8;text-decoration:underline;}',
      '@keyframes cc-fadeIn{from{opacity:0;}to{opacity:1;}}',
      '@keyframes cc-fadeOut{from{opacity:1;}to{opacity:0;}}',
      '@keyframes cc-slideUp{from{transform:translateY(20px);opacity:0;}to{transform:translateY(0);opacity:1;}}',
      '@keyframes cc-slideDown{from{transform:translateY(0);opacity:1;}to{transform:translateY(20px);opacity:0;}}',
      '@media (max-width:480px){',
      '#cc-overlay{padding:8px;align-items:flex-end;}',
      '#cc-banner{border-radius:14px 14px 0 0;max-width:100%;}',
      '.cc-inner{padding:22px 18px 16px;}',
      '#cc-banner h2{font-size:18px;}',
      '.cc-actions{flex-direction:column;}',
      '#cc-accept,#cc-reject,#cc-customize,#cc-save{padding:12px 20px;}',
      '}'
    ].join('');
  }

  // ============================================================
  // I18N: ingebouwde vertaal-tabellen (item 7)
  // ============================================================
  // Alle user-facing banner-strings per taal. De 'en'- en 'nl'-tabellen zijn
  // byte-voor-byte gelijk aan de oorspronkelijke DEFAULTS.translations
  // (backwards compat). Elke taal heeft exact dezelfde keys als 'en';
  // resolveTexts() gebruikt 'en' bovendien als vangnet zodat een key nooit
  // kan ontbreken in de render-laag.
  var I18N = {
    en: {
      title: 'We value your privacy',
      description: 'We use cookies to improve your experience, analyze traffic, and for marketing. Choose which cookies to accept.',
      acceptAll: 'Accept all', rejectAll: 'Reject all', customize: 'Customize',
      savePreferences: 'Save preferences', privacyLink: 'Privacy Policy',
      necessary: 'Necessary', necessaryDesc: 'Essential for the website to function. Cannot be disabled.',
      analytics: 'Analytics', analyticsDesc: 'Help us understand how visitors use our website.',
      marketing: 'Marketing', marketingDesc: 'Used to deliver relevant ads and measure campaigns.'
    },
    nl: {
      title: 'We waarderen je privacy',
      description: 'We gebruiken cookies om je ervaring te verbeteren, verkeer te analyseren en voor marketing. Kies welke cookies je accepteert.',
      acceptAll: 'Alles accepteren', rejectAll: 'Alles weigeren', customize: 'Aanpassen',
      savePreferences: 'Voorkeuren opslaan', privacyLink: 'Privacybeleid',
      necessary: 'Noodzakelijk', necessaryDesc: 'Essentieel voor de werking van de website. Kan niet uitgeschakeld worden.',
      analytics: 'Analyse', analyticsDesc: 'Helpen ons begrijpen hoe bezoekers de website gebruiken.',
      marketing: 'Marketing', marketingDesc: 'Gebruikt om relevante advertenties te tonen en campagnes te meten.'
    },
    de: {
      title: 'Ihre Privatsphäre ist uns wichtig',
      description: 'Wir verwenden Cookies, um Ihr Nutzererlebnis zu verbessern, den Datenverkehr zu analysieren und für Marketingzwecke. Wählen Sie, welche Cookies Sie akzeptieren möchten.',
      acceptAll: 'Alle akzeptieren', rejectAll: 'Alle ablehnen', customize: 'Anpassen',
      savePreferences: 'Einstellungen speichern', privacyLink: 'Datenschutzerklärung',
      necessary: 'Notwendig', necessaryDesc: 'Erforderlich für den Betrieb der Website. Kann nicht deaktiviert werden.',
      analytics: 'Analyse', analyticsDesc: 'Helfen uns zu verstehen, wie Besucher unsere Website nutzen.',
      marketing: 'Marketing', marketingDesc: 'Werden verwendet, um relevante Werbung anzuzeigen und Kampagnen zu messen.'
    },
    es: {
      title: 'Su privacidad es importante para nosotros',
      description: 'Utilizamos cookies para mejorar su experiencia, analizar el tráfico y con fines de marketing. Elija qué cookies desea aceptar.',
      acceptAll: 'Aceptar todas', rejectAll: 'Rechazar todas', customize: 'Personalizar',
      savePreferences: 'Guardar preferencias', privacyLink: 'Política de privacidad',
      necessary: 'Necesarias', necessaryDesc: 'Esenciales para el funcionamiento del sitio web. No se pueden desactivar.',
      analytics: 'Análisis', analyticsDesc: 'Nos ayudan a entender cómo los visitantes utilizan nuestro sitio web.',
      marketing: 'Marketing', marketingDesc: 'Se utilizan para mostrar anuncios relevantes y medir campañas.'
    },
    fr: {
      title: 'Votre vie privée compte pour nous',
      description: 'Nous utilisons des cookies pour améliorer votre expérience, analyser le trafic et à des fins marketing. Choisissez les cookies que vous souhaitez accepter.',
      acceptAll: 'Tout accepter', rejectAll: 'Tout refuser', customize: 'Personnaliser',
      savePreferences: 'Enregistrer les préférences', privacyLink: 'Politique de confidentialité',
      necessary: 'Nécessaires', necessaryDesc: 'Indispensables au fonctionnement du site. Ne peuvent pas être désactivés.',
      analytics: 'Statistiques', analyticsDesc: 'Nous aident à comprendre comment les visiteurs utilisent notre site.',
      marketing: 'Marketing', marketingDesc: 'Servent à diffuser des publicités pertinentes et à mesurer les campagnes.'
    }
  };

  // ============================================================
  // DEFAULT CONFIG — per tenant overschreven via init()
  // ============================================================
  var DEFAULTS = {
    gtmId: null,
    ga4Id: null,                  // GA4 measurement-id (G-XXXXXXXXXX): quick-connect zonder GTM
    consentCookieName: 'cc_consent',
    consentCookieDays: 365,
    consentVersion: 1,            // verhoog na policy-wijziging -> forceert re-consent
    enabled: true,
    autoLoadGTM: true,
    privacyUrl: '/privacy-policy',
    defaultLanguage: 'en',
    locale: null,                 // expliciete banner-taal: 'nl'|'en'|'de'|'es'|'fr'; null = pad-detectie
    texts: null,                  // per-key override van de opgeloste teksten (wint van de tabellen)
    // pad-prefixes die een taal forceren (eerste match wint)
    languagePaths: { nl: ['/nl', '/nl-nl'] },
    categories: ['necessary', 'analytics', 'marketing'],
    geo: 'always',                // 'always' = banner overal tonen | 'eu-only' = alleen in de EU
    geoResolver: null,            // klant-functie die async {inEU: bool} levert (thenable of callback)
    geoTimeout: 3000,             // ms wachten op de geoResolver; daarna fail-safe tonen
    marketingPixels: [],
    theme: { accent: '#2563EB', bg: '#0D0D0D', text: '#FFFFFF' },
    onConsent: null,             // callback(consent) na elke keuze
    consentLogUrl: null,         // optioneel: audit-endpoint voor consent-bewijs (relatief / https)
    translations: I18N           // per tenant uitbreidbaar/overschrijfbaar via mergeConfig
  };

  // ============================================================
  // PURE LOGICA (DOM-vrij, node-testbaar)
  // ============================================================

  /** Diepe merge van tenant-config over de defaults (config wint). */
  function mergeConfig(defaults, user) {
    var out = {};
    var k;
    for (k in defaults) { if (Object.prototype.hasOwnProperty.call(defaults, k)) out[k] = defaults[k]; }
    if (!user) return out;
    for (k in user) {
      if (!Object.prototype.hasOwnProperty.call(user, k)) continue;
      if (DANGEROUS_KEYS[k]) continue;  // prototype-pollution-bescherming
      var uv = user[k];
      if (uv && typeof uv === 'object' && !Array.isArray(uv) &&
          out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = mergeConfig(out[k], uv);
      } else {
        out[k] = uv;
      }
    }
    return out;
  }

  /** Detecteer taal uit een pad o.b.v. config.languagePaths; anders default. */
  function detectLanguage(path, config) {
    var paths = (config && config.languagePaths) || {};
    var lower = String(path || '').toLowerCase();
    for (var lang in paths) {
      if (!Object.prototype.hasOwnProperty.call(paths, lang)) continue;
      var prefixes = paths[lang] || [];
      for (var i = 0; i < prefixes.length; i++) {
        var pfx = String(prefixes[i]).toLowerCase();
        if (lower.indexOf(pfx) === 0) {
          // grens-check: '/nl' mag niet matchen op '/nlbloep'
          var rest = lower.slice(pfx.length);
          if (rest === '' || rest.charAt(0) === '/' || rest.charAt(0) === '?' || rest.charAt(0) === '#') {
            return lang;
          }
        }
      }
    }
    return (config && config.defaultLanguage) || 'en';
  }

  /** Kopieer own-properties van source naar target (prototype-pollution-veilig). */
  function overlayTexts(target, source) {
    for (var k in source) {
      if (!Object.prototype.hasOwnProperty.call(source, k)) continue;
      if (DANGEROUS_KEYS[k]) continue;  // prototype-pollution-bescherming
      target[k] = source[k];
    }
    return target;
  }

  /**
   * Pure lookup-helper (DOM-vrij, geen netwerk, geen auto-detectie): los alle
   * user-facing banner-teksten op voor een config. Lagen, laatste wint:
   *   1. ingebouwde 'en'-tabel (vangnet: volledige key-dekking, altijd)
   *   2. ingebouwde I18N-tabel voor de gekozen locale
   *   3. tenant-vertalingen uit config.translations[locale] (bestaand mechanisme)
   *   4. config.texts: per-key override, wint altijd van de tabellen
   *
   * Locale-keuze: localeOverride (render-laag, bv. pad-detectie) > config.locale
   * > 'en'. Lookup is case-insensitief ('NL' -> 'nl'). Een onbekende locale valt
   * terug op 'en' met een console.warn, tenzij de tenant er zelf een vertaal-
   * tabel voor meelevert via config.translations (dan is die gewoon geldig).
   */
  function resolveTexts(config, localeOverride) {
    var cfg = (config && typeof config === 'object') ? config : {};
    var requested = (localeOverride != null) ? localeOverride : cfg.locale;
    var loc = (requested == null) ? 'en' : String(requested).toLowerCase();
    var tenant = (cfg.translations && typeof cfg.translations === 'object') ? cfg.translations : null;
    var hasBuiltin = !DANGEROUS_KEYS[loc] && Object.prototype.hasOwnProperty.call(I18N, loc);
    var hasTenant = !!(tenant && !DANGEROUS_KEYS[loc] &&
        Object.prototype.hasOwnProperty.call(tenant, loc) &&
        tenant[loc] && typeof tenant[loc] === 'object');
    if (!hasBuiltin && !hasTenant) {
      if (typeof console !== 'undefined') {
        console.warn('[CookieConsent] onbekende locale, terugval op en:', requested);
      }
      loc = 'en';
      hasBuiltin = true;
      hasTenant = !!(tenant && Object.prototype.hasOwnProperty.call(tenant, 'en') &&
          tenant.en && typeof tenant.en === 'object');
    }
    var out = overlayTexts({}, I18N.en);                       // 1. vangnet
    if (hasBuiltin && loc !== 'en') overlayTexts(out, I18N[loc]); // 2. ingebouwde taal
    if (hasTenant) overlayTexts(out, tenant[loc]);             // 3. tenant translations
    if (cfg.texts && typeof cfg.texts === 'object') overlayTexts(out, cfg.texts); // 4. per-key override
    return out;
  }

  /**
   * DE KERN-FIX: bepaal of (opnieuw) consent gevraagd moet worden.
   * true als er geen geldige opgeslagen consent is OF als de opgeslagen
   * consent-versie afwijkt van de huidige config-versie (policy is gewijzigd).
   * Hiermee werkt de gedocumenteerde "re-consent bij policy-wijziging" echt.
   */
  function needsReconsent(stored, currentVersion, categories) {
    if (!stored || typeof stored !== 'object') return true;
    var cats = categories || ['analytics', 'marketing'];
    for (var i = 0; i < cats.length; i++) {
      if (cats[i] === 'necessary') continue;
      if (typeof stored[cats[i]] !== 'boolean') return true;  // categorie ontbreekt -> re-consent
    }
    // String-vergelijking: voorkomt spurious re-consent bij "1" (string) vs 1 (number)
    if (String(stored.version) !== String(currentVersion)) return true;
    return false;
  }

  /**
   * GEO-TARGETING (item 8): pure, DOM-vrije beslisser of de banner getoond
   * moet worden op basis van een geo-resultaat en config.geo.
   *
   * Regels:
   *   - config.geo !== 'eu-only' (dus 'always', ontbrekend of onbekend) -> true.
   *     Exact het gedrag van voor dit item; er is dan geen geo-resultaat nodig.
   *   - config.geo === 'eu-only' + geldig resultaat {inEU: boolean} -> inEU.
   *   - config.geo === 'eu-only' + ongeldig resultaat (null, geen object,
   *     inEU geen boolean) -> true. FAIL-SAFE: de consent-plicht weegt zwaarder
   *     dan het verbergen van de banner; bij twijfel dus altijd tonen.
   *
   * Let op: dit bepaalt UITSLUITEND of de banner verschijnt bij ontbrekende
   * consent. Replay van bestaand consent (consent-mode + script-unblocking)
   * loopt hier bewust NIET doorheen en werkt dus altijd, ongeacht geo.
   */
  function shouldShowBanner(geoResult, config) {
    var geo = config && config.geo;
    if (geo !== 'eu-only') return true;  // 'always' / ontbrekend / onbekend: huidig gedrag
    if (geoResult && typeof geoResult === 'object' && typeof geoResult.inEU === 'boolean') {
      return geoResult.inEU;
    }
    return true;  // fail-safe: ongeldig/ontbrekend resultaat -> tonen
  }

  /**
   * GEO-TIMEOUT (fix-ronde na review): valideer config.geoTimeout tot een
   * bruikbaar aantal ms. Alleen een eindig, positief getal is geldig; alles
   * anders (string, 0, negatief, NaN, Infinity, ontbrekend) valt terug op de
   * default van 3000ms. Pure helper, DOM-vrij, node-testbaar.
   */
  var GEO_TIMEOUT_DEFAULT = 3000;
  function normalizeGeoTimeout(value) {
    if (typeof value === 'number' && isFinite(value) && value > 0) return value;
    return GEO_TIMEOUT_DEFAULT;
  }

  /**
   * CONSENT MODE v2 (item 12): pure, DOM-vrije mapping van categorie-keuzes
   * naar de vier Google Consent Mode v2 signalen. Testbaar zonder GTM-stub.
   *
   * Mapping (Cookiebot-terminologie 'statistics' wordt als alias van
   * 'analytics' geaccepteerd, zodat tenant-configs met die naamgeving ook
   * correct doorwerken):
   *   - analytics (of statistics)  -> analytics_storage
   *   - marketing                  -> ad_storage + ad_user_data + ad_personalization
   *
   * Input: een categorie-object met booleans (consent-record of keuze-object).
   * Output: ALTIJD exact de vier v2-signalen, elk 'granted' of 'denied'.
   * Defensief: geen object of ontbrekende keys -> denied (privacy-by-default).
   */
  function buildConsentModeSignals(categories) {
    var c = (categories && typeof categories === 'object') ? categories : {};
    var analyticsGranted = !!(c.analytics || c.statistics);
    var marketingGranted = !!c.marketing;
    return {
      ad_storage: marketingGranted ? 'granted' : 'denied',
      ad_user_data: marketingGranted ? 'granted' : 'denied',
      ad_personalization: marketingGranted ? 'granted' : 'denied',
      analytics_storage: analyticsGranted ? 'granted' : 'denied'
    };
  }

  /**
   * Genereer een unieke consent-id voor audit-bewijs (GDPR Art. 7).
   * Gebruikt crypto.randomUUID() waar beschikbaar; anders een ES5-veilige
   * UUID-v4-achtige fallback via Math.random (geen externe deps).
   */
  function genConsentId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /** Bouw het te bewaren consent-object incl. id, versie + timestamp. */
  function buildConsentRecord(choice, config, nowIso) {
    var record = { id: genConsentId(), necessary: true, version: config.consentVersion, timestamp: nowIso };
    var cats = (config && config.categories) || ['necessary', 'analytics', 'marketing'];
    for (var i = 0; i < cats.length; i++) {
      if (cats[i] === 'necessary') continue;
      record[cats[i]] = !!choice[cats[i]];   // config-driven: ook custom categorieën
    }
    // gtag-mapping vereist analytics + marketing altijd als boolean aanwezig
    if (typeof record.analytics !== 'boolean') record.analytics = !!choice.analytics;
    if (typeof record.marketing !== 'boolean') record.marketing = !!choice.marketing;
    return record;
  }

  /**
   * Bouw een STABIELE, gedocumenteerde audit-payload uit een consent-record.
   * Doel: server-side bewijs van consent (GDPR Art. 7 accountability) met een
   * vorm die NIET varieert met tenant-specifieke categorie-namen op top-niveau.
   * Alle per-categorie booleans (necessary/analytics/marketing + custom) komen
   * onder een vaste 'categories'-sleutel; de overige top-velden zijn altijd
   * dezelfde set. Zo kan een audit-endpoint elke tenant uniform verwerken.
   *
   * Privacy-veilig: leidt UITSLUITEND af uit het reeds gebouwde consent-record.
   * Verzint geen PII en leest geen navigator/user-agent/IP (de server vangt het
   * IP zelf af). 'necessary' is per definitie altijd true.
   *
   * Vorm:
   *   { id, version, timestamp, categories:{necessary,...}, source, schema }
   */
  function buildConsentLogPayload(record) {
    var r = (record && typeof record === 'object') ? record : {};
    var categories = { necessary: true };
    var RESERVED = { id: 1, version: 1, timestamp: 1, necessary: 1 };
    for (var k in r) {
      if (!Object.prototype.hasOwnProperty.call(r, k)) continue;
      if (DANGEROUS_KEYS[k]) continue;   // prototype-pollution-bescherming
      if (RESERVED[k]) continue;         // top-niveau meta-velden niet als categorie
      categories[k] = !!r[k];            // elke overige record-boolean is een categorie
    }
    return {
      id: r.id,
      version: r.version,
      timestamp: r.timestamp,
      categories: categories,
      source: 'cookie-consent-manager',
      schema: 1
    };
  }

  /**
   * Bouw een DOM-vrij model voor het per-categorie consent-paneel (Customize).
   * Geeft een array terug van rijen { key, label, description, required, checked }
   * per categorie uit config.categories. De render-laag gebruikt dit model.
   *
   * Regels:
   *   - necessary -> required:true + checked:true (altijd aan, niet uitschakelbaar)
   *   - overige categorieën -> checked = bestaande opgeslagen keuze of false
   *     (privacy-by-default; consent is opt-in)
   *   - label uit translations[key], description uit translations[key + 'Desc'];
   *     ontbreekt een vertaling dan valt het terug op de categorie-key zelf.
   */
  function buildCategoryModel(config, translations, stored) {
    var cats = (config && config.categories) || ['necessary', 'analytics', 'marketing'];
    var t = translations || {};
    var s = (stored && typeof stored === 'object') ? stored : null;
    var rows = [];
    for (var i = 0; i < cats.length; i++) {
      var key = cats[i];
      if (DANGEROUS_KEYS[key]) continue;  // prototype-pollution-bescherming
      var required = (key === 'necessary');
      var checked;
      if (required) {
        checked = true;
      } else if (s && typeof s[key] === 'boolean') {
        checked = s[key];
      } else {
        checked = false;
      }
      var label = (typeof t[key] === 'string') ? t[key] : key;
      var descKey = key + 'Desc';
      var description = (typeof t[descKey] === 'string') ? t[descKey] : '';
      rows.push({ key: key, label: label, description: description, required: required, checked: checked });
    }
    return rows;
  }

  /**
   * Pure, DOM-vrije helper voor event-delegation van de "Beheer cookies"-link.
   * Loopt vanaf node omhoog door parentNode en geeft true zodra een element
   * het attribuut data-cookie-consent="manage" heeft. Zo werkt ook een klik op
   * een child-element van de link, en werken elementen die NA init worden
   * toegevoegd ook (de listener staat gedelegeerd op document).
   * Stopt bij niet-element-nodes (nodeType !== 1) of het einde van de keten.
   * Testbaar met fake-node-objecten { nodeType:1, getAttribute, parentNode }.
   */
  function isManageTrigger(node) {
    var current = node;
    while (current && current.nodeType === 1 &&
           typeof current.getAttribute === 'function') {
      if (current.getAttribute('data-cookie-consent') === 'manage') return true;
      current = current.parentNode;
    }
    return false;
  }

  // ============================================================
  // A11Y / FOCUS-MANAGEMENT — pure, DOM-vrije helpers (item 18)
  // ============================================================

  // Tags die van nature (mits niet disabled) focusbaar zijn.
  var FOCUSABLE_TAGS = { BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1 };

  /**
   * Pure predikaat (DOM-vrij): is deze node een focusbare kandidaat voor de
   * tab-volgorde? Werkt op echte elementen én op fake-nodes met
   * nodeType/tagName/disabled/getAttribute. Een <a> telt alleen mee met een
   * href; een element met expliciete tabindex >= 0 telt ook mee; tabindex "-1"
   * of disabled valt er juist buiten (wel programmatisch focusbaar, niet via Tab).
   */
  function isFocusableCandidate(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.disabled === true) return false;
    var tag = String(node.tagName || '').toUpperCase();
    var hasGetAttr = (typeof node.getAttribute === 'function');
    var ti = hasGetAttr ? node.getAttribute('tabindex') : null;
    // Een expliciete negatieve tabindex haalt elk element uit de tab-volgorde,
    // óók een van nature focusbaar element (bv. <button tabindex="-1">): wel
    // programmatisch focusbaar, niet via Tab. Daarom vóór de tag-checks.
    if (ti != null && String(ti).charAt(0) === '-') return false;
    if (tag === 'A') {
      return hasGetAttr ? (node.getAttribute('href') != null) : false;
    }
    if (FOCUSABLE_TAGS[tag]) return true;
    if (ti != null && ti !== '') return true;  // expliciete tabindex >= 0 op niet-native tag
    return false;
  }

  /**
   * Pure filter (DOM-vrij): geef uit een array-like van nodes (bv. een NodeList)
   * de focusbare elementen terug in dezelfde volgorde (= DOM-volgorde = tab-orde).
   */
  function getFocusableOrder(nodes) {
    var out = [];
    if (!nodes) return out;
    var len = nodes.length || 0;
    for (var i = 0; i < len; i++) {
      if (isFocusableCandidate(nodes[i])) out.push(nodes[i]);
    }
    return out;
  }

  /**
   * Pure wrap-rekenwerk voor de focus-trap. Geeft de index van het volgende te
   * focussen element, gegeven de huidige index (current), het aantal focusbare
   * elementen (len) en of Shift ingedrukt is (shift = achteruit).
   *   - vooruit vanaf het laatste element -> 0 (wrap naar eerste)
   *   - achteruit vanaf het eerste element -> len-1 (wrap naar laatste)
   *   - current === -1 (focus staat buiten de trap): vooruit -> 0, achteruit ->
   *     len-1 (haalt de focus zo de trap in)
   *   - len < 1 -> -1 (niets te focussen)
   */
  function nextFocusIndex(current, len, shift) {
    if (!len || len < 1) return -1;
    if (shift) {
      return (current <= 0) ? (len - 1) : (current - 1);
    }
    if (current < 0 || current >= len - 1) return 0;
    return current + 1;
  }

  /**
   * Pure selectie (DOM-vrij) voor A5 (achtergrond inert): geef uit een array-like
   * van body-children de element-nodes terug die aria-hidden moeten krijgen: alle
   * elementen behalve skipNode (de overlay) en behalve nodes die AL een
   * aria-hidden-attribuut hebben (die laten we ongemoeid, zodat we ze bij het
   * sluiten niet per ongeluk verwijderen). Testbaar met fake-nodes.
   */
  function collectInertTargets(children, skipNode) {
    var out = [];
    if (!children) return out;
    var len = children.length || 0;
    for (var i = 0; i < len; i++) {
      var n = children[i];
      if (!n || n.nodeType !== 1) continue;
      if (n === skipNode) continue;
      if (typeof n.getAttribute === 'function' && n.getAttribute('aria-hidden') != null) continue;
      out.push(n);
    }
    return out;
  }

  function serializeConsent(record) {
    return encodeURIComponent(JSON.stringify(record));
  }

  function parseConsent(raw) {
    if (!raw) return null;
    try { return JSON.parse(decodeURIComponent(raw)); } catch (e) { return null; }
  }

  // ============================================================
  // BROWSER-LAAG (DOM + cookies + GTM) — alleen actief in de browser
  // ============================================================

  var _config = mergeConfig(DEFAULTS, {});
  // Actieve a11y-context zolang de banner open is (item 18): focus-trap-listener,
  // de door ons inert-gemaakte achtergrond-nodes en het terug-te-geven focus-doel.
  var _a11yState = null;

  function hasDocument() { return typeof document !== 'undefined' && !!document; }

  function currentPath() {
    return (typeof window !== 'undefined' && window.location && window.location.pathname) || '';
  }

  function isHttps() {
    return typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';
  }

  function getTranslations() {
    // Expliciete config.locale wint; anders het bestaande pad-gedreven
    // taalmechanisme (languagePaths + defaultLanguage). In beide gevallen
    // lost resolveTexts de daadwerkelijke strings op (incl. texts-override).
    if (_config.locale != null) return resolveTexts(_config);
    return resolveTexts(_config, detectLanguage(currentPath(), _config));
  }

  /** Saniteer de cookienaam (geen ; = spaties) zodat een tenant-config de
   *  cookie-header niet kan corrumperen. */
  function cookieName() {
    return String(_config.consentCookieName || 'cc_consent').replace(/[^A-Za-z0-9_-]/g, '') || 'cc_consent';
  }

  function readConsentCookie() {
    if (!hasDocument()) return null;
    var name = cookieName() + '=';
    var cookies = document.cookie.split(';');
    for (var i = 0; i < cookies.length; i++) {
      var c = cookies[i].trim();
      if (c.indexOf(name) === 0) return parseConsent(c.substring(name.length));
    }
    return null;
  }

  function writeConsentCookie(record) {
    if (!hasDocument()) return;
    var d = new Date();
    d.setTime(d.getTime() + (_config.consentCookieDays * 864e5));
    // Secure alleen op https — anders dropt de browser de cookie stil (localhost/dev)
    var secure = isHttps() ? ';Secure' : '';
    document.cookie = cookieName() + '=' + serializeConsent(record) +
      ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax' + secure;
  }

  function pushDataLayer(record) {
    if (typeof window === 'undefined') return;
    window.dataLayer = window.dataLayer || [];
    // instrumentatie: meetbaar event (no feature without its metric)
    window.dataLayer.push({
      event: 'cookie_consent_update',
      cookie_consent_analytics: record.analytics,
      cookie_consent_marketing: record.marketing,
      cookie_consent_version: record.version
    });
  }

  /**
   * Zorg dat window.dataLayer en de gtag-stub bestaan (het officiele Google
   * Consent Mode patroon: gtag pusht arguments naar de dataLayer). Zo komt
   * elke consent-call gegarandeerd in de dataLayer terecht, ook als GTM/gtag.js
   * (nog) niet geladen is of de klant GTM zelf laadt (autoLoadGTM: false).
   * Geeft de gtag-functie terug, of null buiten een browser-context.
   *
   * TRUST-BOUNDARY (security-doc): window.gtag en window.dataLayer zijn per
   * Consent Mode-contract GEDEELDE globals; GTM/gtag.js en andere legitieme
   * scripts lezen en schrijven ze ook. Wij hergebruiken een bestaande
   * window.gtag bewust in plaats van hem te overschrijven. Een vijandig
   * script dat al op de pagina draait kan deze globals sowieso manipuleren;
   * dat valt buiten ons dreigingsmodel (same-origin scripts zijn vertrouwd).
   */
  function ensureGtag() {
    if (typeof window === 'undefined') return null;
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== 'function') {
      window.gtag = function () { window.dataLayer.push(arguments); };
    }
    return window.gtag;
  }

  function applyConsent(record) {
    // Consent Mode v2 update bij ELKE consent-beslissing EN bij replay van
    // bestaand consent op page-load. Via ensureGtag altijd de dataLayer in,
    // ook als GTM door de klant zelf (later) geladen wordt.
    var gtag = ensureGtag();
    if (gtag) {
      var signals = buildConsentModeSignals(record);
      // personalization_storage is geen v2-kernsignaal maar bestond al in dit
      // update-pad; behouden voor backwards compat (volgt marketing).
      signals.personalization_storage = record.marketing ? 'granted' : 'denied';
      gtag('consent', 'update', signals);
    }
    pushDataLayer(record);
    if (record.marketing) loadMarketingPixels();
    if (typeof _config.onConsent === 'function') {
      try { _config.onConsent(record); } catch (e) { /* tenant-callback mag de flow niet breken */ }
    }
  }

  function loadMarketingPixels() {
    if (!hasDocument()) return;
    (_config.marketingPixels || []).forEach(function (pixel) {
      var src = pixel.src || pixel;
      if (!isSafePixelSrc(src)) {  // alleen https-bronnen; weert javascript:/data:/relatief/undefined
        if (typeof console !== 'undefined') console.warn('[CookieConsent] onveilige pixel-src genegeerd:', src);
        return;
      }
      if (document.querySelector('script[src="' + src + '"]')) return;
      var s = document.createElement('script');
      s.src = src; s.async = true;
      if (typeof pixel.onLoad === 'function') s.onload = pixel.onLoad;
      document.head.appendChild(s);
    });
  }

  /**
   * Stuur de gestandaardiseerde audit-payload naar config.consentLogUrl als die
   * gezet en veilig is (server-side bewijs van consent, GDPR Art. 7).
   *
   * Validatie: de URL loopt door isSafeUrl (alleen relatief /... of https://);
   * een onveilige/relatief-niet-toegestane waarde wordt genegeerd met een
   * console.warn, exact zoals loadMarketingPixels dat doet voor onveilige
   * pixel-srcs. Nooit naar http://, javascript:, data:, etc.
   *
   * Verzendmechanisme: bij voorkeur navigator.sendBeacon met een Blob
   * (type application/json); fallback op fetch met keepalive zodat de request
   * de pagina-unload overleeft. Bestaat geen van beide -> stil no-op.
   *
   * Defensief: de hele verzending zit in try/catch zodat een audit-fout NOOIT
   * de consent-flow breekt (zelfde houding als de tenant onConsent-callback).
   *
   * Waarom hier (saveAndClose) en niet in applyConsent: dit vertegenwoordigt een
   * NIEUWE consent-beslissing. applyConsent draait ook bij elke page-load voor
   * reeds opgeslagen consent; daar loggen zou dubbele audit-records per pageview
   * opleveren. Eén beacon per opgeslagen beslissing volstaat (geen dedup-cookie).
   */
  function logConsent(record) {
    var url = _config.consentLogUrl;
    if (!url) return;  // standaard uit
    if (!isSafeUrl(url)) {  // alleen relatief / https; weert javascript:/data:/http:/undefined
      if (typeof console !== 'undefined') console.warn('[CookieConsent] onveilige consentLogUrl genegeerd:', url);
      return;
    }
    var payload = buildConsentLogPayload(record);
    try {
      var body = JSON.stringify(payload);
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' &&
          typeof Blob !== 'undefined') {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      } else if (typeof fetch === 'function') {
        fetch(url, {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: body,
          credentials: 'omit'
        }).catch(function () { /* netwerk-fout in audit-beacon mag de flow niet breken */ });
      }
      // geen van beide beschikbaar -> stil no-op
    } catch (e) { /* audit-fout mag de consent-flow nooit breken */ }
  }

  function saveAndClose(choice) {
    var record = buildConsentRecord(choice, _config, new Date().toISOString());
    writeConsentCookie(record);
    applyConsent(record);
    logConsent(record);  // audit-beacon: alleen bij een verse beslissing, niet bij page-load replay
    var overlay = hasDocument() && document.getElementById('cc-overlay');
    if (overlay) {
      overlay.classList.add('cc-hiding');
      // Herstel focus + achtergrond-inert exact wanneer de overlay verdwijnt (A3/A5).
      setTimeout(function () { overlay.remove(); teardownA11y(); }, 300);
    } else {
      teardownA11y();  // vangnet: geen overlay in de DOM, toch netjes opruimen
    }
  }

  /** Kleine element-helper: zet tekst via textContent (geen HTML-injectie). */
  function el(tag, opts) {
    var node = document.createElement(tag);
    if (opts) {
      if (opts.id) node.id = opts.id;
      if (opts.cls) node.className = opts.cls;
      if (opts.text != null) node.textContent = opts.text;  // escapet automatisch
    }
    return node;
  }

  /**
   * Injecteer de gebundelde scoped CSS via een <style id="cc-styles">.
   * Idempotent: als de style-tag al bestaat doet dit niets (één <style>).
   * CSS wordt via .textContent gezet (nooit innerHTML) en uit gevalideerde
   * theme-kleuren opgebouwd, dus geen CSS-injectie.
   */
  function injectStyles() {
    if (!hasDocument()) return;
    if (document.getElementById('cc-styles')) return;  // idempotent
    var style = document.createElement('style');
    style.id = 'cc-styles';
    style.textContent = buildStyleCss(_config.theme);
    var parent = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
    parent.appendChild(style);
  }

  /**
   * Is deze node (voor focus-doeleinden) verborgen? Kijkt naar inline
   * style.display/visibility en het [hidden]-attribuut. De customize-toggle
   * verbergt het categorie-paneel + de save-knop juist via inline display:none,
   * dus zo blijft de focus-trap beperkt tot de zichtbare controls. Werkt op de
   * echte DOM én op de test-DOM-stub (beide exposen .style / .getAttribute).
   */
  function isHiddenForFocus(node) {
    var st = node.style;
    if (st && (st.display === 'none' || st.visibility === 'hidden')) return true;
    if (typeof node.getAttribute === 'function' && node.getAttribute('hidden') != null) return true;
    return false;
  }

  /** Loop de .children-boom af en verzamel zichtbare element-nodes in DOM-volgorde
   *  (verborgen subtrees worden overgeslagen). Werkt op DOM en test-stub. */
  function gatherVisibleElements(node, out) {
    var kids = node.children || [];
    var len = kids.length || 0;
    for (var i = 0; i < len; i++) {
      var c = kids[i];
      if (!c || c.nodeType !== 1) continue;
      if (isHiddenForFocus(c)) continue;  // hele subtree overslaan
      out.push(c);
      gatherVisibleElements(c, out);
    }
    return out;
  }

  /** De zichtbare focusbare elementen binnen root, in tab-volgorde (pure filter
   *  op de DOM-tree-walk). */
  function visibleFocusables(root) {
    return getFocusableOrder(gatherVisibleElements(root, []));
  }

  function indexOfNode(list, node) {
    for (var i = 0; i < list.length; i++) { if (list[i] === node) return i; }
    return -1;
  }

  /**
   * Sluit de a11y-context van de open banner (item 18, A3/A5): herstel
   * aria-hidden op de achtergrond-nodes die WIJ zetten, verwijder de
   * keydown-focus-trap en geef de focus terug aan het element dat hem had
   * vóór het openen. Idempotent (tweede aanroep is een no-op).
   */
  function teardownA11y() {
    var s = _a11yState;
    if (!s) return;
    _a11yState = null;
    for (var i = 0; i < s.inerted.length; i++) {
      var n = s.inerted[i];
      if (n && typeof n.removeAttribute === 'function') n.removeAttribute('aria-hidden');
    }
    if (s.overlay && s.onKeydown && typeof s.overlay.removeEventListener === 'function') {
      s.overlay.removeEventListener('keydown', s.onKeydown);
    }
    if (s.returnTo && typeof s.returnTo.focus === 'function') {
      try { s.returnTo.focus(); } catch (e) { /* focus-herstel mag de sluit-flow nooit breken */ }
    }
  }

  function renderBanner() {
    if (!hasDocument()) return;
    // Defensief: een eventuele achtergebleven a11y-context eerst netjes afsluiten
    // (herstelt aria-hidden op oude achtergrond-nodes) zodat een toekomstige
    // refactor die de #cc-overlay-guard hieronder loslaat geen inert-state lekt.
    if (_a11yState) teardownA11y();
    injectStyles();  // styling aanwezig voordat de banner verschijnt
    if (document.getElementById('cc-overlay')) return;  // geen dubbele banner
    var t = getTranslations();

    // A3: onthoud waar de focus stond zodat we hem bij sluiten kunnen teruggeven
    // (m.n. voor de "manage"-heropen-link). Vastgelegd vóór we de focus verplaatsen.
    var previouslyFocused = document.activeElement || null;

    var overlay = el('div', { id: 'cc-overlay' });
    var banner = el('div', { id: 'cc-banner' });
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-modal', 'true');
    banner.setAttribute('aria-label', t.title);
    banner.setAttribute('tabindex', '-1');  // A1-fallback: container programmatisch focusbaar

    var inner = el('div', { cls: 'cc-inner' });
    inner.appendChild(el('h2', { text: t.title }));
    inner.appendChild(el('p', { text: t.description }));

    // Hoofd-actieknoppen: Reject / Customize / Accept (gelijke prominentie, GDPR)
    var actions = el('div', { cls: 'cc-actions' });
    var rejectBtn = el('button', { id: 'cc-reject', text: t.rejectAll });
    var customizeBtn = el('button', { id: 'cc-customize', text: t.customize });
    var acceptBtn = el('button', { id: 'cc-accept', text: t.acceptAll });
    actions.appendChild(rejectBtn);
    actions.appendChild(customizeBtn);
    actions.appendChild(acceptBtn);
    inner.appendChild(actions);

    // Per-categorie paneel (toggles), verborgen tot de gebruiker op Customize klikt.
    var stored = readConsentCookie();
    var model = buildCategoryModel(_config, t, stored);
    var categoriesWrap = el('div', { cls: 'cc-categories' });
    categoriesWrap.style.display = 'none';
    var checkboxes = {};   // key -> checkbox-node, voor uitlezen bij opslaan
    for (var ci = 0; ci < model.length; ci++) {
      var row = model[ci];
      var rowEl = el('div', { cls: 'cc-category' });

      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = row.checked;             // state via property, geen HTML-string
      box.disabled = row.required;           // necessary kan niet uit
      box.setAttribute('data-cc-category', row.key);
      box.setAttribute('aria-label', row.label);

      var bodyEl = el('div', { cls: 'cc-category-body' });
      bodyEl.appendChild(el('span', { cls: 'cc-category-label', text: row.label }));
      if (row.description) {
        bodyEl.appendChild(el('p', { cls: 'cc-category-desc', text: row.description }));
      }

      rowEl.appendChild(box);
      rowEl.appendChild(bodyEl);
      categoriesWrap.appendChild(rowEl);
      checkboxes[row.key] = box;
    }
    inner.appendChild(categoriesWrap);

    // Save-knop: alleen zichtbaar in customize-modus.
    var saveActions = el('div', { cls: 'cc-actions' });
    saveActions.style.display = 'none';
    var saveBtn = el('button', { id: 'cc-save', text: t.savePreferences });
    saveActions.appendChild(saveBtn);
    inner.appendChild(saveActions);

    var footer = el('div', { cls: 'cc-footer' });
    var link = el('a', { text: t.privacyLink });
    link.setAttribute('href', isSafeUrl(_config.privacyUrl) ? _config.privacyUrl : '#');
    footer.appendChild(link);
    inner.appendChild(footer);

    banner.appendChild(inner);
    overlay.appendChild(banner);
    document.body.appendChild(overlay);

    // A5: maak de overige directe body-children inert voor assistive tech.
    // We onthouden exact welke nodes we zetten, zodat we ze bij sluiten precies
    // terugdraaien zonder reeds bestaande aria-hidden aan te raken.
    var inerted = [];
    if (document.body) {
      var inertTargets = collectInertTargets(document.body.children || [], overlay);
      for (var ii = 0; ii < inertTargets.length; ii++) {
        if (typeof inertTargets[ii].setAttribute === 'function') {
          inertTargets[ii].setAttribute('aria-hidden', 'true');
          inerted.push(inertTargets[ii]);
        }
      }
    }

    // A2: focus-trap op de overlay. Tab/Shift+Tab wrapt over de zichtbare
    // focusbare elementen binnen de banner (aria-modal wordt zo echt modaal).
    function onOverlayKeydown(e) {
      var isTab = !!(e && (e.key === 'Tab' || e.keyCode === 9));
      if (!isTab) return;
      var focusables = visibleFocusables(overlay);
      if (!focusables.length) return;
      var active = (typeof document !== 'undefined' && document.activeElement) || null;
      var nextIdx = nextFocusIndex(indexOfNode(focusables, active), focusables.length, !!e.shiftKey);
      if (nextIdx < 0) return;
      if (typeof e.preventDefault === 'function') e.preventDefault();
      var target = focusables[nextIdx];
      if (target && typeof target.focus === 'function') target.focus();
    }
    if (typeof overlay.addEventListener === 'function') {
      overlay.addEventListener('keydown', onOverlayKeydown);
    }

    // Bewaar de a11y-context zodat het sluit-pad (saveAndClose) alles herstelt.
    _a11yState = { overlay: overlay, onKeydown: onOverlayKeydown, inerted: inerted, returnTo: previouslyFocused };

    // A1: verplaats de focus naar de eerste control (de reject-knop). Kan die
    // onverhoopt niet gefocust worden, val terug op de banner-container
    // (tabindex="-1") zodat de focus hoe dan ook binnen de dialog landt.
    if (typeof rejectBtn.focus === 'function') rejectBtn.focus();
    else if (typeof banner.focus === 'function') banner.focus();

    rejectBtn.addEventListener('click', function () { saveAndClose({ analytics: false, marketing: false }); });
    acceptBtn.addEventListener('click', function () { saveAndClose({ analytics: true, marketing: true }); });

    // Customize: toon het per-categorie paneel + save-knop, verberg de hoofdknoppen.
    customizeBtn.addEventListener('click', function () {
      actions.style.display = 'none';
      categoriesWrap.style.display = '';
      saveActions.style.display = '';
    });

    // Save: lees de checkbox-states uit en bewaar de per-categorie keuze.
    saveBtn.addEventListener('click', function () {
      var choice = {};
      for (var key in checkboxes) {
        if (!Object.prototype.hasOwnProperty.call(checkboxes, key)) continue;
        if (key === 'necessary') continue;   // necessary is impliciet altijd aan
        choice[key] = !!checkboxes[key].checked;
      }
      saveAndClose(choice);
    });
  }

  /** Zet Consent Mode v2 defaults op 'denied' VOORDAT GTM laadt (GDPR: geen tracking
   *  zonder consent; GA4 stuurt enkel cookieless pings tot consent gegeven is).
   *  Expliciet alle vier v2-kernsignalen (ad_storage, analytics_storage,
   *  ad_user_data, ad_personalization) plus de storage-nevensignalen. */
  function setConsentDefaults() {
    var gtag = ensureGtag();
    if (!gtag) return;
    gtag('consent', 'default', {
      ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
      analytics_storage: 'denied', functionality_storage: 'granted',
      personalization_storage: 'denied', security_storage: 'granted', wait_for_update: 500
    });
  }

  function loadGTM() {
    if (!hasDocument() || window.__ccGtmLoaded) return;
    if (!isValidGtmId(_config.gtmId)) {
      if (_config.gtmId && typeof console !== 'undefined') {
        console.warn('[CookieConsent] ongeldig gtmId genegeerd:', _config.gtmId);
      }
      return;
    }
    window.__ccGtmLoaded = true;
    (function (w, d, s, l, i) {
      w[l] = w[l] || []; w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
      var f = d.getElementsByTagName(s)[0], j = d.createElement(s);
      j.async = true; j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i;
      f.parentNode.insertBefore(j, f);
    })(window, document, 'script', 'dataLayer', _config.gtmId);
  }

  /**
   * QUICK-CONNECT GA4 (item 12, fix-ronde): laad gtag.js direct voor een
   * tenant die alleen een GA4 measurement-id heeft (geen GTM). Draait
   * uitsluitend NA setConsentDefaults, zodat de Consent Mode v2 defaults
   * (alles denied) al in de dataLayer staan voordat gtag.js ze consumeert.
   *
   * KEUZE GTM-WINT: heeft de tenant OOK een GTM-container die wij laden
   * (autoLoadGTM + geldig gtmId, zichtbaar aan window.__ccGtmLoaded), dan
   * laden we gtag.js hier NIET. GTM laadt de GA4-tag dan zelf via de
   * container-configuratie; gtag.js er los naast zou dubbele page_view-hits
   * en dubbele config-calls geven. Losse gtag.js is dus alleen het pad voor
   * "GA4 zonder GTM".
   *
   * Veiligheid: ga4Id is al streng gevalideerd (isValidGa4Id, anchored
   * alfanumeriek) maar gaat alsnog door encodeURIComponent voordat hij in de
   * script-URL belandt (defense in depth, nooit op EEN laag vertrouwen).
   * Idempotent via window.__ccGa4Loaded.
   */
  function loadGa4() {
    if (!hasDocument() || typeof window === 'undefined' || window.__ccGa4Loaded) return;
    if (!isValidGa4Id(_config.ga4Id)) {
      if (_config.ga4Id && typeof console !== 'undefined') {
        console.warn('[CookieConsent] ongeldig ga4Id genegeerd:', _config.ga4Id);
      }
      return;
    }
    if (window.__ccGtmLoaded) return;  // GTM wint: gtag.js niet dubbel laden
    window.__ccGa4Loaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(_config.ga4Id);
    var parent = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
    parent.appendChild(s);
    var gtag = ensureGtag();
    gtag('js', new Date());
    gtag('config', _config.ga4Id);
  }

  /** Render de banner nu, of zodra de DOM klaar is (bestaand gedrag). */
  function scheduleRenderBanner() {
    if (!hasDocument()) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderBanner);
    } else {
      renderBanner();
    }
  }

  /**
   * GEO-FLOW (item 8): vraag de tenant-eigen geoResolver om {inEU: bool} en
   * toon de banner alleen als shouldShowBanner dat zegt. Alleen aangeroepen
   * als config.geo === 'eu-only' EN er geen geldige consent is; bij
   * geo 'always'/ontbrekend wordt deze functie nooit bereikt (geen resolver-call).
   *
   * Er is bewust GEEN ingebouwde third-party geo-API-call: privacy en
   * dependency-vrij is de kernbelofte. De klant levert de resolver zelf aan.
   *
   * Resolver-contract (feature-detectie, beide stijlen netjes ondersteund):
   *   - callback-stijl:  geoResolver(function (result) { ... })
   *   - promise-stijl:   geoResolver() geeft een thenable terug; die consumeren
   *     we via .then. Het script maakt zelf NOOIT een Promise aan (ES5-compat:
   *     oude browsers zonder Promise crashen dus niet; de thenable is klant-code).
   * De eerste uitkomst wint (settled-guard): roept een resolver zowel de
   * callback aan ALS resolvet zijn thenable, dan telt alleen de eerste.
   *
   * FAIL-SAFE (consent-plicht > verbergen): geen resolver, resolver gooit,
   * thenable rejects, ongeldig resultaat OF geen antwoord binnen de timeout
   * -> banner tonen.
   *
   * TIMEOUT (fix-ronde na review): een resolver die nooit settelt (bv. een
   * hangende fetch die de callback nooit aanroept en geen settelende thenable
   * teruggeeft) mag de banner niet voor altijd verbergen. Daarom start er
   * VOOR de resolver-call een setTimeout (config.geoTimeout, default 3000ms,
   * gevalideerd via normalizeGeoTimeout) die settle(null) aanroept: de
   * fail-safe (tonen) wint dan alsnog. Settelt de resolver eerder, dan wordt
   * de timer via clearTimeout opgeruimd. setTimeout/clearTimeout zijn ES5.
   */
  function resolveGeoAndRender() {
    var resolver = _config.geoResolver;
    if (typeof resolver !== 'function') {
      // eu-only zonder resolver: fail-safe naar tonen
      if (typeof console !== 'undefined') {
        console.warn('[CookieConsent] geo "eu-only" zonder geoResolver; banner wordt getoond (fail-safe)');
      }
      scheduleRenderBanner();
      return;
    }
    var settled = false;
    var timer = null;
    function settle(result) {
      if (settled) return;
      settled = true;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (shouldShowBanner(result, _config)) scheduleRenderBanner();
    }
    if (typeof setTimeout === 'function') {
      var timeoutMs = normalizeGeoTimeout(_config.geoTimeout);
      timer = setTimeout(function () {
        if (settled) return;  // al beslist: niets meer te doen
        if (typeof console !== 'undefined') {
          console.warn('[CookieConsent] geoResolver antwoordde niet binnen ' + timeoutMs + 'ms; banner wordt getoond (fail-safe)');
        }
        settle(null);
      }, timeoutMs);
    }
    try {
      var ret = resolver(function (result) { settle(result); });
      if (ret && typeof ret.then === 'function') {
        // thenable van de klant consumeren; rejection -> fail-safe tonen
        ret.then(
          function (result) { settle(result); },
          function () { settle(null); }
        );
      }
      // geen thenable teruggegeven -> we wachten op de callback-aanroep
    } catch (e) {
      settle(null);  // resolver gooit synchroon -> fail-safe tonen
    }
  }

  // ============================================================
  // PUBLIEKE API
  // ============================================================
  function init(userConfig) {
    _config = mergeConfig(DEFAULTS, userConfig);
    // Consent Mode v2 defaults ALTIJD eerst zetten, losgekoppeld van
    // autoLoadGTM (fix-ronde): denied-by-default geldt ook als de klant
    // GTM/gtag.js zelf laadt. De defaults staan zo gegarandeerd in de
    // dataLayer voordat welke Google-tag dan ook consumeert.
    setConsentDefaults();
    if (_config.autoLoadGTM) loadGTM();
    loadGa4();  // GA4 zonder GTM (quick-connect); no-op als GTM al laadt
    if (!_config.enabled || !hasDocument()) return;

    // De "Beheer cookies"-heropen-link moet altijd werken, ook als de banner
    // deze keer niet getoond wordt (consent is al gegeven of geo verbergt hem).
    bindManageTriggers();

    var stored = readConsentCookie();
    if (needsReconsent(stored, _config.consentVersion, _config.categories)) {
      // Geo bepaalt ALLEEN of de banner verschijnt bij ontbrekende consent.
      if (_config.geo === 'eu-only') {
        resolveGeoAndRender();
      } else {
        scheduleRenderBanner();  // 'always' / ontbrekend: exact het oude gedrag
      }
    } else {
      // Replay van bestaand consent werkt ALTIJD, ongeacht geo-uitkomst.
      applyConsent(stored);
    }
  }

  /** Heropen de banner (bv. via een "Manage cookies"-link). */
  function show() {
    if (hasDocument() && !document.getElementById('cc-overlay')) renderBanner();
  }

  /**
   * Zet een gedelegeerde click-listener op document die bij een klik op (of in)
   * een element met data-cookie-consent="manage" de banner heropent via show().
   * Idempotent via window.__ccManageBound (één listener, ook bij meerdere
   * init-calls). Doet niets zonder document. Delegatie zorgt dat ook links die
   * NA init aan de DOM worden toegevoegd blijven werken.
   */
  function bindManageTriggers() {
    if (!hasDocument()) return;
    if (typeof window !== 'undefined' && window.__ccManageBound) return;
    if (typeof window !== 'undefined') window.__ccManageBound = true;
    document.addEventListener('click', function (e) {
      if (isManageTrigger(e.target)) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        show();
      }
    });
  }

  function getConsent() { return readConsentCookie(); }

  return {
    version: VERSION,
    init: init,
    show: show,
    getConsent: getConsent,
    // intern blootgesteld voor tests (DOM-vrije pure logica)
    _internals: {
      mergeConfig: mergeConfig,
      detectLanguage: detectLanguage,
      resolveTexts: resolveTexts,
      I18N: I18N,
      needsReconsent: needsReconsent,
      shouldShowBanner: shouldShowBanner,
      normalizeGeoTimeout: normalizeGeoTimeout,
      genConsentId: genConsentId,
      buildConsentModeSignals: buildConsentModeSignals,
      buildConsentRecord: buildConsentRecord,
      buildConsentLogPayload: buildConsentLogPayload,
      buildCategoryModel: buildCategoryModel,
      getFocusableOrder: getFocusableOrder,
      isFocusableCandidate: isFocusableCandidate,
      nextFocusIndex: nextFocusIndex,
      collectInertTargets: collectInertTargets,
      serializeConsent: serializeConsent,
      parseConsent: parseConsent,
      isManageTrigger: isManageTrigger,
      isSafeUrl: isSafeUrl,
      isValidGtmId: isValidGtmId,
      isValidGa4Id: isValidGa4Id,
      isSafePixelSrc: isSafePixelSrc,
      isSafeColor: isSafeColor,
      buildStyleCss: buildStyleCss,
      DEFAULTS: DEFAULTS
    }
  };
});
