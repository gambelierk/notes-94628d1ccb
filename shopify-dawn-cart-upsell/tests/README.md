# Verification harness

These tests are development aids — they are **not** part of the theme and should not
be uploaded to Shopify. They exist so the selection rules and the add-to-cart flow can
be verified without a store.

## Liquid selection logic — `liquid_logic_test.py`

Renders `snippets/cart-upsell.liquid` with a real Liquid engine (Shopify-specific
filters such as `money`, `image_url`, `image_tag` are stubbed) and asserts every rule
from the spec: the Björne/Fäbodjäntan example, exclusion by product ID (never by
title), `Björne` ≠ `Björne Patch`, availability filtering, limits, random-fallback
on/off, escaping, and the hidden-when-empty behaviour.

```bash
pip install python-liquid
python3 tests/liquid_logic_test.py
```

It also writes `tests/fixture-drawer.html` and `tests/fixture-cart.html`, which the
JavaScript test consumes.

Note: on Shopify `nil == blank`; python-liquid disagrees, so one assertion is written
against the weaker guarantee (an empty, invisible host instead of no output at all).

## JavaScript behaviour — `js_behaviour_test.js`

Runs `assets/cart-upsell.js` in jsdom against the rendered fixtures and asserts:
the client-side shuffle (exact matches stay on top, filler varies), the locale-aware
`/{root}cart/add.js` POST, the bundled section list for the drawer and for the cart
page, Dawn's `renderContents()` being used in the drawer, cart-page section swapping,
loading/disabled state, error handling, the Section-Rendering fallback when bundled
sections are missing, and that re-running the script cannot create duplicate
listeners.

```bash
npm install jsdom
python3 tests/liquid_logic_test.py   # generates the fixtures first
node tests/js_behaviour_test.js
```

## Theme check

The theme files were also linted with `@shopify/theme-check-node` inside a Dawn
16.0.0 checkout with all four placements applied: zero new offences compared to the
unmodified Dawn baseline.
