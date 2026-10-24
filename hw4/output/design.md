# Campus Customs Design Refresh

Problem 10 redesigned Campus Customs to look and feel like a polished, modern store, while keeping its Yale identity and every existing feature. This document explains what changed and why it helps customers stay engaged and shop.

## Design direction

**A quiet, airy white store with one bold Yale-blue moment.** The home page hero is the one place the design is loud: a deep Yale-blue field, a large serif headline and a floating collage of real products. Everything else stays calm and white, so product photos and prices do the talking.

Three principles guided every decision:
1. **The product is the hero.** Photos sit on soft blue "plinths", prices are easy to scan, and stock is visible before anyone clicks.
2. **Yale, but not a costume.** The palette is built around Yale Blue (`#00356b`) with a lighter Yale blue (`#286dc0`) and a sky accent. There are no crests or claims of being official, and the school's colors are used tastefully.
3. **Motion that informs, never decorates.** Every animation either confirms an action, shows that something is interactive, or helps the eye follow new content. All of it switches off for people who prefer reduced motion.

---

## 1. Typography

| Before | After | Why |
|---|---|---|
| Inter for text, Libre Baskerville for headings | **Instrument Sans** for text, **Fraunces** for headings and prices | Inter is the default face of countless sites, so it reads generic. Fraunces is a modern serif with real character: soft, slightly warm, and collegiate without feeling old-fashioned. Instrument Sans is crisp and highly legible at small sizes (product types, size labels, chat). |

Details:
- **A real type scale.** The hero headline is up to about 78px with tight letter-spacing, page titles about 45px, section titles about 34px, and body text 16px with a 1.6 line height. Headings use `text-wrap: balance`, so they never end on a single orphaned word.
- **The italic "*Bulldog*"** in the hero is set in Fraunces italic and the sky-blue accent. It's the one playful typographic moment, and it ties the store to Yale's mascot.
- **Prices are set in the serif** with tabular figures, so they stand out from descriptions and line up neatly.
- **Labels** (eyebrows such as "BROWSE" and "STAFF PICKS", product types, table headers) use small uppercase with generous letter-spacing, a classic retail and collegiate-print touch. Section eyebrows get a short blue rule in front.

**Why it helps:** clear hierarchy lets shoppers skim (category, then name, then price) without reading every word. Distinctive type makes the store feel considered and trustworthy, which matters when people are about to buy.

---

## 2. Color and depth

- **Palette:**
  - Yale Blue `#00356b`
  - Deep navy `#071a33` (announcement bar, footer, hero shadows)
  - Lighter Yale blue `#286dc0` (links, accents, product types)
  - Sky `#8cbcf2` (highlights on dark backgrounds)
  - Cool, blue-tinted neutrals for backgrounds and lines, instead of flat greys
- **Stock colors stay meaningful:** green for in stock, amber for nearly gone, red for sold out. They're used only for availability, never for decoration, so they keep their meaning.
- **Depth:** a three-step shadow system (small, medium and large), tinted navy rather than black, so cards lift softly off the page. Hovered cards rise to the medium shadow, and the chat window and hero tiles use the large one.
- **Texture:** a very faint diagonal pinstripe in the hero, the family banner and the chat header, a nod to classic collegiate sweaters and pennants. It's only noticeable up close.

**Why it helps:** a consistent, restrained palette makes the important things (prices, buttons, stock) pop. Saving color for meaning means shoppers learn quickly that green means "you can buy this".

---

## 3. Layout

### Header
- Sticky with a frosted-glass background, so it stays readable over content. A soft shadow appears only after you scroll, so the header blends in at the top of a page and separates from the content once you're moving.
- Nav links get an underline that slides in on hover and stays under the current page.
- New **search shortcut** (magnifier icon) jumps straight to the shop and its search box.
- The logo mark is a glossy Yale-blue tile with a serif "CC" that tilts playfully on hover.
- On phones, the menu icon animates into an × and the menu drops down smoothly.

### Home page
- **Hero:** a two-column layout. On the left: the headline, a one-line pitch, two clear actions ("Shop all products" and the new **"Ask our assistant"**) and three quick facts (102 styles · XS-XXL · Live stock). On the right: a collage of three real products on tilted white cards that float gently. On phones, the collage tucks under the text.
- **Shop by category:** each tile now shows a representative product photo, not just a name, so customers can recognize categories at a glance.
- **Featured:** labeled "Staff picks", with the new product cards.
- **New "Ask our shopping assistant" band:** a short explanation of what the assistant can do, plus four **sample questions** ("What hoodies do you have?", "Anything with a bulldog on it?" and others). Clicking one opens the chat and asks it immediately.
- **Recently viewed** and the **family gifts banner** are restyled to match.
- **Footer:** deep navy with the logo mark, clear column headings in sky blue, and generous spacing.

