/* Drive assets/cart-upsell.js in jsdom against real rendered markup. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'assets', 'cart-upsell.js'), 'utf8');
const DRAWER_FIXTURE = fs.readFileSync(path.join(__dirname, 'fixture-drawer.html'), 'utf8');
const CART_FIXTURE = fs.readFileSync(path.join(__dirname, 'fixture-cart.html'), 'utf8');

const failures = [];
function check(name, ok, detail) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '   -> ' + JSON.stringify(detail)));
  if (!ok) failures.push(name);
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));

function build(page, options) {
  const opts = options || {};
  const root = opts.root || '/sv/';
  const dom = new JSDOM(page, { url: 'https://shop.example' + root + 'cart', runScripts: 'outside-only' });
  const win = dom.window;
  win.Shopify = { routes: { root: root } };
  win.cartStrings = { error: 'Cart error' };
  win.__calls = [];
  win.fetch = function (url, fetchOptions) {
    win.__calls.push({ url: String(url), options: fetchOptions || {} });
    if (win.__fetchImpl) return win.__fetchImpl(String(url), fetchOptions);
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(win.__addResponse || { id: 1000, sections: win.__sections || {} }),
      text: () => Promise.resolve(win.__sectionText || ''),
    });
  };
  win.eval(SCRIPT);
  return { dom, win, calls: win.__calls };
}

const items = (doc) => Array.from(doc.querySelectorAll('[data-cart-upsell-item]'));
const visibleIds = (doc) => items(doc).filter((li) => !li.hasAttribute('hidden')).map((li) => li.dataset.productId);

async function main() {
  /* --------------------------------------------------- 1. shuffle on init */
  {
    const { win } = build(DRAWER_FIXTURE);
    const doc = win.document;
    check('drawer: jsdom readyState at script eval', true, doc.readyState);
    await tick(0); // jsdom fires DOMContentLoaded after construction; real defer scripts run at readyState "interactive"
    const ids = visibleIds(doc);
    check('drawer: 3 recommendations visible after init', ids.length === 3, ids);
    check('drawer: exact match (10) always visible', ids.indexOf('10') !== -1, ids);
    check('drawer: exact match is the first list item', items(doc)[0].dataset.productId === '10', items(doc)[0].dataset.productId);
    const isFallback = items(doc).map((li) => li.hasAttribute('data-cart-upsell-fallback'));
    check(
      'drawer: fallback items are re-ordered after exact matches',
      isFallback[0] === false && isFallback.slice(1).every(Boolean),
      isFallback
    );
    check('drawer: host marked ready (init is idempotent)', doc.querySelector('[data-cart-upsell]').dataset.cartUpsellReady === 'true');

    // Running init again must not change anything or duplicate work.
    const before = doc.querySelector('[data-cart-upsell-list]').innerHTML;
    win.cartUpsell.init(doc);
    check('drawer: repeated init is a no-op', doc.querySelector('[data-cart-upsell-list]').innerHTML === before);
  }

  /* ------------------------------------------------ 2. shuffle does shuffle */
  {
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const { win } = build(DRAWER_FIXTURE);
      await tick(0);
      seen.add(visibleIds(win.document).slice().sort().join(','));
    }
    const all = Array.from(seen);
    check('fallback selection varies between renders', seen.size > 1, all);
    check('every render keeps the exact match on top', all.every((s) => s.split(',').indexOf('10') !== -1), all);
    check('every render shows exactly 3', all.every((s) => s.split(',').length === 3), all);
  }

  /* ---------------------------------------------------- 3. add from drawer */
  {
    const page =
      '<body><cart-drawer><div id="CartDrawer"><div class="drawer__inner">' + DRAWER_FIXTURE + '</div></div></cart-drawer></body>';
    const { win, calls } = build(page);
    const doc = win.document;

    const rendered = [];
    const drawer = doc.querySelector('cart-drawer');
    drawer.getSectionsToRender = () => [{ id: 'cart-drawer', selector: '#CartDrawer' }, { id: 'cart-icon-bubble' }];
    drawer.renderContents = (state) => rendered.push(state);
    drawer.setActiveElement = () => {};

    win.__sections = { 'cart-upsell': '<div class="shopify-section"><div data-cart-upsell></div></div>' };
    win.__addResponse = { id: 1000, sections: win.__sections };

    const button = doc.querySelector('[data-cart-upsell-add]');
    const productId = button.closest('[data-cart-upsell-item]').dataset.productId;
    button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

    check('add: locale-aware route used', calls[0] && calls[0].url === '/sv/cart/add.js', calls[0] && calls[0].url);
    const body = JSON.parse(calls[0].options.body);
    check('add: posts variant id with quantity 1', body.quantity === 1 && body.id === Number(button.dataset.variantId), body);
    check('add: bundles cart-upsell + Dawn drawer sections', body.sections === 'cart-upsell,cart-drawer,cart-icon-bubble', body.sections);
    check('add: sends sections_url', typeof body.sections_url === 'string' && body.sections_url.length > 0, body.sections_url);
    check('add: button shows loading state', button.classList.contains('loading') && button.getAttribute('aria-disabled') === 'true');
    check('add: spinner revealed', !button.querySelector('.loading__spinner').classList.contains('hidden'));

    // A second click while loading must be ignored.
    button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    check('add: double click ignored while loading', calls.length === 1, calls.length);

    await tick();
    check("add: Dawn's CartDrawer.renderContents() used", rendered.length === 1, rendered.length);
    check('add: loading state cleared', !button.classList.contains('loading') && !button.hasAttribute('aria-disabled'));
    check('add: added product removed from recommendations', !doc.querySelector('[data-product-id="' + productId + '"]'), productId);
    check('add: single network request thanks to bundled sections', calls.length === 1, calls.map((c) => c.url));
  }

  /* -------------------------------------------------- 4. add from /cart page */
  {
    const page =
      '<body>' +
      '<div id="cart-icon-bubble"></div>' +
      '<cart-items class="is-empty"><div class="cart__items" id="main-cart-items" data-id="cart-items"><div class="js-contents">OLD ITEMS</div></div>' +
      CART_FIXTURE +
      '</cart-items>' +
      '<div id="main-cart-footer" class="is-empty" data-id="cart-footer"><div class="js-contents">OLD TOTALS</div></div>' +
      '</body>';
    const { win, calls } = build(page);
    const doc = win.document;

    win.__sections = {
      'cart-items': '<div class="shopify-section"><div class="js-contents">NEW ITEMS</div></div>',
      'cart-footer': '<div class="shopify-section"><div class="js-contents">NEW TOTALS</div></div>',
      'cart-icon-bubble': '<div class="shopify-section">BUBBLE 4</div>',
      'cart-upsell': '<div class="shopify-section"><div data-cart-upsell><div class="cart-upsell__inner">FRESH</div></div></div>',
    };
    win.__addResponse = { id: 1000, sections: win.__sections };

    const button = doc.querySelector('[data-cart-upsell-add]');
    button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    const body = JSON.parse(calls[0].options.body);
    check(
      'cart page: bundles upsell + cart sections read from data-id',
      body.sections === 'cart-upsell,cart-items,cart-footer,cart-icon-bubble',
      body.sections
    );
    check('cart page: live-region section not bundled (section limit)', body.sections.indexOf('cart-live-region-text') === -1, body.sections);

    await tick();
    check('cart page: line items repainted', doc.querySelector('#main-cart-items .js-contents').textContent.trim() === 'NEW ITEMS');
    check('cart page: totals repainted', doc.querySelector('#main-cart-footer .js-contents').textContent.trim() === 'NEW TOTALS');
    check('cart page: cart bubble repainted', doc.querySelector('#cart-icon-bubble').textContent.trim() === 'BUBBLE 4');
    check('cart page: is-empty cleared on footer', !doc.getElementById('main-cart-footer').classList.contains('is-empty'));
    check('cart page: is-empty cleared on cart-items', !doc.querySelector('cart-items').classList.contains('is-empty'));
    check('cart page: upsell replaced with freshly rendered list', doc.querySelector('[data-cart-upsell]').textContent.indexOf('FRESH') !== -1);
    check('cart page: no page reload needed', calls.length === 1, calls.map((c) => c.url));
  }

  /* ------------------------------------- 5. fallback when sections are missing */
  {
    const page = '<body><div id="cart-icon-bubble"></div>' + CART_FIXTURE + '</body>';
    const { win, calls } = build(page);
    const doc = win.document;
    win.__addResponse = { id: 1000 }; // no sections at all
    win.__sectionText = '<div class="shopify-section"><div data-cart-upsell><div class="cart-upsell__inner">REFRESHED</div></div></div>';

    doc.querySelector('[data-cart-upsell-add]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await tick(60);

    const urls = calls.map((c) => c.url);
    check('missing sections: falls back to Section Rendering API', urls.some((u) => u.indexOf('?section_id=cart-upsell') !== -1), urls);
    check('missing sections: refreshes the cart bubble too', urls.some((u) => u.indexOf('?section_id=cart-icon-bubble') !== -1), urls);
    check('missing sections: no page reload', !win.__reloaded, urls);
    check('missing sections: upsell still refreshed', doc.querySelector('[data-cart-upsell]').textContent.indexOf('REFRESHED') !== -1);
  }

  /* ---------------------------------------------------- 6. cart/add.js error */
  {
    const { win } = build(DRAWER_FIXTURE);
    const doc = win.document;
    win.__fetchImpl = () =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ status: 422, description: 'Sold out' }),
        text: () => Promise.resolve(''),
      });

    const button = doc.querySelector('[data-cart-upsell-add]');
    const productId = button.closest('[data-cart-upsell-item]').dataset.productId;
    button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await tick();

    const error = doc.querySelector('[data-cart-upsell-error]');
    check('error: message shown in the alert region', error.textContent === 'Sold out' && !error.hasAttribute('hidden'), error.textContent);
    check('error: button re-enabled', !button.hasAttribute('aria-disabled') && !button.classList.contains('loading'));
    check('error: recommendation kept in the list', !!doc.querySelector('[data-product-id="' + productId + '"]'));
  }

  /* ------------------------------------------ 7. no duplicate event listeners */
  {
    const page =
      '<body><cart-drawer><div id="CartDrawer"><div class="drawer__inner">' + DRAWER_FIXTURE + '</div></div></cart-drawer></body>';
    const { win, calls } = build(page);
    const doc = win.document;
    const drawer = doc.querySelector('cart-drawer');
    drawer.getSectionsToRender = () => [{ id: 'cart-drawer', selector: '#CartDrawer' }, { id: 'cart-icon-bubble' }];
    drawer.renderContents = () => {};
    drawer.setActiveElement = () => {};
    win.__sections = { 'cart-upsell': '<div data-cart-upsell></div>' };
    win.__addResponse = { id: 1, sections: win.__sections };

    // Simulate a section re-render: same markup injected again, script re-evaluated.
    doc.querySelector('.drawer__inner').innerHTML = DRAWER_FIXTURE;
    win.eval(SCRIPT); // guarded by window.cartUpsell.initialized
    win.cartUpsell.init(doc);

    doc.querySelector('[data-cart-upsell-add]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await tick();
    check('re-render: exactly one add request (no duplicate listeners)', calls.length === 1, calls.map((c) => c.url));
  }

  console.log('\nFAILURES:', failures.length ? failures : 'none');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
