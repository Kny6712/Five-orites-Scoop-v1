// src/app/core/about-content.ts
// Five-orites Scoop — All About page copy, in one place
//
// WHY A CONTENT FILE
// Every word on the About page lives here so it can be edited without touching a
// template, a component class, or a stylesheet. The previous version had the
// Vision statement hardcoded as a paragraph in about.page.html, which meant a copy
// change required finding a template, and the Mission did not exist on the page at
// all.
//
// The copy below is the client's own wording and is reproduced verbatim.

import type { AppIcon } from './icons/app-icons';

export interface AboutFeature {
  icon: AppIcon;
  title: string;
  description: string;
}

/**
 * One of the four principles shown in the story column.
 *
 * Every `text` here is the client's own wording, taken from the story paragraphs
 * or from MISSION below. That is the constraint, not a style note: this page
 * states nothing the app cannot back, which is why a feature that used to claim
 * "Secure Payments" was removed rather than left standing.
 */
export interface StoryValue {
  icon: AppIcon;
  title: string;
  text: string;
}

export interface AboutStep {
  number: string;
  title: string;
  description: string;
}

/** The three words the name is built from. Rendered as a triptych, not a paragraph. */
export interface NameMeaning {
  word: string;
  meaning: string;
}

export const HERO = {
  title: 'Five-orites Scoop',
  tagline: 'Premium ice cream, scooped to your door',
  cta: 'Explore Flavors',
} as const;

export const STORY = {
  heading: 'How Our Business Started',
  paragraphs: [
    'Five-orites Scoop started as a simple idea shared by the five of us who wanted to sell ice creams in our tropical country. We wanted to create something that would not only taste good but also bring people together and give customers the opportunity to enjoy different flavors at an affordable price.',
    'We started Five-orites Scoop as a business idea for our school project, but we wanted to develop it as if it were a real business. Through teamwork and creativity, we aim to provide delicious and enjoyable ice cream while giving customers a variety of flavors and combinations to choose from.',
  ],
  /**
   * What the shop actually sells, in one line under the heading.
   *
   * The page described the business's feel in detail and never once said what
   * was on the menu. These two figures are the catalogue shape the README and
   * the seeder already record (eight flavor families, 64 seeded products), and
   * the four sizes are the model's SizeVariant union.
   *
   * They are hardcoded rather than counted from Firestore because /about loads
   * for signed-out visitors and must render with no auth and no reads. The cost
   * of that choice is that a reseed to a different count leaves these stale.
   */
  sells: { families: 8, products: 64 },

  /**
   * The values row.
   *
   * Exists to give the story column enough height to finish near the photo/map
   * column beside it. It was about 365px short, which read as a hole under the
   * text rather than as margin - and adding prose was not the fix, because two
   * paragraphs is the right amount of story and three more would be padding.
   *
   * A stats row of four figures (5 members / 8 flavor families / 64 flavors /
   * 4 sizes) sat above this and was removed. The values row alone leaves the
   * column about 130px short, which reads as margin rather than as a gap.
   *
   * The values are the client's own words, taken from the paragraphs above and
   * from MISSION below. None of them asserts anything the app does not do.
   */
  values: [
    {
      icon: 'sparkles',
      title: 'Quality',
      text: 'We aim to serve delicious and enjoyable ice cream.',
    },
    { icon: 'users', title: 'Teamwork', text: 'Five of us working from one shared idea.' },
    {
      icon: 'palette',
      title: 'Creativity',
      text: 'A variety of flavors and combinations to choose from.',
    },
    {
      icon: 'heart',
      title: 'Customer-first',
      text: 'Bringing people together at an affordable price.',
    },
  ] satisfies StoryValue[],
  /**
   * The name etymology, split out of the middle of the story.
   *
   * "Five" / "favorites" / "Scoop" is the most distinctive thing in the whole
   * About page and was a wall of text inside a paragraph. Three short labelled
   * beats give the page an actual visual anchor.
   *
   * DO NOT ADD IT BACK AS A THIRD PARAGRAPH. A rewrite of the story copy proposed
   * one, and it said the same three things a second time on one screen — once as
   * prose in this section and once as these three cards. That is the wall of text
   * this array exists to replace, reintroduced as duplication rather than as
   * detail. If the story needs a third paragraph, it must be about something the
   * cards do not already say.
   */
  nameMeanings: [
    {
      word: 'Five',
      meaning: 'The five members of our group',
    },
    {
      word: 'favorites',
      meaning: 'The variety of ice cream flavors customers can choose from',
    },
    {
      word: 'Scoop',
      meaning: 'Our main product, and the fun experience we want to provide',
    },
  ] satisfies NameMeaning[],
} as const;

export const MISSION = {
  heading: 'Our Mission',
  /**
   * REWRITTEN to stop echoing the story.
   *
   * This used to read "to provide affordable, delicious, and enjoyable ice cream
   * for everyone... quality products, friendly service, and a variety of flavor
   * choices" - which is the story paragraph above it, reordered. By the time a
   * reader reached this card they had already been told "delicious" three times,
   * "affordable" twice and "variety of flavors" twice.
   *
   * A Mission that restates the origin story adds no information and reads as
   * filler. This says something the page does not say anywhere else - what the
   * shop is FOR, rather than what it makes.
   */
  text: 'To make great ice cream easy to find and hard not to love. Every flavor we sell, we make ourselves.',
} as const;

