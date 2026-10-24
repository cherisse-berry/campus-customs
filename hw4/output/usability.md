# Campus Customs Usability Improvements

Problem 9 added four improvements to Campus Customs: two on the website and two in the shopping assistant. Before building, I checked what already existed so nothing was duplicated:

| Improvement | What already existed | What was added |
|---|---|---|
| Recently viewed products | Nothing | A "Recently viewed" section on the home page and product pages |
| Easier-to-see stock | A stock table and disabled sold-out sizes, **only** on the product detail page. Product cards and the shop showed no stock at all. | Size-by-size availability on every product card, a "Size in stock" filter in the shop, and a plain-language summary and per-size labels on the product page. The existing table was kept. |
| Similar products when unavailable | One sentence in the chatbot's instructions ("suggest a similar product"), with no way to actually find one | A `find_similar_products` tool that ranks in-stock alternatives, plus instructions on how to offer them |
| Clarifying questions | One line ("ask one short follow-up question if it would really help"), plus "ask which product" for an unclear "this" | Clear guidance on when to ask and when not to, and tappable answer buttons in the chat (`suggest_replies` tool) |

---

## 1. Recently viewed products

### What was added
- Every product page a shopper opens is remembered in their browser, up to 8, newest first.
- A **Recently viewed** section appears:
  - **On the home page,** below Featured.
  - **At the bottom of each product page,** leaving out the product being viewed.
- The section uses the same product cards as the shop, with the image, name, price, description and **current stock**.
- A **Clear** button empties the list.

### Why it helps customers
- **Get back easily.** Shoppers often compare a few items or come back later. They can now return to something they liked in one click, without searching again or using the browser's Back button.
- **No account needed.** The list is kept in the browser, not on the server, so it works for guests too. It's private to that browser.
- **Always up to date.** Only product IDs are stored; prices and stock are loaded fresh each time. A product that sold out since it was viewed shows as sold out, never with an old price.
- **Doesn't break anything.** If the browser blocks storage (for example a private window), the section simply doesn't appear, and the rest of the site works as normal.

### How it works
- `frontend/src/recentlyViewed.ts` saves the list in `localStorage` (key `campus-customs:recently-viewed`), with every read and write guarded.
- `ProductPage` adds the product when it loads.
- `components/RecentlyViewed.tsx` shows the list with live product data.

---

## 2. Stock availability that's easier to see

