# PlainConsent

GDPR-proof cookie consent, at the lowest price. One small script: consent with a
real audit trail (GDPR Article 7), five languages, styled to match your brand,
live in minutes on any CMS. Flat price per site, with a lowest-price guarantee.

Website: https://plainconsent.com

## Embed (versioned, with SRI)

```html
<script src="https://plainconsent.com/dist/cookie-consent.v1.1.0.js"
        integrity="sha384-irwxZlM0ttEvMHb7xlIbUzU5Y/f+vFkpRE4CqSBetpOFWeldbnHQSriGfrZHrBoX"
        crossorigin="anonymous"></script>
<script>CookieConsent.init({ /* your config, see plainconsent.com */ });</script>
```

The versioned file is immutable; `dist/manifest.json` lists every release with
its integrity hash. `dist/cookie-consent.latest.js` always tracks the newest
release and is intentionally served without an integrity pairing (SRI pins
bytes; latest moves).

## License

See LICENSE.md. The source is published for transparency and integrity
verification of the served files.
