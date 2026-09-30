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
    'Five-orites Scoop began as a simple idea shared by five students who wanted to sell ice cream in our tropical country. We wanted to create a business that would not only offer delicious ice cream but also bring people together and allow customers to enjoy different flavors at affordable prices.',
    'Five-orites Scoop started as a business concept for a school project. However, we developed it as a real business by applying teamwork, creativity, and customer-focused service. Our goal is to provide delicious ice cream while giving customers the freedom to select their favorite flavors and combinations.',
  ],
  /**
   * The name etymology, split out of the middle of the story.
   *
   * "Five" / "favorites" / "Scoop" is the most distinctive thing in the whole
   * About page and was a wall of text inside a paragraph. Three short labelled
   * beats give the page an actual visual anchor.
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
  text: 'Our mission is to provide affordable, delicious, and enjoyable ice cream for everyone. We aim to offer quality products, friendly service, and a variety of flavor choices while creating a fun and satisfying customer experience.',
} as const;

export const VISION = {
  heading: 'Our Vision',
  text: 'Our vision is for Five-orites Scoop to become a memorable and trusted ice cream business known for its delicious flavors, affordable products, and enjoyable customer service. We hope to grow our business while continuing to bring people together through our shared love of ice cream.',
} as const;

export const CUSTOMER_FEATURES: AboutFeature[] = [
  {
    icon: 'ice-cream',
    title: 'Browse 64 Flavors',
    description:
      'Explore eight categories, each offering eight premium ice cream variants. Customers can discover different flavors and select the combination that best suits their preferences.',
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
    icon: 'shield-check',
    title: 'Secure Payments',
    description:
      'Complete your order using a secure payment process. Your payment information and transaction details are handled safely.',
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
    description:
      'Add your selected products to the cart, provide your delivery details, and confirm your order securely.',
  },
  {
    number: '03',
    title: 'Track and Enjoy',
    description:
      'Monitor your order as it is prepared and delivered, then enjoy your favorite Five-orites Scoop ice cream.',
  },
];

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