### What was added
- **On every product card** (shop, home page, recently viewed and the chat's results panel):
  - A short summary next to the price: "All sizes in stock" (green), "4 of 6 sizes in stock" (amber) or "Sold out" (red).
  - A row of size labels: green when in stock, amber when only 1-5 are left, and grey and crossed out when sold out. Hovering or a screen reader gives the detail, for example "XL: Only 2 left".
- **In the shop:** a **Size in stock** filter (Any, XS-XXL) that shows only products available in that size. For example, choosing XL takes the hoodies from 27 to 21. The result line says "21 products in stock in XL".
- **On the product page:**
  - A colored summary box in plain words, for example "In stock in S, M, L and XXL · Sold out in XS and XL", plus "Nearly gone: XL (2 left)" when sizes are running low.
  - Each size button now shows its status underneath ("In stock", "2 left", "Sold out"). Sold-out sizes are crossed out and can't be selected.
  - The detailed stock table is still there for anyone who wants exact numbers.

### Why it helps customers
- **Fewer wasted clicks.** Before, the only way to find out whether a hoodie came in your size was to open it. Now you can see it from the shop grid, or filter the shop to your size and see only what you can actually buy.
- **Faster decisions.** The summary on the product page answers "can I get this?" in one sentence, before the customer reads the size table.
- **A nudge when stock is low.** "Only 2 left" helps customers who are deciding.
- **More accessible.** Status isn't shown by color alone: it's also in words, by crossing out, and in screen-reader labels.
- **Consistent everywhere.** The same thresholds as the chatbot (0 = sold out, 1-5 = only a few left) and the same wording are used across the site and the chat.

### How it works
- `GET /api/products` now includes each product's stock per size, and takes a `size` filter.
- `frontend/src/stock.ts` holds the shared rules and wording.
- `components/StockSizes.tsx` draws the size labels.
- The chat's page results also carry stock, so cards from the chatbot show the same information.

---

## 3. The chatbot recommends similar products when something isn't available

### What was added
- **A new tool, `find_similar_products`.** Given a product, and optionally the customer's size, a color or a budget, it finds alternatives that are **actually in stock** (in that size, if given). It ranks them by how alike they are:
  - same garment type or category,
  - shared colors (navy, gray and so on, treating grey and charcoal as gray),
  - shared themes (family styles such as Mom and Dad, sports designs, residential colleges, professional schools, bulldog designs),
  - shared distinctive tags (for example "left chest logo"),
  - a close price.

  Each suggestion comes with a plain reason, for example: *"also a hoodie, also navy and white, also a family style, same price, in stock in XL"*.
- **If no product comes in the requested color** (for example pink), the tool says so, and the assistant is told to be honest about it before offering the closest options in other colors.
- **New instructions** ("Recommending alternatives"): when something is sold out in the customer's size, sold out everywhere, not available in a color, or over budget, the assistant should:
  1. say so plainly first,
  2. recommend two or three of the best alternatives with prices and why they're similar,
  3. mention other sizes of the same item if any are in stock.
- **Alternatives appear on the page.** They show in the chat's results panel with their stock, so the customer can see and click them.

### Example
> **Customer:** Is the Champion Reverse Weave Hoodie 1 in XL?
>
> **Assistant:** The **Champion Reverse Weave Hoodie 1** is **sold out in XL**. Similar hoodies in stock in XL: **The Forest School Hoodie** (**$68.00**, also navy and white) and the **Squash Left Chest Hoodie** (**$68.00**). More are on the page.
>
> *(The page shows the original, marked sold out in XL, and five alternatives, each with XL in stock.)*

### Why it helps customers
- **No dead ends.** "Sorry, it's sold out" ends the conversation. "Here are three like it in your size" keeps the customer shopping and helps them find something they can actually buy.
- **Trustworthy suggestions.** Every alternative comes from the database and is checked to be in stock in their size. The price check from Problem 6 still applies, so a suggested price is always real.
- **Relevant, not random.** Matching on type, color, theme and price means a Yale **Mom** Hoodie leads to the Dad and Grandma hoodies, and a hockey hoodie leads to other sports hoodies, not just anything navy.

---

## 4. The chatbot asks clarifying questions when a request isn't clear

### What was added
- **New instructions** ("Clarifying questions") on when to ask and when not to:
  - **Ask when:** "this" can't be worked out, a request could mean very different things ("I need a gift"), availability depends on a size the customer hasn't given, or several products match a name.
  - **Don't ask when** a useful answer is possible. For "what hoodies do you have?", show them and then offer to narrow down. For "is it in stock?" when every size is available, just say so.
  - **One short question at a time,** with the reason when it isn't obvious. When the request is vague, still show a few picks in the same reply, so the customer isn't left with nothing.
- **Tappable answers:** a new `suggest_replies` tool lets the assistant attach 2-4 short answers to its question, for example "For myself", "A gift for my dad", "A gift for a student".
  - They appear as buttons under the reply. Tapping one sends it as the customer's answer, and the buttons disappear once used.
  - The tool rejects bad options (too few, too many, too long or duplicated), so the buttons stay tidy.

### Example
> **Customer:** I need a gift
>
> **Assistant:** Happy to help! Who's the gift for?
> `[For myself]` `[A gift for my dad]` `[A gift for a student]`
>
> *(Tapping "A gift for my dad" sends it, and the assistant shows the Dad styles on the page.)*

### Why it helps customers
- **Better answers.** A vague request gets a question instead of a guess, so the customer isn't buried in irrelevant products.
- **Less typing.** One tap answers the question, which especially helps on phones.
- **Not annoying.** The "don't ask when" rules keep the assistant from quizzing customers when it could just help.

---

## Testing

All four improvements were tested automatically and in a real browser.

**Backend** (`backend/tests/test_chat.py`, 11 new tests; 92 backend tests in total, all passing):
- **Stock data:**
  - The product list includes stock for each size, and it matches the database for all 102 products.
  - The size filter returns only products in stock in that size, and leaves out exactly those sold out in it.
- **Similar products:**
  - Alternatives are in stock in the requested size, never include the original, and are in the same category.
  - They follow themes: Mom leads to Dad and Grandma, hockey to other sports designs, Pierson to other residential colleges. "Crewneck" isn't mistaken for the sport "crew".
  - The color filter treats grey as gray. Pink is reported honestly as not available.
  - The budget filter works. Unknown products and sizes get clear errors.
  - Alternatives are added to the page and to the price check's list of real prices.
- **End to end:** a sold-out XL question leads to a reply that names the original plus two alternatives, all checked to be in stock in XL, and the page shows the original and five alternatives.
- **Clarifying questions:** suggested answers come back with the reply, cleaned and with duplicates removed. Invalid ones are rejected, and normal replies have none.

**Frontend** (`frontend/src/test/app.test.tsx`, 6 new tests; 28 in total, all passing):
- Cards show "5 of 6 sizes in stock" and size labels with the right status.
- The size filter sends `size=XL`.
- The product page summary reads "In stock in XS, S, L, XL and XXL · Sold out in M" with the "Nearly gone" line.
- Size buttons announce their status ("M: Sold out", disabled).
- Recently viewed: the current product is left out, the list shows on the home page with live stock, and Clear works. Newest comes first, at most 8 are kept, and blocked storage doesn't break anything.
- Suggested answers appear, send when tapped, and disappear after.

**In a browser** (real website and FastAPI server, with a scripted stand-in for Claude since this workspace has no API key):
- **Shop:**
  - The Champion Reverse Weave Hoodie 1 card shows "4 of 6 sizes in stock" with XS and XL crossed out.
  - Filtering hoodies to XL went from 27 to 21, every card had XL available, and the Champion hoodie dropped out.
- **Product page:** "In stock in S, M, L and XXL · Sold out in XS and XL", with each size button labeled.
- **Recently viewed:**
  - After viewing four products, the home page listed them newest first, and each product page listed the others.
  - The list survived a reload, and Clear emptied it.
- **Chat, sold out:** "Is the Champion Reverse Weave Hoodie 1 in XL?" led to a sold-out reply with two in-stock alternatives, and the page showed five alternatives, each with XL in stock.
- **Chat, vague request:** "I need a gift" brought up three answer buttons. Tapping "A gift for my dad" sent it, the buttons went away, and the Dad styles appeared on the page.
- **Phones and errors:** no sideways scrolling at phone width, and no errors.

The reply wording in the browser test came from the scripted stand-in. The real assistant follows the same instructions and uses the same tools, so its wording will differ. To see it, run the site with your API key and try the two example conversations above.
