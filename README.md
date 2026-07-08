# PlainConsent

The cookie banner with nothing to hide. One small script that asks politely,
remembers the answer, and can prove it (GDPR Article 7 audit records).

Website: https://plainconsent.com

## Embed (versioned, with SRI)

```html
<script src="https://plainconsent.com/dist/cookie-consent.v1.0.0.js"
        integrity="sha384-raaFmUz9nCZmnLPN7C1GLqkTPyqD9cxcz3pozjvS8y/K/nP+oK8C7BI9+jJDWiNX"
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
