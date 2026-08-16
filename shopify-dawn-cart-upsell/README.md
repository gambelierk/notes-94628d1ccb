# Cart upsell for Shopify Dawn

Cross-sell recommendations in the **cart drawer** and on the **/cart page**, matched
against the products already in the cart by **exact product title**, with random
fallback products filling the remaining slots.

No app, no subscription, no external JavaScript libraries.

Built and verified against **Dawn 16.0.0** (commit `258f00f`, Aug 2026).

---

## 1. Files in this package

| File | Goes to | Purpose |
| --- | --- | --- |
| `snippets/cart-upsell.liquid` | `snippets/` | All selection logic + markup (single source of truth) |
| `sections/cart-upsell.liquid` | `sections/` | Render-only section used as the section-rendering endpoint |
| `assets/cart-upsell.css` | `assets/` | Styling (Dawn CSS variables) |
| `assets/cart-upsell.js` | `assets/` | Shuffle, Ajax add-to-cart, re-render |
| `config/settings_schema.cart-upsell.json` | — | The exact settings group to paste into `config/settings_schema.json` |
| `tests/` | — | Dev-only verification harness (see `tests/README.md`) — do not upload |

`sections/cart-upsell.liquid` deliberately has **no presets**, so it never shows up in
the theme editor's "Add section" list. It exists only so the browser can ask Shopify
for a freshly rendered copy of the component.

---

## 2. How the matching works

Rendered fresh by Liquid on every cart render:

1. Build the **exclusion list** — the `product_id` of every line item in the cart,
   stored as `|123|456|` so `|12|` can never match inside `|123|`.
2. Build the **match list** — the titles of every product in the cart, stored
   separately as `~|~björne~|~fäbodjäntan~|~`, stripped and downcased.
3. For each of the first 50 products in the upsell collection:
   * skip it if its **product ID** is in the exclusion list;
   * skip it if `selected_or_first_available_variant` is missing or unavailable;
   * it is an **exact match** if its normalised title is in the match list.
4. Exact matches are rendered first (CSS `order: 0`), capped at the recommendation limit.
5. Remaining slots are filled with other eligible products from the collection.
   Liquid renders a surplus pool (up to 4× the free slots, max 12) with the `hidden`
   attribute; `cart-upsell.js` shuffles the pool and reveals exactly as many as there
   are free slots, so the filler products vary between renders.
6. Random fallback disabled → only exact matches are rendered.
7. Nothing eligible → the component renders an empty (invisible) host element, so
   the whole component disappears.

**Exclusion is by product ID only. Titles are only ever used for ordering.**
Two different products may share a title on purpose — a "Björne" t-shirt in the cart
therefore promotes the "Björne" patch from the upsell collection. Once that patch is
added, its own product ID is in the cart and it disappears from the recommendations.

Matching is exact after `strip` + `downcase`: `Björne` = `björne `, but
`Björne` ≠ `Björne Patch`. To make it case-sensitive, remove the two `| downcase`
filters in `snippets/cart-upsell.liquid`.

---

## 3. Installation walkthrough

1. **Duplicate your live theme** (Online store → Themes → … → Duplicate) and work on
   the copy, or use `shopify theme dev` locally.
2. Copy the four theme files into place:
   ```
   snippets/cart-upsell.liquid
   sections/cart-upsell.liquid
   assets/cart-upsell.css
   assets/cart-upsell.js
   ```
3. Add the settings group to `config/settings_schema.json` (§4).
4. Load the CSS and JS in `layout/theme.liquid` (§5).
5. Add the snippet to the cart drawer (§6).
6. Add the snippet to the cart page (§7).
7. Open the theme editor → **Theme settings → Cart upsell**, pick the upsell
   collection, set the heading/limit/button text, save.
8. Walk the testing checklist (§9).

---

## 4. `config/settings_schema.json`

`config/settings_schema.json` is a **JSON array of setting groups**. Paste the object
below as a new element of that array — the easiest safe spot is immediately **after**
the closing `}` of the existing `"t:settings_schema.cart.name"` group and before the
`"t:settings_schema.customer_accounts.name"` group. Don't forget the comma between
the two objects.

