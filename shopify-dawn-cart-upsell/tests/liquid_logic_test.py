"""Render snippets/cart-upsell.liquid with a real Liquid engine and assert the
selection rules from the spec."""
import os
import re
from liquid import Environment

HERE = os.path.dirname(os.path.abspath(__file__))
SNIPPET = os.path.join(HERE, "..", "snippets", "cart-upsell.liquid")

env = Environment()
env.filters["money"] = lambda v, *a, **k: f"{int(v)/100:.0f} kr"
env.filters["image_url"] = lambda v, *a, **k: "https://cdn.shopify.com/img_216x.jpg"
env.filters["image_tag"] = lambda v, *a, **k: f'<img src="{v}" alt="">'
env.filters["placeholder_svg_tag"] = lambda v, *a, **k: "<svg></svg>"
env.filters["inline_asset_content"] = lambda v, *a, **k: "<svg class='spinner'></svg>"

template = env.from_string(open(SNIPPET).read())


def product(pid, title, price=10000, available=True, variant_id=None):
    return {
        "id": pid,
        "title": title,
        "url": f"/products/{pid}",
        "featured_image": {"alt": title},
        "selected_or_first_available_variant": {
            "id": variant_id or pid * 100,
            "price": price,
            "available": available,
        },
    }


def cart(*products):
    return {"items": [{"product_id": p["id"], "product": {"title": p["title"]}} for p in products]}


def render(cart_products, collection_products, limit=3, random_mode="always", enabled=True):
    coll = {"handle": "upsell", "products": collection_products}
    settings = {
        "cart_upsell_enabled": enabled,
        "cart_upsell_collection": coll,
        "cart_upsell_heading": "You might also like",
        "cart_upsell_button_label": "Add",
        "cart_upsell_limit": limit,
    }
    if random_mode is not None:
        settings["cart_upsell_random_mode"] = random_mode
    return template.render(
        context="drawer",
        settings=settings,
        collections={"upsell": coll},
        cart=cart(*cart_products),
    )


ITEM_RE = re.compile(
    r'<li\s+class="(?P<class>[^"]*)"[^>]*?data-product-id="(?P<id>\d+)"(?P<rest>.*?)>', re.S
)


def parse(html):
    """Returns list of (product_id, is_exact, is_hidden)."""
    out = []
    for m in ITEM_RE.finditer(html):
        rest = m.group("rest")
        out.append(
            (
                int(m.group("id")),
                "cart-upsell__item--exact" in m.group("class"),
                bool(re.search(r"(?<![-\w])hidden(?![-\w])", rest)),
            )
        )
    return out


def visible(items):
    return [i for i, exact, hid in items if not hid]


def exacts(items):
    return [i for i, exact, hid in items if exact and not hid]


failures = []


def check(name, condition, detail=""):
    print(("PASS  " if condition else "FAIL  ") + name + ("" if condition else f"   -> {detail}"))
    if not condition:
        failures.append(name)


# --- Products -------------------------------------------------------------
bjorne_shirt = product(1, "Björne")
fabod_shirt = product(2, "Fäbodjäntan")
slips_shirt = product(3, "Slipsknut")

bjorne_patch = product(10, "Björne")
fabod_patch = product(11, "Fäbodjäntan")
kungen_patch = product(12, "Kungen")
dalahast_patch = product(13, "Dalahäst")
collection = [bjorne_patch, fabod_patch, kungen_patch, dalahast_patch]

# --- 1. Spec example ------------------------------------------------------
html = render([bjorne_shirt, fabod_shirt, slips_shirt], collection, limit=3)
items = parse(html)
check("spec example: 2 exact matches shown", sorted(exacts(items)) == [10, 11], items)
check("spec example: 3 visible recommendations", len(visible(items)) == 3, visible(items))
check(
    "spec example: 3rd slot is Kungen or Dalahäst",
    set(visible(items)) - {10, 11} <= {12, 13} and len(set(visible(items)) - {10, 11}) == 1,
    visible(items),
)
check(
    "spec example: surplus fallback candidate rendered hidden for shuffling",
    len(items) == 4 and len(visible(items)) == 3,
    items,
)
check("spec example: exact items come first in DOM", [i for i, e, h in items][:2] == [10, 11], items)

# --- 2. Same title, different product id, is NOT excluded ------------------
check("Björne patch (id 10) recommended although Björne shirt (id 1) is in cart", 10 in visible(items))

# --- 3. Once the patch itself is in the cart, exclude it by product ID -----
html2 = render([bjorne_shirt, fabod_shirt, slips_shirt, bjorne_patch], collection, limit=3)
items2 = parse(html2)
check("added upsell product excluded by product ID", 10 not in [i for i, e, h in items2], items2)
check("Björne shirt stays in cart, patch gone; Fäbodjäntan still exact", exacts(items2) == [11], items2)
check("remaining 2 slots filled with fallback", sorted(visible(items2)) == [11, 12, 13], visible(items2))

# --- 4. Partial title must not match --------------------------------------
patch_suffix = product(20, "Björne Patch")
html3 = render([bjorne_shirt], [patch_suffix], limit=3, random_mode="never")
check("'Björne Patch' is not an exact match for 'Björne'", parse(html3) == [], parse(html3))

# --- 5. No exact match at all --> a full list of random products ----------
html_nm = render([slips_shirt], collection, limit=3)
items_nm = parse(html_nm)
check("no title match: 3 random products shown", len(visible(items_nm)) == 3, items_nm)
check("no title match: nothing flagged as exact", exacts(items_nm) == [], items_nm)

html_nm2 = render([slips_shirt], collection, limit=3, random_mode="no_matches_only")
check("no title match + 'only when nothing matches': 3 random products", len(visible(parse(html_nm2))) == 3, parse(html_nm2))