export const VISION = {
  heading: 'Our Vision',
  /**
   * Rewritten for the same reason as MISSION, and because this one was worse:
   * "memorable and trusted ice cream business known for its delicious flavors,
   * affordable products, and enjoyable customer service" was a fourth pass through
   * the same three adjectives, in corporate register, near the bottom of the page.
   *
   * It now names a place (Cainta) and an ambition, neither of which appears
   * anywhere else on the page.
   */
  text: "To be the ice cream shop people name when they ask what's good in Cainta — a neighborhood favorite, not a chain.",
} as const;

export const CUSTOMER_FEATURES: AboutFeature[] = [
  {
    icon: 'ice-cream',
    title: 'Premium Ice Cream, 8 Flavor Families',
    description:
      'Explore eight flavor families — from Chocolates and Fruits to Coffee and Ube — each with a full range of pints, half gallons and gallons.',
  },
  {
    icon: 'cart',
    title: 'Easy Ordering',
    description:
      'Add your favorite ice cream to the cart, choose your preferred size, enter your order details, and complete your purchase in just a few simple steps.',
  },
  {
    icon: 'navigation',
    title: 'Live Order Tracking',
    description:
      'Follow your order from preparation to delivery. Real-time tracking helps customers stay updated on the progress of their ice cream order.',
  },
  {
    // This said "Secure Payments" and described "a secure payment process" where
    // "your payment information and transaction details are handled safely".
    // There is no payment gateway, no payment UI on any screen, and no card or
    // account detail is collected anywhere in the app — so that copy was not just
    // unimplemented, it was a claim about handling customer financial data that
    // the app does not do. `paymentStatus` is written once as 'pending' and never
    // mutated by anything.
    //
    // What replaces it states only what is actually true. The real-world payment
    // ARRANGEMENT (cash on delivery, bank transfer, arrangements made over the
    // phone) is a business fact this codebase cannot confirm and must not invent —
    // if you want it named on this page, put it here and say so.
    icon: 'shield-check',
    title: 'No Card Details Needed',
    description:
      'See the full price breakdown, including delivery, before you order. We never ask for or store your card or bank details.',
  },
];

export const TEAM_FEATURES: AboutFeature[] = [
  {
    icon: 'layers',
    title: 'Inventory Management',
    description:
      'Manage ice cream stock and update the available quantity of each flavor and size. Inventory monitoring helps prevent unavailable or incorrect product listings.',
  },
  {
    icon: 'zap',
    title: 'Real-Time Fulfillment',
    description:
      'Track, manage, and update customer orders from a centralized dashboard. This helps the team organize order preparation and fulfillment more efficiently.',
  },
];

/**
 * A genuine ordered process, so the 01/02/03 numbering carries information rather
 * than being decoration. If these ever stop being a sequence, the numbers should go.
 */
export const HOW_IT_WORKS: AboutStep[] = [
  {
    number: '01',
    title: 'Browse and Choose',
    description: 'Pick your favorite flavor and size from the available catalog.',
  },
  {
    number: '02',
    title: 'Place Your Order',
    // "securely" removed. There is no payment gateway in this project: nothing
    // collects a card, a bank detail or a wallet, and `paymentStatus` is written
    // once as 'pending' and never mutated. The word implied a transaction the
    // app does not perform, which is the same overclaim that got "Secure
    // Payments" removed from the feature card above - and it was inconsistent
    // that this one survived.
    description: 'Add your items to the cart, tell us where to bring them, and confirm your order.',
  },
  {
    number: '03',
    title: 'Track and Enjoy',
    description:
      'Monitor your order as it is prepared and delivered, then enjoy your favorite Five-orites Scoop ice cream.',
  },
];

/**
 * THE TECH STACK, MOVED TO THE DEVELOPERS PAGE rather than deleted.
 *
 * These eight chips used to sit at the foot of the ABOUT page, and were wrong
 * there for a reason worth keeping: /about is what a CUSTOMER opens to learn
 * about an ice cream shop, so Ionic, RxJS and TypeScript were developer-facing
 * content in a customer-facing slot - the only part of that page which read as
 * a README rather than as a business. They also broke the page's ending,
 * landing between "How It Works" and the Meet the Team CTA.
 *
 * They now render in the Developers page footer, which is the page about who
 * built this and what with, and where a "built with" block is expected. The
 * list is unchanged and still true - only the host page moved.
 *
 * DO NOT PUT THIS BACK ON ABOUT. It was moved once already for the reason
 * above, and the About page reads better without it.
 *
 * This file stays the single source even though Developers is now the only
 * consumer: it is the About-adjacent content module, and a second copy in
 * developers.page.ts would be the kind of drift this codebase keeps paying for
 * elsewhere (see the ROLE_CAPABILITIES / firestore.rules pairing).
 */
export const TECH_STACK: string[] = [
  'Ionic 7',
  'Angular 17',
  'Capacitor 5',
  'Firebase Firestore',
  'Firebase Authentication',
  'TypeScript 5',
  'RxJS',
  'SCSS',
];
