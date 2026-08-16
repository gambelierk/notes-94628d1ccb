/*
  Cart upsell — vanilla JS, no dependencies.

  Responsibilities:
    - Shuffle the random fallback recommendations client side so the filler
      products vary between cart renders (exact title matches always stay on
      top; they are ordered by CSS `order` and by DOM position).
    - Add a recommendation to the cart through the Ajax Cart API without
      leaving the page, using Shopify's locale-aware root route.
    - Re-render Dawn's cart UI (drawer or cart page), the cart bubble and the
      upsell list itself using bundled section rendering, with a fetch-based
      fallback and a full reload as the last resort.

  Event handling uses a single delegated listener on `document`, so re-rendered
  cart sections can never produce duplicate listeners.
*/

(function () {
  'use strict';

  if (window.cartUpsell && window.cartUpsell.initialized) return;

  var UPSELL_SECTION_ID = 'cart-upsell';

  var SELECTORS = {
    host: '[data-cart-upsell]',
    list: '[data-cart-upsell-list]',
    item: '[data-cart-upsell-item]',
    fallbackItem: '[data-cart-upsell-fallback="true"]',
    addButton: '[data-cart-upsell-add]',
    error: '[data-cart-upsell-error]',
  };

  /* ------------------------------------------------------------------ utils */

  // Locale-aware shop root, e.g. "/" or "/en-gb/". Never hard-code /cart/add.js.
  function rootUrl() {
    var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
    return root.slice(-1) === '/' ? root : root + '/';
  }

  function cartAddUrl() {
    return rootUrl() + 'cart/add.js';
  }

  function sectionUrl(sectionId) {
    return rootUrl() + '?section_id=' + encodeURIComponent(sectionId);
  }

  function errorMessage() {
    return (window.cartStrings && window.cartStrings.error) || 'There was an error while updating your cart.';
  }

  function shuffle(array) {
    for (var i = array.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
    return array;
  }

  function parseHTML(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function getSectionInnerHTML(html, selector) {
    var element = parseHTML(html).querySelector(selector);
    if (!element) throw new Error('Missing "' + selector + '" in rendered section');
    return element.innerHTML;
  }

  /* ------------------------------------------------------- fallback shuffle */

  function setupHost(host) {
    if (!host || host.dataset.cartUpsellReady === 'true') return;

    var list = host.querySelector(SELECTORS.list);
    if (list) {
      var slots = parseInt(list.dataset.fallbackSlots || '0', 10);
      var fallbackItems = Array.prototype.slice.call(list.querySelectorAll(SELECTORS.fallbackItem));

      if (fallbackItems.length) {
        shuffle(fallbackItems);
        fallbackItems.forEach(function (item, index) {
          // Re-append in shuffled order so fallback items always follow the
          // exact matches, then reveal only as many as there are free slots.
          list.appendChild(item);
          if (index < slots) {
            item.removeAttribute('hidden');
          } else {
            item.setAttribute('hidden', '');
          }
        });
      }
    }

    host.dataset.cartUpsellReady = 'true';
  }

  function initAll(scope) {
    var root = scope || document;
    if (!root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll(SELECTORS.host), setupHost);
  }

  /* ------------------------------------------------------------ re-rendering */

  function applyUpsellHTML(html) {
    var source = html ? parseHTML(html).querySelector(SELECTORS.host) : null;
    var hosts = document.querySelectorAll(SELECTORS.host);

    Array.prototype.forEach.call(hosts, function (host) {
      // No source means the component has nothing to recommend any more —
      // emptying the host hides the whole component.
      host.innerHTML = source ? source.innerHTML : '';
      host.dataset.cartUpsellReady = 'false';
      setupHost(host);
    });
  }

  // Re-render the upsell list on its own through the Section Rendering API.
  function refreshUpsell() {
    return fetch(sectionUrl(UPSELL_SECTION_ID))
      .then(function (response) {
        if (!response.ok) throw new Error('Section rendering failed: ' + response.status);
        return response.text();
      })
      .then(applyUpsellHTML);
  }

  function isCartPage() {
    return !!document.getElementById('main-cart-items');
  }

  function getCartDrawer() {
    var drawer = document.querySelector('cart-drawer');
    return drawer && typeof drawer.renderContents === 'function' ? drawer : null;
  }

  // Mirrors Dawn's CartItems.getSectionsToRender() for the /cart page.
  function getCartPageSections() {
    var items = document.getElementById('main-cart-items');
    var footer = document.getElementById('main-cart-footer');
    var sections = [];

    if (items) {
      sections.push({ id: 'main-cart-items', section: items.dataset.id, selector: '.js-contents' });
    }
    if (footer) {
      sections.push({ id: 'main-cart-footer', section: footer.dataset.id, selector: '.js-contents' });
    }
    sections.push({ id: 'cart-icon-bubble', section: 'cart-icon-bubble', selector: '.shopify-section' });
    // Optional: repainted only when it happens to be part of the response.
    // Bundled section rendering accepts a limited number of sections per
    // request, so this one is never requested — it only carries error text.
    sections.push({
      id: 'cart-live-region-text',
      section: 'cart-live-region-text',
      selector: '.shopify-section',
      optional: true,
    });

    return sections;
  }

  function renderCartPageSections(sections) {
    getCartPageSections().forEach(function (section) {
      var html = sections[section.section];
      var container = document.getElementById(section.id);
      if (!html || !container) return;

      var target = container.querySelector(section.selector) || container;
      target.innerHTML = getSectionInnerHTML(html, section.selector);
    });

    // Something was just added, so the cart is definitely not empty.
    var cartItems = document.querySelector('cart-items');
    var cartFooter = document.getElementById('main-cart-footer');
    if (cartItems) cartItems.classList.remove('is-empty');
    if (cartFooter) cartFooter.classList.remove('is-empty');
  }

  function renderCartIconBubble() {
    return fetch(sectionUrl('cart-icon-bubble'))
      .then(function (response) {
        return response.text();
      })
      .then(function (html) {
        var bubble = document.getElementById('cart-icon-bubble');
        if (bubble) bubble.innerHTML = getSectionInnerHTML(html, '.shopify-section');
      })
      .catch(function () {
        /* The bubble is cosmetic — never break the flow over it. */
      });
  }

  /*
    Fallback used when bundled section rendering did not return usable HTML.
    Dawn's own components refresh themselves when the cartUpdate event is
    published, so this stays entirely within Dawn's architecture. Only if this
    also fails do we reload the page.
  */
  function softRefreshCart(cartData, variantId) {
    return Promise.all([publishCartUpdate(cartData, variantId), renderCartIconBubble(), refreshUpsell()]);
  }

  function publishCartUpdate(cartData, variantId) {
    if (typeof publish !== 'function' || typeof PUB_SUB_EVENTS === 'undefined') return Promise.resolve();

    var result = publish(PUB_SUB_EVENTS.cartUpdate, {
      source: 'cart-upsell',
      productVariantId: variantId,
      cartData: cartData,
    });

    // Dawn's subscribers return their fetch promises; re-run setup afterwards
    // because some of them replace whole cart sections (and with them, the
    // upsell host) with freshly rendered, unshuffled markup.
    return Promise.resolve(result)
      .then(function () {
        initAll(document);
      })
      .catch(function () {
        initAll(document);
      });
  }

  /* ------------------------------------------------------------- add to cart */

  function setLoading(button, isLoading) {
    var spinner = button.querySelector('.loading__spinner');

    if (isLoading) {
      button.setAttribute('aria-disabled', 'true');
      button.classList.add('loading');
      if (spinner) spinner.classList.remove('hidden');
    } else {
      button.removeAttribute('aria-disabled');
      button.classList.remove('loading');
      if (spinner) spinner.classList.add('hidden');
    }
  }

  function showError(host, message) {
    if (!host) return;
    var errorElement = host.querySelector(SELECTORS.error);
    if (!errorElement) return;

    if (message) {
      errorElement.textContent = message;
      errorElement.removeAttribute('hidden');
    } else {
      errorElement.textContent = '';
      errorElement.setAttribute('hidden', '');
    }
  }

  function onAddClick(button) {
    if (button.getAttribute('aria-disabled') === 'true') return;

    var variantId = button.dataset.variantId;
    if (!variantId) return;

    var host = button.closest(SELECTORS.host);
    var item = button.closest(SELECTORS.item);
    var inDrawer = !!button.closest('cart-drawer');
    var drawer = getCartDrawer();
    var useDrawer = inDrawer && drawer;
    var onCartPage = !useDrawer && isCartPage();

    // Ask Shopify to render everything we need to repaint, in one request.
    var sectionIds = [UPSELL_SECTION_ID];
    if (useDrawer) {
      drawer.getSectionsToRender().forEach(function (section) {
        sectionIds.push(section.id);
      });
    } else if (onCartPage) {
      getCartPageSections().forEach(function (section) {
        if (section.section && !section.optional) sectionIds.push(section.section);
      });
    } else if (drawer) {
      drawer.getSectionsToRender().forEach(function (section) {
        sectionIds.push(section.id);
      });
    } else {
      sectionIds.push('cart-icon-bubble');
    }

    showError(host, '');
    setLoading(button, true);

    var body = JSON.stringify({
      id: Number(variantId),
      quantity: 1,
      sections: sectionIds.join(','),
      sections_url: window.location.pathname + window.location.search,
    });

    fetch(cartAddUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/javascript',
      },
      body: body,
    })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        var data = result.data;

        if (!result.ok || data.status) {
          throw new Error(data.description || data.message || errorMessage());
        }

        if (useDrawer) {
          drawer.setActiveElement(document.activeElement);
        }

        var sections = data.sections || {};
        var rendered = false;

        try {
          if (useDrawer) {
            // Dawn's own drawer renderer: repaints #CartDrawer + the bubble.
            drawer.renderContents(data);
            rendered = true;
          } else if (onCartPage) {
            renderCartPageSections(sections);
            rendered = true;
          } else if (drawer) {
            drawer.renderContents(data);
            rendered = true;
          }
        } catch (renderError) {
          rendered = false;
        }

        // Remove the product we just added straight away, so it cannot be
        // clicked twice while the fresh markup is on its way in.
        if (item && item.parentNode) item.remove();

        if (sections[UPSELL_SECTION_ID]) {
          applyUpsellHTML(sections[UPSELL_SECTION_ID]);
        } else {
          refreshUpsell().catch(function () {
            /* Handled by softRefreshCart below when rendering failed. */
          });
        }

        if (!rendered) {
          // Section rendering did not produce usable HTML — let Dawn's own
          // subscribers refresh the cart instead of reloading the page.
          return softRefreshCart(data, variantId).catch(function () {
            window.location.reload();
          });
        }

        if (!useDrawer && !onCartPage && !drawer) {
          renderCartIconBubble();
        }

        return publishCartUpdate(data, variantId);
      })
      .catch(function (error) {
        // eslint-disable-next-line no-console
        console.error('[cart-upsell]', error);
        showError(host, error && error.message ? error.message : errorMessage());
      })
      .finally(function () {
        setLoading(button, false);
      });
  }

  /* ------------------------------------------------------------------ events */

  function onDocumentClick(event) {
    var target = event.target;
    if (!target || !target.closest) return;

    var button = target.closest(SELECTORS.addButton);
    if (!button) return;

    event.preventDefault();
    onAddClick(button);
  }

  function onCartUpdated(payload) {
    // Our own add already repainted everything — don't fetch twice.
    if (payload && payload.source === 'cart-upsell') return;
    return refreshUpsell().catch(function () {
      /* Leave the current recommendations in place if the refresh fails. */
    });
  }

  function bind() {
    document.addEventListener('click', onDocumentClick);

    // Dawn / Shopify cart updates (quantity changes, other add-to-cart forms).
    if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
      subscribe(PUB_SUB_EVENTS.cartUpdate, onCartUpdated);
    }

    // Convention used by several themes and apps to request a cart repaint.
    document.addEventListener('cart:refresh', function () {
      onCartUpdated();
    });

    // Theme editor: sections are re-rendered without a page load.
    document.addEventListener('shopify:section:load', function (event) {
      initAll(event.target || document);
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        initAll(document);
      });
    } else {
      initAll(document);
    }
  }

  window.cartUpsell = {
    initialized: true,
    init: initAll,
    refresh: refreshUpsell,
  };

  bind();
})();