html_nm3 = render([slips_shirt], collection, limit=3, random_mode=None)
check("no title match + setting missing: defaults to 3 random products", len(visible(parse(html_nm3))) == 3, parse(html_nm3))

html_nm4 = render([slips_shirt], collection, limit=2)
check("no title match honours the recommendation limit", len(visible(parse(html_nm4))) == 2, parse(html_nm4))

html_nm5 = render([slips_shirt], [bjorne_patch], limit=3)
check("no title match, only 1 product available: shows that 1", len(visible(parse(html_nm5))) == 1, parse(html_nm5))

# --- 5b. 'Only when nothing matches' keeps a partial match list ------------
html_pm = render([bjorne_shirt], collection, limit=3, random_mode="no_matches_only")
items_pm = parse(html_pm)
check("'only when nothing matches': partial match list is not topped up", visible(items_pm) == [10], items_pm)

html_pm2 = render([bjorne_shirt], collection, limit=3, random_mode="always")
check("'fill any remaining slots': partial match list is topped up", len(visible(parse(html_pm2))) == 3, parse(html_pm2))

# --- 5c. Random products disabled -----------------------------------------
html4 = render([bjorne_shirt], collection, limit=3, random_mode="never")
items4 = parse(html4)
check("random off: only exact matches", [i for i, e, h in items4] == [10], items4)

html5 = render([slips_shirt], collection, limit=3, random_mode="never")
check("random off + no matches: component hidden", "cart-upsell__inner" not in html5)
check("hidden component renders an empty host", 'data-cart-upsell' in html5 and "<li" not in html5)

# --- 6. Availability ------------------------------------------------------
sold_out_bjorne = product(30, "Björne", available=False)
html6 = render([bjorne_shirt], [sold_out_bjorne], limit=3, random_mode="always")
check("unavailable exact match is not recommended", parse(html6) == [], parse(html6))

html7 = render([slips_shirt], [kungen_patch, product(31, "Slut", available=False)], limit=3)
check("unavailable fallback product is not recommended", [i for i, e, h in parse(html7)] == [12], parse(html7))

# --- 7. Limits ------------------------------------------------------------
html8 = render([bjorne_shirt, fabod_shirt], collection, limit=1)
items8 = parse(html8)
check("limit 1: exactly one recommendation", len(visible(items8)) == 1, items8)
check("limit 1: the visible one is an exact match", exacts(items8) == [10], items8)

big = collection + [product(40 + n, f"Filler {n}") for n in range(20)]
html9 = render([slips_shirt], big, limit=6)
items9 = parse(html9)
check("limit 6: six visible", len(visible(items9)) == 6, len(visible(items9)))
check("fallback pool capped at 12 candidates", len(items9) == 12, len(items9))
check("fallback slots attribute matches free slots", 'data-fallback-slots="6"' in html9)

# --- 8. Feature toggles ---------------------------------------------------
html10 = render([bjorne_shirt], collection, enabled=False)
check("disabled: renders nothing at all", html10.strip() == "", repr(html10[:80]))

html11 = template.render(
    context="cart",
    settings={
        "cart_upsell_enabled": True,
        "cart_upsell_collection": None,
        "cart_upsell_heading": "You might also like",
        "cart_upsell_button_label": "Add",
        "cart_upsell_limit": 3,
        "cart_upsell_random_mode": "always",
    },
    collections={},
    cart=cart(bjorne_shirt),
)
# NOTE: on Shopify `nil == blank`, so this renders nothing at all. python-liquid
# treats nil as NOT blank, so the worst case here is an empty (invisible) host.
check(
    "no collection picked: no recommendations rendered",
    "<li" not in html11 and "cart-upsell__inner" not in html11,
    repr(html11[:120]),
)

# --- 9. Empty cart --------------------------------------------------------
html12 = render([], collection, limit=3)
items12 = parse(html12)
check("empty cart: no exact matches, fallback fills", exacts(items12) == [] and len(visible(items12)) == 3, items12)

# --- 10. Escaping ---------------------------------------------------------
evil = product(50, 'Björne "<script>"')
html13 = render([evil], [product(51, 'Björne "<script>"')], limit=1)
check("product titles are escaped", "<script>" not in html13 and "&lt;script&gt;" in html13)
check("titles with markup still match exactly", len(visible(parse(html13))) == 1, parse(html13))

# --- 11. Case / whitespace normalisation ----------------------------------
html14 = render([product(60, " björne ")], [product(61, "Björne")], limit=1, random_mode="never")
check("title match is whitespace/case tolerant", visible(parse(html14)) == [61], parse(html14))

# --- 12. Fixtures for the jsdom test -------------------------------------
fixture_collection = [
    bjorne_patch, fabod_patch, kungen_patch, dalahast_patch,
    product(14, "Näcken"), product(15, "Midsommar"),
]
for name, ctx in (("fixture-drawer.html", "drawer"), ("fixture-cart.html", "cart")):
    coll = {"handle": "upsell", "products": fixture_collection}
    html = template.render(
        context=ctx,
        settings={
            "cart_upsell_enabled": True,
            "cart_upsell_collection": coll,
            "cart_upsell_heading": "You might also like",
            "cart_upsell_button_label": "Add",
            "cart_upsell_limit": 3,
            "cart_upsell_random_mode": "always",
        },
        collections={"upsell": coll},
        cart=cart(bjorne_shirt, slips_shirt),
    )
    open(os.path.join(HERE, name), "w").write(html)
print()
print("Wrote fixture-drawer.html / fixture-cart.html for js_behaviour_test.js")
print("FAILURES:", failures if failures else "none")
raise SystemExit(1 if failures else 0)
