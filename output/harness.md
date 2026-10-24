# Campus Customs Database Harness

This file explains how the Campus Customs database (`data/campus_customs.db`, a SQLite file) is organized. It lists each table and its fields, and says why each field matters for the website or the shopping chatbot.

For Problem 2 the database was only read, never changed. From Problem 4 on, the website adds one new row to `users` each time a customer creates an account; nothing else is ever written. See [Authentication](#authentication) below.

## Overview

| Table | Rows | What it holds |
|---|---|---|
| `catalogue` | 102 | One row per product: name, type, description, colors, tags, image and price |
| `inventory` | 612 | Stock count for each product in each size (102 products × 6 sizes) |
| `users` | 3 (as delivered) | Shopper accounts used for sign-in; grows as customers register |
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
| `products_json` | TEXT (JSON), optional | Only filled in on chatbot replies (11 of the 22 rows). It's a snapshot of the products the reply showed, with catalogue fields plus `image_url`, per-size `inventory` and `total_stock`. It lets the site redraw the product panel when a chat reloads, and it gives the chatbot context for follow-ups like "you have this in pink?" Because it's a snapshot, stock and prices in it can be out of date, so check the live tables before saying something is available. |
| `created_at` | TEXT, defaults to the current time | When the message was sent. Used for timestamps and ordering. |

## `sqlite_sequence`: internal table

SQLite manages this table itself. It records the last ID used in each auto-numbered table (`inventory`, `users`, `chat_messages`). The website and chatbot don't use it, and nobody should edit it.

---

## Authentication

Customers can create an account and log in. The code is in `backend/app/auth.py`, with the database queries in `backend/app/db.py`.

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
- Linking chat history (`chat_messages`) to the logged-in user. That comes when the chatbot is connected.

---

## Notes for building the site and chatbot

- **Clean up categories:** group the 22 `garment_type` spellings into a few clean categories (T-shirts, crewnecks, hoodies, quarter-zips, fleeces and jackets, long sleeves) before building filters.
- **Read JSON fields:** `colors`, `search_tags` and `products_json` are JSON stored as text, so the code has to parse them.
- **Check stock live:** the chatbot should look up current stock in `inventory`, not trust old `products_json` snapshots.
- **Handle missing items:** the chat history shows shoppers asking for things the shop doesn't carry, like gym shorts or pink items. The chatbot should say clearly when nothing matches.
- **Keep account data private:** never expose `password_hash` or other users' emails or chats.