```json
{
  "name": "Cart upsell",
  "settings": [
    {
      "type": "checkbox",
      "id": "cart_upsell_enabled",
      "label": "Enable cart upsell",
      "default": true,
      "info": "Shows cross-sell recommendations in the cart drawer and on the cart page."
    },
    {
      "type": "collection",
      "id": "cart_upsell_collection",
      "label": "Upsell collection",
      "info": "Recommendations are picked from this collection. Only the first 50 products of the collection are considered."
    },
    {
      "type": "text",
      "id": "cart_upsell_heading",
      "label": "Heading",
      "default": "You might also like"
    },
    {
      "type": "range",
      "id": "cart_upsell_limit",
      "label": "Number of recommendations",
      "min": 1,
      "max": 6,
      "step": 1,
      "default": 3
    },
    {
      "type": "checkbox",
      "id": "cart_upsell_random_fallback",
      "label": "Fill remaining slots with random products",
      "default": true,
      "info": "When there are fewer exact title matches than the number of recommendations, the remaining slots are filled with random available products from the upsell collection. Turn off to show exact matches only."
    },
    {
      "type": "text",
      "id": "cart_upsell_button_label",
      "label": "Add button text",
      "default": "Add"
    }
  ]
}
```

The collection is chosen in the theme editor — no handle is hard-coded anywhere.

---

## 5. `layout/theme.liquid`

In Dawn 16 the stylesheet block sits around **line 281**. Add the two lines directly
**after** `{{ 'base.css' | asset_url | stylesheet_tag }}`:

```liquid
{{ 'base.css' | asset_url | stylesheet_tag }}
{{ 'cart-upsell.css' | asset_url | stylesheet_tag }}
<script src="{{ 'cart-upsell.js' | asset_url }}" defer="defer"></script>
```

