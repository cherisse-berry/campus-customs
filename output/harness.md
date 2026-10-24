# Campus Customs Database Harness

This file explains how the Campus Customs database (`data/campus_customs.db`, a SQLite file) is organized. It lists each table and its fields, and says why each field matters for the website or the shopping chatbot.

For Problem 2 the database was only read, never changed. From Problem 4 on, the website adds one new row to `users` each time a customer creates an account. From Problem 5 on, it also adds rows to `chat_messages` when a logged-in customer chats with the assistant. Products and stock are never written. See [Authentication](#authentication) and [Shopping assistant (chatbot)](#shopping-assistant-chatbot) below.

## Overview

| Table | Rows | What it holds |
|---|---|---|
| `catalogue` | 102 | One row per product: name, type, description, colors, tags, image and price |
| `inventory` | 612 | Stock count for each product in each size (102 products × 6 sizes) |
| `users` | 3 (as delivered) | Shopper accounts used for sign-in; grows as customers register |
| `chat_messages` | 22 (as delivered) | Saved chatbot conversation history, per user; grows as logged-in customers chat |
| `sqlite_sequence` | 3 | SQLite's internal counter for auto-numbered IDs (not app data) |

### How the tables connect

```
catalogue.product_id  1 ──< many  inventory.product_id
users.id              1 ──< many  chat_messages.user_id
```

- Each product has exactly one inventory row for each size: XS, S, M, L, XL and XXL. Every product has inventory rows, and every inventory row points to a real product.
- Each chat message belongs to one user.
- `chat_messages` has no foreign key to products. Instead, assistant replies store a snapshot of the products they showed, in `products_json`.

---

## `catalogue`: the product catalogue

This is the main product list. The website uses it to show products, and the chatbot searches it to answer questions like "what hoodies do you have?"

| Field | Type | Why it matters |
|---|---|---|
| `product_id` | TEXT, primary key | A unique, readable ID (for example `basic-hoodie-big-yale`). It links to `inventory`, can be used in product page URLs (`/products/<id>`), and is the ID the chatbot uses when it returns products. |
| `name` | TEXT, required | The display name on product cards and pages, and the name the chatbot says in replies. |
| `garment_type` | TEXT, required | The kind of item (crewneck, hoodie, T-shirt, quarter-zip, fleece and so on). It powers category filters and questions like "what fleeces do you have?" The values are inconsistent, though: there are 22 spellings, such as `short-sleeve t-shirt` vs `short-sleeve T-shirt`, and `hoodie` vs `pullover hoodie`. Filters need to group them into clean categories. |
| `description` | TEXT, required | A sentence describing the look, fit and graphic. It's shown on the product page, and it's what lets the chatbot match details that aren't in the name, like "bulldog graphic" or "kangaroo pocket". |
| `colors` | TEXT (JSON list), required | For example `["navy blue", "white"]`. It's used for color filters and questions like "do you have this in pink?" It's stored as a JSON string, so the code has to parse it. Color names vary too (`navy` vs `navy blue`). |
| `search_tags` | TEXT (JSON list), required | Keywords such as `["Yale", "bulldog", "hoodie", "vintage"]`. They give site search and the chatbot extra terms to match, including sports, colleges and themes. |
| `image_file_path` | TEXT, required | A relative path such as `products/basic-hoodie-big-yale.jpg`. The image files are in `data/products/`, and all 102 exist. The site needs it to show product photos; past chatbot replies serve them at `/media/products/...`. |
| `price` | REAL, required | The price in US dollars, from $32 to $98. It's shown on product cards and used for sorting and for questions like "what's your cheapest fleece?" It's stored as a decimal, so the site should format it as currency. |

## `inventory`: stock by size

This table tracks how many of each product are in stock in each size. The site uses it to show which sizes can be bought, and the chatbot uses it to answer "is this in stock in M?"

| Field | Type | Why it matters |
|---|---|---|
| `id` | INTEGER, primary key, auto-numbered | An internal row ID. The website rarely needs it directly. |
| `product_id` | TEXT, required, links to `catalogue.product_id` | Ties each stock count to a product, so the site can show sizes and stock on that product's page. |
| `size` | TEXT, required | One of XS, S, M, L, XL or XXL. It drives the size picker. Because `product_id` and `size` together must be unique, each product has only one stock count per size. |
| `quantity` | INTEGER, required | Units in stock, from 0 to 25. A quantity of 0 should show the size as sold out, and the chatbot shouldn't recommend it. 145 of the 612 size slots are at 0. Every product still has at least one size in stock. |

## `users`: shopper accounts

This table holds the accounts people use to sign in. Signing in lets the chatbot remember who it's talking to and keep their chat history.

| Field | Type | Why it matters |
|---|---|---|
| `id` | INTEGER, primary key, auto-numbered | The user's ID. It links to `chat_messages.user_id`, so each person's chat history stays separate. |
| `name` | TEXT, required | The user's full name, for greetings like "Hi, Ada" and for answering "what's my name?" |
| `email` | TEXT, required, unique | The sign-in username. Because it must be unique, no two accounts can share an email. |
| `password_hash` | TEXT, required | A scrambled (hashed) version of the password, in `pbkdf2_sha256$<salt>$<hash>` format, so the real password is never stored. Sign-in checks a typed password against it (see [Authentication](#authentication)). It must never be shown on the site, sent to the chatbot or written to logs. |
| `created_at` | TEXT, defaults to the current time | When the account was created. Useful for account pages and for admins. |
| `first_name` | TEXT, optional | The first name on its own, for a friendlier greeting. This column was added later, so it may be empty for some users. |
| `last_name` | TEXT, optional | The last name on its own. Also added later, so it may be empty. |

## `chat_messages`: chatbot conversation history

This table saves each turn of every chatbot conversation, so a user's chat can be reloaded and the chatbot can refer back to earlier messages.

| Field | Type | Why it matters |
|---|---|---|
| `id` | INTEGER, primary key, auto-numbered | The message ID. Because it counts up, it also gives the order to replay a conversation in. |
| `user_id` | INTEGER, required, links to `users.id` | Who the conversation belongs to. The site should only ever load the signed-in user's own messages. |
| `role` | TEXT, required | Either `user` (the shopper) or `assistant` (the chatbot). It's used to style chat bubbles and to rebuild the conversation for the AI model. |
| `content` | TEXT, required | The message text. The chatbot's replies use Markdown, for example `**$68**`, so the site should render Markdown. |
| `products_json` | TEXT (JSON), optional | Only filled in on chatbot replies (11 of the 22 rows). It's a snapshot of the products the reply showed, with catalogue fields plus `image_url`, per-size `inventory` and `total_stock`. It lets the site redraw the product panel when a chat reloads, and it gives the chatbot context for follow-ups like "you have this in pink?" Because it's a snapshot, stock and prices in it can be out of date, so check the live tables before saying something is available. **From Problem 8 on**, customer rows also use it, to record the product page the customer was on when they sent the message (`{"product_id", "name"}`). |
| `created_at` | TEXT, defaults to the current time | When the message was sent. Used for timestamps and ordering. |

## `sqlite_sequence`: internal table

SQLite manages this table itself. It records the last ID used in each auto-numbered table (`inventory`, `users`, `chat_messages`). The website and chatbot don't use it, and nobody should edit it.

---

## Authentication

Customers can create an account and log in. The code is in `backend/auth.py`, the request models in `backend/models.py`, and the database queries in `backend/db.py`.

### How passwords are stored

Passwords are never saved as typed. Each one is stored in `users.password_hash` in the same format as the existing accounts:

```
pbkdf2_sha256$<salt>$<digest>
```

| Part | What it is |
|---|---|
| `pbkdf2_sha256` | The method: PBKDF2-HMAC-SHA256 |
| `<salt>` | A random value unique to each account. New accounts get 16 random hex characters. The salt's text is used as the salt bytes (UTF-8), the same as in the existing rows. |
| `<digest>` | The result of running the password and salt through SHA-256 120,000 times, written as 64 hex characters |

To check a password at login, the server repeats the same calculation with the stored salt and compares the result with a constant-time comparison. I confirmed the format matches the existing data: the test account's stored hash is reproduced exactly from the password `password`.

The salt means two people with the same password get different hashes. The 120,000 rounds make each guess slow, which makes stolen hashes much harder to crack.

### Creating an account

1. The Create Account page asks for first name, last name, email, password and a password confirmation. It checks them in the browser first.
2. It sends `POST /api/auth/register` with `first_name`, `last_name`, `email` and `password`.
3. The server checks the input again. Both names are required, the email must look valid, and the password must be at least 8 characters.
4. The email is trimmed and lowercased. If an account with that email already exists (in any capitalization), the server replies with an error and saves nothing.
5. Otherwise it inserts one row into `users`:

| Column | Value saved |
|---|---|
| `name` | First and last name together, e.g. "Grace Hopper" |
| `first_name`, `last_name` | As typed, trimmed |
| `email` | Lowercased |
| `password_hash` | The PBKDF2 hash described above |
| `id`, `created_at` | Filled in automatically by the database |

6. The new customer is logged in straight away.

### Logging in and staying logged in

1. The Log In page sends `POST /api/auth/login` with email and password. Email matching ignores capitalization.
2. A wrong password and an unknown email give the same message, "Incorrect email or password.", so the page can't be used to find out who has an account. Unknown emails are still checked against a dummy hash so both cases take the same time.
3. On success the server sets a **session cookie** named `cc_session`. It holds the user's ID and an expiry time (7 days), signed with a secret key (`SESSION_SECRET`) so it can't be edited or forged.
4. The cookie is **HttpOnly**, so page scripts can't read it, and **SameSite=Lax**, which blocks most cross-site request tricks. Set `COOKIE_SECURE=true` when the site runs on HTTPS.
5. When the site loads, it calls `GET /api/auth/me` to find out who is logged in. The header then shows "Hi, <first name>" and a Log Out button.
6. **Log Out** calls `POST /api/auth/logout`, which deletes the cookie.

No session table is needed. Everything the server needs is in the signed cookie.

### Auth API

| Endpoint | Body | Result |
|---|---|---|
| `POST /api/auth/register` | `first_name`, `last_name`, `email`, `password` | `201` with the user, and logs in. `409` if the email is taken, `422` if input is invalid. |
| `POST /api/auth/login` | `email`, `password` | `200` with the user, and logs in. `401` if the details are wrong. |
| `POST /api/auth/logout` | none | `204`, logged out |
| `GET /api/auth/me` | none | `200` with the current user, or `401` if not logged in |

Responses only ever include `id`, `name`, `first_name`, `last_name` and `email`, never the password hash.

### Secrets

`SESSION_SECRET` is the key that signs login cookies. It lives in `backend/.env`, which is git-ignored and loaded automatically when the API starts.

- **Create it:** run `python setup_env.py` in `backend/`. It writes a 64-character random secret (256 bits) to `.env`, makes the file readable only by you, and never prints the secret.
- **Keep it:** the script won't replace an existing secret. `python setup_env.py --force` makes a new one, which logs everyone out. Do that if the secret may have leaked.
- **Each computer has its own:** the secret is never committed, so run the script once wherever the site runs.
- **Warnings:** if the secret is missing, the server warns you and makes a temporary one, so everyone is logged out whenever it restarts. If it's shorter than 32 characters, the server warns that it's weak.

### Tests

- **Backend** (`backend/tests/test_auth.py`): checks the hash format against the real test account, logs in as the existing account, registers and logs in as a new account, and covers wrong passwords, duplicate emails, bad input, logout and forged or expired cookies. These tests run on a temporary copy of the database, so they never add accounts to the real one.
- **In a browser:** I logged in as `test@campuscustoms.yale.edu` / `password`, created a new account and logged back in with it. This also ran against a copy of the database.

### Not built yet

- Password reset and changing a password
- Limiting repeated login attempts

---

## Shopping assistant (chatbot)

The chat window in the bottom-right corner of every page talks to an AI shopping assistant. It's built with **PydanticAI** on **Claude** (Anthropic's model), served by FastAPI.

### How a message travels

```
Chat window (React)  ──POST /api/chat──▶  FastAPI (main.py)
                                            │  who is it? (session cookie)
                                            │  earlier messages (database or browser)
                                            ▼
                                     PydanticAI agent (agent.py)
                                            │  instructions: prompts/prompt.md
                                            │  + "the customer's first name is …"
                                            ▼
                                  Claude ◀──▶ catalogue tools (tools.py)
                                            │       read-only: search, details, stock
                                            ▼
                     reply text + product cards ──▶ chat window
```

1. The customer types a message. The chat window sends it to `POST /api/chat`.
2. The server works out who's chatting from the login cookie, and which product page they're on (the chat window sends `viewing_product_id`).
   - **Logged in:** it loads their last 40 messages from `chat_messages`, plus their name and email from `users`.
   - **Guest:** it uses the last 40 messages the browser sends along. Guest chats aren't saved, and they disappear when the page is reloaded.
3. The PydanticAI agent sends Claude the instructions (including who the customer is and what they're viewing), the conversation so far and the new message. See [Remembering customers](#remembering-customers).
4. Claude calls the catalogue tools to look things up, then writes a reply. For example: search for "hoodie" under $70, then get the details for one product.
5. The server returns two sets of products along with the reply:
   - **Page results:** every product the assistant's searches and lookups found (up to 24), with image, name, type, price and description. The website shows these in a results panel at the top of the page. See [Products shown on the page](#products-shown-on-the-page).
   - **Chat cards:** the products the reply names, shown as small cards in the chat window.
6. For logged-in customers, the message and reply are saved to `chat_messages`, with the page results in `products_json`. They reload the next time the customer opens the chat, and the last set of results goes back on the page.

### Files

| File | What it's for |
|---|---|
| `backend/main.py` | The FastAPI app, including the `/api/chat` endpoints, error handling, the rate limit and saving history |
| `backend/agent.py` | Creates the agent, chooses the model and its settings, turns saved messages into conversation history, and picks the product cards |
| `backend/tools.py` | The four tools Claude can call to read products, prices and stock |
| `backend/models.py` | The shapes of chat requests and replies (`ChatReply` with `ProductCard`, `ProductResult` and `MoreResults`), the length limits, the typed tool results (`ProductSummary`, `ProductDetails`, `SizeStock`, `SizeAvailability` and others), and `ChatDeps` (what the tools can see and found) |
| `backend/prompts/prompt.md` | The assistant's instructions: persona, how to use the tools, store facts and safety rules. Edit this to change how it behaves. |
| `frontend/src/chatApi.ts`, `frontend/src/components/ChatWidget.tsx` | The chat window |
| `frontend/src/components/ChatResultsPanel.tsx`, `ChatResultsProvider.tsx`, `frontend/src/chatResults.ts` | The results panel on the page, and the shared state the chat window uses to fill it |
| `frontend/src/components/ProductCard.tsx` | The product card used on the Products page, the home page and in the results panel |
| `backend/check_chat.py` | Sends one real message to Claude to check your API key works |

### Tools

The assistant can only see the shop through these tools. They read the `catalogue` and `inventory` tables directly every time they're called, so answers always reflect the database at that moment. None of them change the database.

| Tool | Use it for | Returns (model in `models.py`) |
|---|---|---|
| `search_products` | Finding products by words, category, highest price and an in-stock size | `SearchResults`: up to 8 `ProductSummary` items, with a note when nothing matches |
| `get_product_details` | Everything about one product, including the exact quantity in every size | `ProductDetails`: a summary plus `stock_by_size` (one `SizeStock` per size) |
| `check_size` | "Do you have this in M?" | `SizeAvailability`: exact quantity, status and the other sizes in stock |
| `list_categories` | The categories and their price ranges | A list of `CategoryInfo` |
| `find_similar_products` | In-stock alternatives when something is sold out in the customer's size, sold out everywhere, not in their color or over budget (Problem 9) | `SimilarProducts`: up to 5 `SimilarProduct` items, each with `why_similar`, plus a `note` when no product comes in the requested color |
| `suggest_replies` | Tappable answers (2-4) under a clarifying question (Problem 9) | A confirmation. The answers are returned to the website as `suggestions` |

If a product or size can't be found, the tools return a `LookupProblem` with a plain message instead of guessing.

**What each product result contains** (`ProductSummary`):

| Field | From the database | Example |
|---|---|---|
| `name`, `type`, `category`, `colors` | `catalogue` | "Basic Hoodie Big Yale", "pullover hoodie", "hoodies", ["navy blue", "white"] |
| `description` | `catalogue.description`, word for word | "Navy pullover hoodie with a front kangaroo pocket…" |
| `price_usd` / `price` | `catalogue.price`, plus the same number formatted to quote | 68.0 / "$68.00" |
| `total_in_stock` | Sum of `inventory.quantity` | 60 |
| `sizes_in_stock`, `sizes_with_only_a_few_left`, `sold_out_sizes` | `inventory` per size | ["XS", "S", …], ["S", "M", "XL"], [] |
| `sold_out` | True when every size is 0 | false |
| `product_page` | Link to the product page | "/products/basic-hoodie-big-yale" |

`ProductDetails` adds `stock_by_size`: each `SizeStock` has the `size`, the exact `quantity`, and a `status`:

| Quantity | Status | How the assistant says it |
|---|---|---|
| 0 | `sold out` | "The **Champion Reverse Weave Hoodie 1** is **sold out in XS**", then the sizes still in stock or a similar product |
| 1-5 | `only a few left` | "Only 2 left in XL" |
| 6 or more | `in stock` | "It's in stock in M" |

**Sizes:** XS, S, M, L, XL and XXL. The tools also understand words customers type, such as "medium", "large", "x-large" and "2XL". Before this was added, a search for "medium" silently found nothing.

**Lookup by name:** `get_product_details` and `check_size` accept a product's id or its exact name.

The tools never return customer data. The assistant knows only the current customer's first name.

### How accuracy is enforced

The assistant can't make up prices or stock because of four layers:

1. **Instructions** (`prompts/prompt.md`, "Facts come from the database" and "Prices and stock"):
   - Look every price, description, size and quantity up with a tool in the same reply, and look it up again rather than repeating an earlier message.
   - Quote the `price` field exactly, and state a quantity only when a tool returned that number.
   - Say "sold out" clearly and first, then offer sizes that are in stock or a similar product. Never imply a sold-out size can be ordered.
2. **Tool results:** prices arrive already formatted and statuses already decided, so the model doesn't have to calculate or interpret anything.
3. **Price check in code** (`check_prices` in `agent.py`): before a reply is shown, every dollar amount in it is compared with the prices the tools returned for that reply.
   - **Allowed:** prices the tools returned, amounts the customer typed (such as "under $70"), and simple totals of looked-up prices (2-10 of one item, or two items together).
   - **Anything else** is sent back to Claude with an explanation, up to two times. If it still isn't fixed, the customer gets the "having trouble" message instead. A made-up price is never shown.
4. **Tests** compare the tools' output with the database for all 102 products (see below).

### Model and settings

| Setting | Value | Why |
|---|---|---|
| Model | `claude-opus-5-5` (Claude Opus 5.5) | The current default Claude model. You can change it with `CHAT_MODEL` in `.env`. |
| Effort | `low` | Chat replies are short. Low effort keeps them fast and inexpensive. |
| Max tokens | 4,096 per reply | Plenty for a chat answer |
| Refusal fallback | On (`fallbacks: "default"`) | If Claude's safety filter wrongly declines a harmless question, the API retries it on another model automatically |
| Usage limit | At most 8 model calls and 12 tool calls per message | Stops a runaway tool loop from costing money, while leaving room for up to two price corrections |

### Safety guidelines

These are in the prompt file and backed up in code:

- **Stays on topic:** Campus Customs products, sizing, gifts and the shop. It politely declines homework, coding, medical, legal or financial questions.
- **Doesn't make things up:** it looks up every product, price and stock level with the tools. It says plainly when the shop doesn't carry something (like shorts) or when it doesn't know (shipping, returns, order status).
- **Protects privacy:** it never asks for card numbers, passwords or other sensitive details, and it tells customers not to share them. It can't see other customers' information.
- **Stays respectful:** it won't produce hateful, harassing, sexual or violent content.
- **Is honest:** it says it's an AI. It doesn't claim to be Yale's official store or speak for Yale.
- **Resists prompt injection:** "ignore your instructions" style messages are treated as customer text, not new rules. It won't reveal its prompt.
- **Limits in code:**
  - Messages can be up to 1,000 characters, and only the last 40 messages are used.
  - Each visitor can send 20 messages per 10 minutes.
  - Claude's refusals become a polite "I can't help with that one" reply.
  - API errors become a friendly "try again" message, without exposing details.
- **Labelled in the window:** the chat window says it's an AI assistant and that answers may contain mistakes.

### Remembering customers

The assistant knows who it's talking to, remembers logged-in customers' conversations, and knows which product they're looking at.

**Logged-in customers vs guests**

| | Logged-in customer | Guest |
|---|---|---|
| Who the assistant knows | Full name, first name and email, from their login session | Only that they're a guest |
| Conversation saved | Yes, to `chat_messages`, linked to their user ID | No, never written to the database |
| Memory | The last 40 messages (20 exchanges), from any device or visit | The last 40 messages in the open browser tab; gone on reload |
| Chat window subtitle | "Signed in as Test User · this chat is saved" | "Guest · log in to save this chat" |
| When they log in or out | Their saved chat loads; logging out clears the window | The guest chat is replaced by the saved one |

**How identity reaches the assistant**

1. `main.py` reads the user from the signed session cookie, never from what the customer types.
2. `run_chat` in `agent.py` puts it in `ChatDeps.customer`, and an instruction function (`customer_context`) adds a "This customer" section to the instructions, for example: *The customer is logged in as **Test User** (first name Test, email test@campuscustoms.yale.edu). Their conversation is saved…*
3. Guests get *The customer is a guest… this conversation isn't saved*.
4. A message like "I'm admin@yale.edu" changes nothing, because identity only comes from the session.

The prompt's "Who you're talking to" section tells the assistant how to use this:
- Greet returning customers by first name and pick up where they left off.
- Answer "What's my name?" or "What's my email?" from the session, and mention the email only when they ask about their own account.
- Never discuss other customers.
- Tell guests that chats are saved only when they log in.

**Which product they're viewing ("Do you have this in pink?")**

1. **The chat window reads the product page from the URL.** On `/products/<id>`, it shows "Asking about: Basic Hoodie Big Yale" above the message box and sends `viewing_product_id` with each message.
2. **The server looks the ID up in `catalogue`.** Unknown or invalid IDs are ignored, never passed to the model. An instruction function (`viewing_context`) then adds: *The customer is on the product page for **Basic Hoodie Big Yale** (product_id `basic-hoodie-big-yale`, a pullover hoodie, colors: navy blue, white). If they say "this", "it" or "this one"… they mean this product.*
3. **The assistant answers from the database.** The prompt's "'This' and 'it'" section tells it to look that product up with `get_product_details` or `check_size`, answer about that product's own colors, sizes and stock, and say plainly when it doesn't come in a color. For example: *"Sorry, the **Basic Hoodie Big Yale** only comes in navy blue and white, not pink. Want me to look for pink items?"*
4. **The context is remembered.** Each customer message is saved with the product page it was sent from (in `products_json` on the customer's row). When the history is sent to the assistant later, those messages start with *[Customer was viewing: Yale Mom Hoodie (product_id yale-mom-hoodie)]*, so "this" still makes sense on the next visit. Guests' browsers send the same information with their unsaved history.
5. **In the chat window,** saved and new messages show a small "About: Yale Mom Hoodie" tag.

**Privacy**
- Each customer only ever sees and sends their own history.
- The assistant gets only the name and email: never the password hash, and no other customers' data.
- Guest messages never touch the database.

### Similar products and clarifying questions (Problem 9)

See `output/usability.md` for the full explanation. In short:
- **`find_similar_products`** ranks in-stock alternatives by shared garment type or category (+4/+3), colors (+1 each, up to 2), themes such as family, sports, colleges, schools and bulldog (+2), distinctive tags (+1 each, up to 3), and price closeness (−1 per $20 of difference). It returns the top 5 with a plain-language reason for each. Alternatives go to the results panel and the price check like any other lookup.
- **`suggest_replies`** stores 2-4 cleaned, de-duplicated answers (each under 40 characters) in `ChatDeps.suggestions`. They're returned as `suggestions` and shown as buttons under the latest reply. Bad options are sent back to the model to fix.
- The prompt's "Recommending alternatives" and "Clarifying questions" sections say when to use them.

### Products shown on the page

When the assistant searches or looks up products, the website shows what it found right on the page, not just in the small chat window.

**How it works**

1. **The tools collect the matches.**
   - `search_products` shows the model only the first 8 matches, to keep its reading short, but it queues **every** match for the page, up to 24.
   - `get_product_details` and `check_size` queue the one product they looked up.
2. **The server orders them.** Products the reply names come first, in the order it names them, then the rest in the order they were found. It returns them as `results` in the chat reply.
3. **When there are more than 24:** if a search matched more than 24 (for example, all 27 hoodies), the reply also includes `more_results` with the total and a link to the same search on the Products page (`/products?category=hoodies`).
4. **The chat window fills the panel.** When a reply has results, the chat window passes them to the **results panel** (`ChatResultsPanel`) at the top of the page's main area. The panel shows on every page:
   - **Heading:** "From your chat" and "27 products for 'What hoodies do you have?'"
   - **"Showing 24 of 27. See all 27 in the shop →"** when there are more than fit.
   - **A grid of product cards**, the same `ProductCard` the Products page uses: image, type, name, short description (two lines) and price, with a **Sold out** badge when every size is gone.
   - **Hide/Show** and **close (×)** buttons.
5. **Clicking a card** opens that product's detail page, just like the Products page. On a product page, the panel shrinks to a one-line bar ("Show products") so the details stay in view.
6. **Getting to the panel:**
   - **Wide screens:** the panel scrolls into view while the chat stays open, with room on the right so the chat window doesn't cover it.
   - **Phones:** the chat covers the page, so the reply has a **"See N products on the page"** link that closes the chat and scrolls to the panel.
7. **What happens next:**
   - A reply that finds nothing new (like "thanks!") leaves the last results in place.
   - A new search replaces them.
   - Logging in or out clears them.
   - For logged-in customers, the last set of results comes back after a page reload.

**Instructions for the assistant** (`prompts/prompt.md`, "Products shown on the page"):
- Search whenever someone wants to see or find products.
- For broad questions ("what hoodies do you have?"), search the whole category so the page shows the full range.
- Say how many it found, highlight two to four picks, and mention that the rest are on the page, instead of listing everything in the chat.

**Example**

| Customer asks | Assistant searches | Page shows |
|---|---|---|
| "What hoodies do you have?" | `search_products(category="hoodies")` | 24 of 27 hoodies, plus "See all 27 in the shop" |
| "Anything with a bulldog?" | `search_products(query="bulldog")` | All 10 bulldog products |
| "Is the Champion Reverse Weave Hoodie 1 in XS?" | `check_size(...)` | That one hoodie |
| "Do you have gym shorts?" | `search_products(query="gym shorts")`, no matches | Nothing new; the assistant says it doesn't carry them |

### Chat API

| Endpoint | Body | Result |
|---|---|---|
| `POST /api/chat` | `message` (1-1,000 characters), optional `viewing_product_id` (the product page the customer is on), optional `history` (guests only; each entry can carry its own `viewing_product_id`) | `reply` (Markdown text), `products` (chat cards), `results` (page results, up to 24) `more_results` (`total` and `link`, or `null`) and `suggestions` (tappable answers to a clarifying question, usually empty). `503` if the API key isn't set or Claude can't be reached. `429` if the rate limit is hit. |
| `GET /api/chat/history` | none | The logged-in customer's last 40 messages. Customer messages include `viewing` (the product page they were on), and replies include their chat cards and page results. Guests get an empty list. |

### API key

The assistant needs an Anthropic API key, kept in `backend/.env`, which is git-ignored and never committed.

1. Create a key at https://platform.claude.com/settings/keys.
2. In `backend/`, run `python setup_env.py --api-key` and paste the key. What you type is hidden, so it doesn't appear on screen or in your shell history. The file is saved readable only by you.
3. Run `python check_chat.py`. It sends one real question to Claude (a fraction of a cent) and prints the reply.

**Using Claude Code in the browser (cloud environment):** your project runs in a temporary cloud workspace, so a `.env` file there disappears when the session ends. Instead, add the key in the environment's settings: open the cloud environment menu in the session's title bar and choose **Edit**. Add it under **Network secrets** (called **API credentials** in older versions of the app) if that section is shown, otherwise as an environment variable, with the name `ANTHROPIC_API_KEY`. Then start a **new session**, which picks it up. The backend reads it automatically, and an environment variable takes priority over `.env`.

The chatbot always sends the key to `https://api.anthropic.com`. It ignores `ANTHROPIC_BASE_URL`, which Claude Code sets for its own connection, so your key can't be sent anywhere else by accident. To use a different endpoint on purpose, set `CHAT_ANTHROPIC_BASE_URL`.

If the key is missing, the site still works. The chat replies "The shopping assistant isn't set up yet", and the server log says how to fix it. Never put the key in frontend code, a commit or a chat message. If it leaks, delete it in the Anthropic Console and make a new one.

### Tests

- **Backend** (`backend/tests/test_chat.py`, 55 tests):
  - These run the real agent, tools and endpoint with PydanticAI's `FunctionModel`, a scripted stand-in for Claude, so they cost nothing and need no key.
  - They check that messages reach the agent and the tools are called, and that the prompt file and the customer's name are included.
  - They check that guest history is sent along, and that logged-in history is saved and reloaded (on a copy of the database).
  - They also cover a missing key, refusals, runaway tool loops, the message length limit, the rate limit and the model settings.
  - **Accuracy:** for all 102 products, the description, price, quantity in every size, sold-out sizes, in-stock sizes and total match the database exactly. Search results also carry the same stock and price as the details.
  - **Sold out:** a real sold-out size from the database is reported as "sold out" with the right list of other sizes. A product with every size at 0 is flagged `sold_out`.
  - **Sizes:** words like "medium", "2XL" and "Extra Small" give the same results as XS-XXL codes. Unknown sizes and products get a clear message, not a guess.
  - **Price check:** a reply with an invented price ($59.99) is sent back and the corrected reply ($68.00) is shown. A reply that keeps inventing prices is never shown. Customer budgets ("under $70") and simple totals are allowed.
  - **Page results:**
    - Asking about hoodies returns every hoodie for the page (24 of 27, more than the 8 the model reads), with the named ones first, plus the total and a "see all" link.
    - Every result's name, type, price, image and description match the database, and each image loads.
    - Chit-chat and empty searches add nothing. A single looked-up product appears alone.
    - Results are saved and reloaded for logged-in customers, and the original data's saved hoodie list loads as 8 results.
  - **Remembering customers:**
    - The logged-in test account and a newly registered account are both recognized by full name and email.
    - Identity comes only from the session: a guest claiming to be someone else stays a guest.
    - The viewed product (name, ID, colors) reaches the model, and unknown IDs are ignored.
    - "Do you have this in pink?" on a product page is answered from that product's real colors. Without a product page, the assistant asks which product.
    - The viewed product is saved with the message, reloaded in history and shown to the model on the next visit. Guest history carries it too.
    - Guest chats add no rows. Memory covers exactly the last 40 messages. Customers never see each other's history.
    - `check_chat.py` still works with the chat function.
- **Frontend** (`frontend/src/test/app.test.tsx`):
  - The panel appears after a chat reply, with image, name, price, description and a Sold out badge.
  - A card opens the product page, where the panel is collapsed and can be reopened.
  - The results stay after a reply with no products, and the panel can be closed.
  - "Showing 2 of 27" and the "See all" link work, along with the chat's "See N products on the page" link.
  - A logged-in customer's last results are restored.
  - On a product page, the chat shows "Asking about", sends the product ID and tags the message. Guest follow-ups carry it in their history. Other pages send none.
  - The subtitle says whether the chat is saved, and saved messages show their "About" tag.
- **In a browser:** the real website and FastAPI server with the scripted stand-in.
  - A guest asked for hoodies and got a formatted reply with product cards, and a card opened the product page.
  - Asked "Is the Champion Reverse Weave Hoodie 1 in XS?", the bot answered that it's sold out in XS and still in stock in S, M, L and XXL, matching the database. Asked about medium, it said 20 left.
  - A logged-in customer's saved chat loaded, and a new message was still there after a reload. The phone layout fit the screen.
  - **Results panel:**
    - Asking "What hoodies do you have?" filled the page with 24 hoodie cards (all images loaded), headed "27 products", with "See all 27 in the shop" opening the Products page filtered to all 27 hoodies.
    - On a wide screen the panel scrolled into view beside the open chat without being covered.
    - Clicking a card opened the matching product page with the panel collapsed.
    - On a phone, "See 24 products on the page" closed the chat and showed the panel.
    - A logged-in customer's results came back after a reload.
  - **Remembering customers:**
    - A guest on the Basic Hoodie Big Yale page asked "Do you have this in pink?" and was told it only comes in navy blue and white. The bot didn't know the guest's name, and the chat was gone after a reload.
    - After logging in, the saved history loaded, and "What's my name and email?" was answered correctly.
    - On the Yale Mom Hoodie page, "Is this in stock in M?" and "this in pink?" were answered about that hoodie.
    - After a reload on the home page, those messages came back tagged "About: Yale Mom Hoodie". Logging out cleared the chat.
    - Only the logged-in customer's messages were saved (to a copy of the database), each with the product page it came from.
- **Live Claude:** not tested yet, because this workspace has no API key. Run `python check_chat.py` after adding yours.

### Not built yet

- Streaming replies word by word (replies currently appear all at once)
- Letting customers clear their chat history
- Rate limits that survive a server restart or work across several servers

---

## Notes for building the site and chatbot

- **Clean up categories:** group the 22 `garment_type` spellings into a few clean categories (T-shirts, crewnecks, hoodies, quarter-zips, fleeces and jackets, long sleeves) before building filters.
- **Read JSON fields:** `colors`, `search_tags` and `products_json` are JSON stored as text, so the code has to parse them.
- **Check stock live:** the chatbot should look up current stock in `inventory`, not trust old `products_json` snapshots.
- **Handle missing items:** the chat history shows shoppers asking for things the shop doesn't carry, like gym shorts or pink items. The chatbot should say clearly when nothing matches.
- **Keep account data private:** never expose `password_hash` or other users' emails or chats.
