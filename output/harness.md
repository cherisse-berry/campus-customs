# Campus Customs Database Harness

This file explains how the Campus Customs database (`data/campus_customs.db`, a SQLite file) is organized. It lists each table and its fields, and says why each field matters for the website or the shopping chatbot.

The database was only read, never changed.

## Overview

| Table | Rows | What it holds |
|---|---|---|
| `catalogue` | 102 | One row per product: name, type, description, colors, tags, image and price |
| `inventory` | 612 | Stock count for each product in each size (102 products × 6 sizes) |
| `users` | 3 | Shopper accounts used for sign-in |
| `chat_messages` | 22 | Saved chatbot conversation history, per user |
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
| `password_hash` | TEXT, required | A scrambled (hashed) version of the password, in `pbkdf2_sha256$<salt>$<hash>` format, so the real password is never stored. Sign-in checks a typed password against it. It must never be shown on the site, sent to the chatbot or written to logs. |
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
| `products_json` | TEXT (JSON), optional | Only filled in on chatbot replies (11 of the 22 rows). It's a snapshot of the products the reply showed, with catalogue fields plus `image_url`, per-size `inventory` and `total_stock`. It lets the site redraw the product panel when a chat reloads, and it gives the chatbot context for follow-ups like "you have this in pink?" Because it's a snapshot, stock and prices in it can be out of date, so check the live tables before saying something is available. |
| `created_at` | TEXT, defaults to the current time | When the message was sent. Used for timestamps and ordering. |

## `sqlite_sequence`: internal table

SQLite manages this table itself. It records the last ID used in each auto-numbered table (`inventory`, `users`, `chat_messages`). The website and chatbot don't use it, and nobody should edit it.

---

## Notes for building the site and chatbot

- **Clean up categories:** group the 22 `garment_type` spellings into a few clean categories (T-shirts, crewnecks, hoodies, quarter-zips, fleeces and jackets, long sleeves) before building filters.
- **Read JSON fields:** `colors`, `search_tags` and `products_json` are JSON stored as text, so the code has to parse them.
- **Check stock live:** the chatbot should look up current stock in `inventory`, not trust old `products_json` snapshots.
- **Handle missing items:** the chat history shows shoppers asking for things the shop doesn't carry, like gym shorts or pink items. The chatbot should say clearly when nothing matches.
- **Keep account data private:** never expose `password_hash` or other users' emails or chats.
