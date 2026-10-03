# Privacy Policy — Five-orites Scoop

**Last updated: 3 October 2026**

This policy describes what the Five-orites Scoop mobile app actually does. It was
written from the source code, not from a template — where the app does not do
something, this document does not claim it does.

> ### ⚠ BEFORE PUBLISHING — TWO PLACEHOLDERS, AND ONE OF THEM IS NOT A FORMALITY
>
> - **`CONTACT_EMAIL_PLACEHOLDER`** — replace with a real address you monitor.
>   Both Google Play and the App Store require a working contact route for
>   privacy requests, and an unreachable one is a rejection, not a minor issue.
> - **The order-redaction caveat below is a real limitation.** Account deletion
>   _is_ implemented in-app (Profile → Delete account) and it really does delete
>   your account — but past orders are **retained as business records with your
>   name, email, delivery address and notes still on them.** Read "Deleting your
>   account" before publishing, and do not delete that caveat to make the
>   listing look tidier. `CUTOVER.md` explains why it cannot be automated.

---

## Who we are

Five-orites Scoop is a small ice cream shop in Cainta, Rizal, Philippines,
operating this ordering app. "We" means the shop.

## What we collect, and why

### 1. Your account

If you sign in, we store on your user record:

| Field                                                           | Why                                                                                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email address                                                   | Your account identity. Required to sign in.                                                                                                                         |
| Display name                                                    | Shown on your orders and your reviews.                                                                                                                              |
| Photo URL                                                       | Supplied by Google if you signed in with Google, or by you if you uploaded a profile photo.                                                                         |
| Phone number                                                    | **Only if you enter it** in your profile. Optional.                                                                                                                 |
| Notification preference                                         | Whether you want order-status notifications.                                                                                                                        |
| Notifications read marker                                       | The moment you last opened the notification feed, so the unread badge knows what is new.                                                                            |
| Suspension flag (`isSuspended`, `suspendReason`, `suspendedAt`) | **Staff-set only.** If staff suspend an account, we record that it is suspended, why, and when. You cannot see or change these, and neither can any other customer. |
| Staff note (`adminNote`)                                        | An internal note staff keep on your account. Not shown to you.                                                                                                      |

We do not ask for a password — authentication is handled by Firebase Auth, and
Google sign-in is handled by Google. We never see your Google password.

Your account also carries a **role** (`customer`, `staff`, `manager`, `admin`,
`owner`), which decides what you can reach in the app and is enforced by
Firestore Security Rules rather than by the app. You cannot change your own role,
and neither can an `admin` — only the shop's `owner` can promote or demote
anyone.

### 2. Your orders

To deliver ice cream we obviously need an address. Each order stores:

- the items, quantities, sizes and prices charged
- your **delivery address** (street text, as you typed it)
- your **email**, copied from your account so we can reach you about the order
- any **note** you attached to the order
- a **geocoded point** (latitude and longitude) derived from that address
- the **voucher code** you used, if any (`voucherCode`)
- the **discount** that code produced (`discountAmount`) and the delivery fee,
  so the total you were quoted can be reconstructed later
- the **status history** — every status the order has been through, with a
  timestamp, which is also what the in-app notification feed is built from