Both must load site-wide, because the cart drawer is rendered on every page.
`cart-upsell.js` is deferred and Dawn's `pubsub.js` / `constants.js` are already
deferred higher up in `<head>`, so `subscribe` and `PUB_SUB_EVENTS` are guaranteed to
exist by the time this script runs (it degrades gracefully if they don't).

---

## 6. Cart drawer — `snippets/cart-drawer.liquid`

In Dawn 15/16 the drawer markup lives in **`snippets/cart-drawer.liquid`**
(`sections/cart-drawer.liquid` only contains `{%- render 'cart-drawer' -%}`).

Find the drawer footer (around **line 490**) and insert the render tag as the **first
child** of `.drawer__footer`:

```liquid
      </cart-drawer-items>
      <div class="drawer__footer">
        {%- render 'cart-upsell', context: 'drawer' -%}

        {%- if settings.show_cart_note -%}
          <details id="Details-CartDrawer">
```

Why inside `.drawer__footer` and not between `</cart-drawer-items>` and the footer:
Dawn hides the footer for an empty cart with the adjacent-sibling rule
`cart-drawer-items.is-empty + .drawer__footer { display: none; }` in
`component-cart-drawer.css`. Inserting an element between those two nodes breaks that
selector and the footer would reappear on an empty cart.

---

## 7. Cart page — `sections/main-cart-items.liquid`

Insert the render tag directly **after** the closing `</form>` of the cart form, still
inside `.page-width` (Dawn 16.0.0: the `</form>` on **line 467**):

```liquid
      <p
        class="visually-hidden"
        id="shopping-cart-line-item-status"
        aria-live="polite"
        aria-hidden="true"
        role="status"
      >
        {{ 'accessibility.loading' | t }}
      </p>
    </form>

    {%- render 'cart-upsell', context: 'cart' -%}
  </div>
</cart-items>
```

This spot is inside the region Dawn itself re-renders on `cart:update`
(`CartItems.onCartUpdate()` replaces the whole `<cart-items>` inner HTML), so the
component is refreshed server-side there too — and it sits above the totals/checkout
block, which is where a cross-sell belongs.

**Alternative placement** (upsell below the subtotal instead of above it): put the
same tag in `sections/main-cart-footer.liquid` inside `.cart__footer`. Note that Dawn
hides `.cart__footer` entirely when the cart is empty (`.is-empty .cart__footer`), so
the upsell would not appear on an empty cart there.

---

## 8. Add-to-cart behaviour

Clicking **Add**:

1. `POST {{ window.Shopify.routes.root }}cart/add.js` with
   `{ id, quantity: 1, sections, sections_url }` — locale-aware, never a hard-coded
   `/cart/add.js`.
2. Bundled section rendering returns the repainted sections in one round trip:
   * drawer: `cart-drawer`, `cart-icon-bubble`, `cart-upsell`;
   * cart page: the `main-cart-items` and `main-cart-footer` section IDs (read from
     their `data-id`), `cart-icon-bubble`, `cart-upsell`.
3. In the drawer, Dawn's own `CartDrawer.renderContents()` / `getSectionsToRender()`
   do the painting — Dawn's cart architecture is reused, not replaced. On the cart
   page the same `id` + `selector` pairs Dawn's `CartItems.getSectionsToRender()`
   uses are applied.
4. The upsell list is replaced with the freshly rendered one, so the product just
   added is gone (its product ID is now in the cart) and the fallback pool is
   re-shuffled. The clicked row is also removed immediately, before the response is
   painted, so it can't be double-clicked.
5. `PUB_SUB_EVENTS.cartUpdate` is published with `source: 'cart-upsell'`, so any other
   Dawn component (free-shipping bars, cart notification, etc.) refreshes itself.

**Fallbacks**, in order — a full page reload is only the last resort:

* section HTML missing/unusable → publish `cartUpdate` (Dawn re-fetches its own
  sections) + fetch `?section_id=cart-icon-bubble` + fetch `?section_id=cart-upsell`;
* that also fails → `window.location.reload()`;
* network/cart error → the row's button is re-enabled and the message is shown in the
  component's `role="alert"` paragraph; the cart is left untouched.

The click handler is a **single delegated listener on `document`**, so re-rendering
the drawer or any cart section can never create duplicate listeners. Initialisation
runs on `DOMContentLoaded`, after every re-render, and on `shopify:section:load`
(theme editor).

---

## 9. Testing checklist

**Matching**

- [ ] Cart contains *Björne* (t-shirt). The *Björne* patch from the upsell collection
      appears **first** in the list.
- [ ] Cart contains *Björne* + *Fäbodjäntan*, limit 3, collection = Björne,
      Fäbodjäntan, Kungen, Dalahäst → Björne, Fäbodjäntan, then one of
      Kungen/Dalahäst.
- [ ] Reload the cart a few times → the third slot alternates between Kungen and
      Dalahäst (client-side shuffle).
- [ ] Add the *Björne* patch → it disappears from the recommendations, while the
      *Björne* t-shirt stays in the cart (exclusion is by product ID, not title).
- [ ] A product titled *Björne Patch* is **not** treated as an exact match for
      *Björne*.
- [ ] Two products with the same title, both out of the cart, both still eligible.

**Recommendation logic**

- [ ] Limit = 1 → exactly one recommendation; limit = 6 → up to six.
- [ ] Random fallback off + no exact matches → the component is invisible.
- [ ] Random fallback off + 1 exact match, limit 3 → exactly one recommendation.
- [ ] No products left in the collection (all in cart) → component invisible, no
      empty box, no stray heading or border.
- [ ] A sold-out product in the collection is never recommended.
- [ ] A product whose only variants are unavailable is never recommended.

**Add to cart**

- [ ] Drawer: clicking **Add** adds the item without a page reload; drawer contents,
      totals and the header cart bubble all update.
- [ ] Cart page: clicking **Add** updates the line items, the subtotal and the cart
      bubble without a reload.
- [ ] Button shows the spinner and is not clickable twice while adding.
- [ ] Recommendations re-render after adding and no longer contain the added product.
- [ ] Changing a line-item quantity (or removing a line) refreshes the
      recommendations.
- [ ] Emptying the cart from the drawer → no JS errors, empty-cart state renders
      normally, drawer footer stays hidden.

**Storefront/robustness**

- [ ] Works in a localised storefront (e.g. `/sv/`) — check the network tab: the POST
      goes to `/sv/cart/add.js`.
- [ ] Works with `cart_type = drawer` and with `cart_type = page`; with
      `cart_type = notification` the cart page placement still works.
- [ ] Mobile (≤ 749 px): rows stay on one line, image 60 px, button not clipped.
- [ ] Drawer with 6 recommendations: the list scrolls internally, the checkout button
      is still reachable.
- [ ] Theme editor: changing heading/limit/collection re-renders correctly.
- [ ] Product title, heading and button label containing `<`, `>` or `"` render as
      text (all merchant/product text goes through `| escape`).
- [ ] JavaScript disabled: recommendations still render (unshuffled) and the title and
      image links still work.
- [ ] No console errors on `/cart`, on a product page, and after opening the drawer.

---

## 10. Dawn version compatibility notes

* **Verified on Dawn 16.0.0.** Dawn 15/16 keep the drawer markup in
  `snippets/cart-drawer.liquid` (`sections/cart-drawer.liquid` is a one-line
  wrapper). Some older Dawn releases keep the markup in the section file instead —
  apply §6 to whichever file actually contains `<div class="drawer__footer">`, and
  expect the quoted line numbers to differ.
* **`cart-drawer-items.is-empty + .drawer__footer`** — this adjacent-sibling rule in
  `component-cart-drawer.css` is what hides the drawer footer on an empty cart.
  Always insert *inside* `.drawer__footer`, never between the items element and the
  footer, or the empty-cart drawer breaks.
* **`PUB_SUB_EVENTS.cartUpdate`** still exists in Dawn 16 (`assets/constants.js`) and
  is what Dawn's own components subscribe to. Dawn 15+ additionally dispatches the
  newer `window.StandardEvents` cart events (`CartLinesUpdateEvent`, `CartErrorEvent`).
  This component does not depend on those — it publishes the legacy event and also
  listens for the `cart:refresh` document event that many apps dispatch. If a future
  Dawn drops `PUB_SUB_EVENTS`, the code degrades to its fetch-based refresh path
  (`typeof subscribe === 'function'` guards everything).
* **`CartDrawer.renderContents()` / `getSectionsToRender()`** are used when present
  and are never monkey-patched. If a future Dawn renames them, the `typeof … ===
  'function'` guard routes the update through the fallback path instead of throwing.
* **Section rendering limit** — bundled section rendering accepts a limited number of
  sections per request (Shopify documents 5). The cart page requests four
  (`cart-upsell`, main cart items, main cart footer, `cart-icon-bubble`);
  `cart-live-region-text` is deliberately *not* requested. If you add more sections to
  the bundle, drop one first.
* **50-product collection limit** — `collection.products` inside a `for` loop yields
  at most 50 products without pagination, and this snippet iterates it twice
  (count pass + render pass). Keep the upsell collection small and curated; a product
  at position 51+ can never be matched. If you need more, use a `paginate` loop or
  split the collection.
* **Theme editor section picker** — `sections/cart-upsell.liquid` has no `presets`, so
  it stays out of the "Add section" list while remaining valid for
  `?section_id=cart-upsell`. Don't delete it: it is the re-render endpoint.
* **Cart notification** (`cart_type = notification`) has no upsell placement by
  design; the popup is too small for a list. Add
  `{%- render 'cart-upsell', context: 'notification' -%}` to
  `snippets/cart-notification.liquid` if you want it there — the JS already handles a
  host outside the drawer and cart page.
* **Translations** — the settings group uses literal English strings rather than `t:`
  keys, so no `locales/*.schema.json` edits are needed. Merchant-facing text
  (heading, button label) is editable per language in the theme editor's language
  picker. Shopify's `theme check` may emit `TranslationKeyExists`-style hints for the
  literal labels; they are informational.
* **`settings.cart_upsell_collection`** resolves through `collections[handle]`, so it
  keeps working whether the collection setting yields a collection object (current
  behaviour) or a handle string.