### Shop page
- Roomier search and sort controls, category and size chips with clear active states, and a divider before the results.
- **Loading skeletons:** while products load, placeholder cards shimmer in the exact shape of the real ones, instead of a spinner. The page doesn't jump when the products arrive.

### Product page
- **The photo sits on a large rounded "plinth"** and stays in view (sticky) while you scroll through the details on desktop. **Hovering zooms the image** so customers can inspect details like embroidery.
- **Color swatches:** each color name ("navy blue", "heather gray") now has a small swatch dot next to it.
- The availability summary gets a gently pulsing status dot. Size buttons lift on hover and show their stock below the size.
- **New "Ask about sizing, colors or similar styles" button** opens the assistant already focused on this product. (The chat shows "Asking about: …".)
- The stock table has rounded corners, row hover highlights and aligned numbers.

### Other pages
- **About:** value cards with a Yale-blue top edge that lift on hover.
- **Log In and Create Account:** a centered card on a soft blue glow. Form errors give a tiny shake, so they're noticed.

**Why it helps:** a strong home page answers "what is this store and why should I care?" in seconds, and offers two clear next steps: browse or ask. Category photos and the assistant's sample questions lower the effort of getting started, which is where many visitors drop off.

---

## 4. Product presentation

Product cards appear everywhere (shop, home, recently viewed, the chat's results panel), so they got the most attention:
- **Photo "plinth":** each photo sits on a soft white-to-blue gradient, and white photo backgrounds blend into it (`mix-blend-mode: multiply`), so products look professionally shot on a consistent background. Photos with dark backgrounds get rounded corners, so they read as framed shots.
- **Hover:** the card lifts, its shadow deepens, the photo zooms slightly, and a "View details →" pill slides up. It's obvious the card is clickable and where it leads.
- **Information order:** product type (small, blue, uppercase), then name, then a two-line description, then **price (serif) beside the stock summary**, then size labels. The two things shoppers decide on, price and availability, sit on the same line.
- A **Sold out** badge in red, with a soft shadow, in the corner.
- **Staggered entrance:** cards fade up one after another as a grid appears, which draws the eye across the results.

**Why it helps:** consistent, clean product imagery builds trust and makes the catalogue feel curated. Hover feedback and a clear "View details" invite exploration. Showing price and stock together lets customers rule items in or out without clicking.

---

## 5. Chatbot appearance

The assistant was redesigned to feel like a friendly, trustworthy part of the store:
- **Launcher:** on desktop it's now a labeled pill, **"Ask our assistant"**, with a chat icon, instead of an unlabeled circle. It pops in shortly after the page loads and lifts on hover. On phones it stays a compact circle, and it turns into an × when the chat is open.
- **Window:** larger (390 × 600px), with 22px rounded corners, a deep layered shadow, and a quick scale-and-fade opening animation from the corner.
- **Header:** a Yale-blue gradient with the pinstripe texture, a round "CC" avatar with a green "available" dot, the assistant's name in the serif, and the saved or guest status underneath.
- **Messages:** assistant messages are white bubbles with a soft shadow, and product names in replies are highlighted in Yale blue. Customer messages are Yale-blue gradient bubbles. Each new message fades up gently. Typing shows three bouncing blue dots.
- **Product mini-cards** in the chat snap-scroll sideways and lift on hover. Photos sit on the same blue plinth as the shop cards.
- **Input:** a rounded field with a soft background that brightens on focus, and a round blue **send button with an arrow icon** (labeled "Send" for screen readers).
- **Context and suggestions:** "Asking about: …" sits in a light blue bar above the input. Suggested answers and starter questions are outlined blue chips that fill in on hover.
- **Opening from anywhere:** the hero button, the home page's sample questions and the product page's "Ask about…" button all open the chat. Sample questions are sent straight away, and the message box is focused when the chat opens.

**Why it helps:** a labeled, polished assistant gets noticed and used. People ignore anonymous chat bubbles. The assistant is the fastest route to the right product (it finds matches, checks sizes and suggests alternatives), so making it inviting directly helps people find and buy. Sample questions show visitors what to ask.

---

## 6. Motion and small details

| Detail | What it does | Why |
|---|---|---|
| Staggered card and tile entrance | Cards fade up in sequence | Guides the eye across a new grid of results |
| Card hover lift and photo zoom | Shows a card is clickable | Invites exploration |
| "View details →" pill on hover | Says where the click goes | Removes doubt before clicking |
| Floating hero tiles | A gentle seven-second bob | Makes the first screen feel alive without distraction |
| Header shadow on scroll | Separates the sticky header from content | Keeps navigation readable |
| Nav underline slide | Shows hover and the current page | Orientation |
| Product image zoom on hover | Inspect details | Replaces an in-store look |
| Pulsing availability dot | Draws attention to the stock summary | Answers "can I get it?" first |
| Skeleton shimmer while loading | Shows where products will appear | Feels faster, no layout jump |
| Chat pop-in, panel scale-in, message fade-up | Smooth chat interactions | Feels responsive and polished |
| Form error shake | Draws attention to the problem | Fewer abandoned sign-ups |
| Color swatches | Shows each color at a glance | Faster decisions |
| `font-variant-numeric: tabular-nums` | Prices and stock numbers line up | Easier comparison |

**Accessibility built in:**
- **Reduce motion:** with "reduce motion" turned on in the device settings, all entrance, hover-lift, float, shimmer and pulse animations are switched off, and content appears immediately at full opacity. A test checks this.
- **Visible focus:** every link, button and input shows a clear blue focus ring when using the keyboard. A test checks this too.
- **Status in words:** status is never shown by color alone. Sold-out sizes are also crossed out and labeled, and buttons and icons have accessible names ("Send", "Search the shop", "Open chat").
- **Phones:** layouts reflow for phones with no sideways scrolling, and the chat and header respect phone safe areas.

---

## What stayed the same

Every feature from Problems 3-9 works exactly as before:
- browsing, search, filters, sorting and size filtering,
- product pages with live stock,
- accounts and login,
- the assistant (tools, price check, page results, memory, "this" context, similar products, suggested answers),
- recently viewed.

All the class names and labels the features and tests rely on were kept. Only the visual layer and a few additions changed: the "Ask our assistant" buttons, sample questions, color swatches, the search shortcut, skeletons and the chat avatar.

## Testing

- **Automated:**
  - 92 backend tests pass (unchanged).
  - 31 frontend tests pass, 3 of them new: sample questions open the chat and send the question; the hero and product-page buttons open the assistant (with the product as context, and without sending anything); and the search shortcut and color swatches render.
  - Lint, typecheck and the production build are clean.
- **In a browser:** all six earlier browser suites were rerun against the new design and pass: pages, accounts, chat, results panel, memory and Problem 9.
  - Two test scripts needed updating because the new home page added a second "What hoodies do you have?" button (the sample question), so the scripts now look inside the chat window specifically. This was not a bug in the site.
- **Visual review:** screenshots were taken of every page at desktop (1440px) and phone (390px) widths and reviewed. That review led to these fixes:
  - The third hero tile was hidden, so the collage was rebalanced.
  - Dark-background photos looked like boxes, so they now have rounded corners.
  - Size labels wrapped in narrow cards, so they were tightened.
- **Fonts:** both Fraunces and Instrument Sans load. There is no sideways scrolling at either width, and there were no errors.
- **Accessibility:** with reduced motion, all cards are fully visible immediately and the hero stops floating. Keyboard focus shows a visible ring.

## Files changed

| File | What changed |
|---|---|
| `frontend/index.html` | New fonts (Fraunces and Instrument Sans) and the theme color |
| `frontend/src/index.css` | Rewritten design system: tokens, type, components, motion and reduced motion |
| `frontend/src/pages/Home.tsx` | New hero with collage and facts, category photos, assistant band with sample questions, skeleton loading |
| `frontend/src/pages/ProductPage.tsx` | Color swatches and the "Ask about…" button |
| `frontend/src/pages/Products.tsx` | Skeleton loading and staggered cards |
| `frontend/src/components/ProductCard.tsx` | "View details" hover pill and entrance stagger |
| `frontend/src/components/ChatWidget.tsx` | Labeled launcher, avatar header, icon send button, focus on open, opens from anywhere |
| `frontend/src/components/Header.tsx` | Shadow on scroll and the search shortcut |
| `frontend/src/components/Footer.tsx` | Logo mark |
| `frontend/src/components/Skeleton.tsx` | New: shimmering placeholder cards |
| `frontend/src/chatEvents.ts` | New: lets any part of the page open (and ask) the assistant |