**On location:** this app does **not** use your phone's GPS, and it does not
track your location. There is no location permission in the app and no location
SDK in it. What appears on the tracking map is a point we calculated from the
delivery address you typed, by sending that address to the
[OpenStreetMap Nominatim](https://nominatim.org/) geocoding service.

That derived point is **stored on your order** so the tracking map and our
dispatch map have something to draw, and so we do not have to geocode the same
address every time you open the page. It is not used for anything else, and it is
not shared.

We retain order records for our own bookkeeping. We do not sell them. Order
records are **not** anonymised when you delete your account — see "Deleting
your account" below, which states exactly what happens.

### 3. Vouchers and reviews

Promo codes you enter are sent to our database to be validated. Reviews you post
are public on the product page, attributed to your display name — so **do not
put anything private in a review**.

You can edit or withdraw your own review at any time from the product page.

### 4. Photos you upload

**Your profile photo.** **Any signed-in user** can upload a profile photo from
their device, not only administrators. The file is resized on your own phone
(cropped square, longest side 512px) and then POSTed to **Cloudinary**, a
third-party image host, using an unsigned upload preset into the folder
`five-orites-scoop/avatars`. We store only the resulting URL, in the same
`photoURL` field Google sign-in would have filled in. Nobody else can overwrite
it: Firestore Security Rules let you write `photoURL` on your own account and
nowhere else.

**Product photos.** If you are an administrator you can also upload product
photos from your device, into `five-orites-scoop/products`; the resulting URL is
stored with the product and shown on the storefront.

Both use the same kind of preset. Anyone who can read the app's source can see
the preset name; it is configured to be low-risk, and it is a known loose end we
are tightening. Files are downscaled before they leave the device and re-sized
again per screen on delivery.

## What we do NOT collect

- No GPS or device location
- No contacts, photos library, or microphone access beyond what a chosen profile
  or product photo needs
- No advertising or third-party tracking SDKs
- No analytics are currently enabled in the app

## Who else sees your data

| Party                     | What                                                        | Why                                        |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------ |
| Google Firebase           | Your account and all app data                               | The database and authentication live here. |
| Google                    | Your identity, if you sign in with Google                   | Google handles that sign-in.               |
| Cloudinary                | **Your profile photo**, and product photos if you are staff | Image hosting. **Never your order data.**  |
| OpenStreetMap (Nominatim) | Delivery address text, when you open the tracking page      | Turns it into a map point.                 |

None of these are sold or used for their own advertising on our behalf.

## How we protect it

All data is held in Firestore, and access is enforced by Firestore Security
Rules rather than by the app. A signed-in customer cannot read another
customer's orders, cannot change their own role, cannot edit another person's
review, and cannot write product stock levels.

**What is actually verified:** `tests/firestore.rules.test.ts` exercises these
rules against the Firestore emulator and currently passes **120 of 120**. Read
that as a statement about those tests, not about the whole file — no test covers
the app's UI logic, the Cloud Functions (which cannot be deployed on this
project's free plan), or anything about a live deployment. `README.md` →
"Known limitations" lists what no test reaches.

Delivery addresses are visible to staff, because staff have to make and deliver
the order.

## Your rights

You can, at any time:

- **See your data.** It is in the app: your profile page shows your details, your
  orders page shows your orders.
- **Correct your details.** Edit your profile and your saved delivery addresses in
  the app.
- **Stop order notifications.** Turn them off in Settings. **This app sends no
  email, no SMS and no push notification of any kind** — there is no mailing
  list and no message gateway behind it, so there is no "order-related email"
  that a switch cannot reach. The preference controls the in-app notification
  feed and the in-app toast, and nothing else.
- **Withdraw a review.** Delete it from the product page.

### Deleting your account

**You can do this yourself: Profile → Delete account.** It asks you to confirm,
may ask for your password first, and then permanently deletes your account and
signs you out. It cannot be undone.

**What happens to your orders — stated plainly, because the honest answer is not
the reassuring one.**

Your orders are **retained as the shop's sales and accounting records**, and the
identifying fields on them — **your name, your email address, your delivery
address, and any note you attached — are NOT currently removed.** They stay on
the order.

Redacting them requires a server-side process that can write to orders it does
not own, and this project runs on Firebase's free plan, which cannot host one.
So this is not a policy choice we have made and not a queue we are working
through: **there is no automated way for us to do it.**

What _is_ deleted, immediately, by the app: your Firestore account document and
your Firebase Authentication record. What survives: every order you placed, with
your personal details still attached to it.

**So if you want your name, email, address and notes taken off your past
orders, contact `CONTACT_EMAIL_PLACEHOLDER` and ask us.** We can do it by hand
from the Firestore console; it just is not something the app can do for you.

**If you have staff access**, the option is not shown and deletion is refused.
Promote another owner first, then delete your own account — otherwise the shop
would be left with no way in.

If you would rather we deleted the account for you than did it in the app,
contact `CONTACT_EMAIL_PLACEHOLDER`.

## Children

This app is not directed at children under 13 and is not intended to be used by
them. If you believe a child has given us personal information, email
`CONTACT_EMAIL_PLACEHOLDER`.

## Changes

If this policy changes we will update the date at the top. Material changes will
be announced in the app.

## Contact

`CONTACT_EMAIL_PLACEHOLDER` — Five-orites Scoop, Cainta, Rizal, Philippines.
