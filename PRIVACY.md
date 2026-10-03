# Privacy Policy — Five-orites Scoop

**Last updated: 3 October 2026**

This policy describes what the Five-orites Scoop mobile app actually does. It was
written from the source code, not from a template — where the app does not do
something, this document does not claim it does.

> ### ⚠ BEFORE PUBLISHING — ONE PLACEHOLDER
>
> **`[CONTACT_EMAIL]`** — replace with a real address you monitor. Both Google
> Play and the App Store require a working contact route for privacy requests,
> and an unreachable one is a rejection, not a minor issue.
>
> Account deletion is now implemented in-app (Profile → Delete account), so no
> caveat is needed for it.

---

## Who we are

Five-orites Scoop is a small ice cream shop in Cainta, Rizal, Philippines,
operating this ordering app. "We" means the shop.

## What we collect, and why

### 1. Your account

If you sign in, we store on your user record:

| Field                   | Why                                                    |
| ----------------------- | ------------------------------------------------------ |
| Email address           | Your account identity. Required to sign in.            |
| Display name            | Shown on your orders and your reviews.                 |
| Photo URL               | Only if you signed in with Google and it provided one. |
| Phone number            | **Only if you enter it** in your profile. Optional.    |
| Notification preference | Whether you want order-status notifications.           |

We do not ask for a password — authentication is handled by Firebase Auth, and
Google sign-in is handled by Google. We never see your Google password.

### 2. Your orders

To deliver ice cream we obviously need an address. Each order stores:

- the items, quantities, sizes and prices charged
- your **delivery address** (street text, as you typed it)
- your **email**, copied from your account so we can reach you about the order
- any **note** you attached to the order
- a **geocoded point** (latitude and longitude) derived from that address

**On location:** this app does **not** use your phone's GPS, and it does not
track your location. There is no location permission in the app and no location
SDK in it. What appears on the tracking map is a point we calculated from the
delivery address you typed, by sending that address to the
[OpenStreetMap Nominatim](https://nominatim.org/) geocoding service.

That derived point is **stored on your order** so the tracking map and our
dispatch map have something to draw, and so we do not have to geocode the same
address every time you open the page. It is not used for anything else, and it is
not shared.

We retain order records for our own bookkeeping. We do not sell them.

### 3. Vouchers and reviews

Promo codes you enter are sent to our database to be validated. Reviews you post
are public on the product page, attributed to your display name — so **do not
put anything private in a review**.

You can edit or withdraw your own review at any time from the product page.

### 4. Product photos you upload

If you are an administrator, you can upload product photos from your device.
Those files go to **Cloudinary** (a third-party image host) using an unsigned
upload preset, then the resulting URL is stored with the product. Anyone who can
read the app's source can see that preset name; it is configured to be
low-risk, and it is a known loose end we are tightening.

## What we do NOT collect

- No GPS or device location
- No contacts, photos library, or microphone access beyond what a chosen product
  photo needs
- No advertising or third-party tracking SDKs
- No analytics are currently enabled in the app

## Who else sees your data

| Party                     | What                                                   | Why                                        |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------ |
| Google Firebase           | Your account and all app data                          | The database and authentication live here. |
| Google                    | Your identity, if you sign in with Google              | Google handles that sign-in.               |
| Cloudinary                | Product photos you upload                              | Image hosting. **Never your order data.**  |
| OpenStreetMap (Nominatim) | Delivery address text, when you open the tracking page | Turns it into a map point.                 |

None of these are sold or used for their own advertising on our behalf.

## How we protect it

All data is held in Firestore, and access is enforced by Firestore Security
Rules rather than by the app. A signed-in customer cannot read another
customer's orders, cannot change their own role, cannot edit another person's
review, and cannot write stock levels. These rules are enforced server-side and
tested — see `tests/firestore.rules.test.ts`.

Delivery addresses are visible to staff, because staff have to make and deliver
the order.

## Your rights

You can, at any time:

- **See your data.** It is in the app: your profile page shows your details, your
  orders page shows your orders.
- **Correct your details.** Edit your profile and your saved delivery addresses in
  the app.
- **Stop being emailed.** Turn notifications off in Settings. Order-related email
  is operational and does not follow that switch.
- **Withdraw a review.** Delete it from the product page.

### Deleting your account

**You can do this yourself: Profile → Delete account.** It asks you to confirm,
may ask for your password first, and then permanently deletes your account and
signs you out. It cannot be undone.

**What happens to your orders.** They are kept, because they are the shop's sales
and accounting records. What is removed from them is anything that identifies
you: your name, your email address, your delivery address, and any note you
attached. The items, amounts, dates and status stay.

**If you have staff access**, the option is not shown and deletion is refused.
Promote another owner first, then delete your own account — otherwise the shop
would be left with no way in.

If you would rather we did it by email, contact `[CONTACT_EMAIL]`.

## Children

This app is not directed at children under 13 and is not intended to be used by
them. If you believe a child has given us personal information, email
`[CONTACT_EMAIL]`.

## Changes

If this policy changes we will update the date at the top. Material changes will
be announced in the app.

## Contact

`[CONTACT_EMAIL]` — Five-orites Scoop, Cainta, Rizal, Philippines.
