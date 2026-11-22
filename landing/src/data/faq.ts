import { money, site } from "../config";

export const faq = [
  {
    q: "What is Rakumi?",
    a: "A kitchen companion for the whole house. Plan meals, keep track of your pantry, save recipes, cook step by step, and shop from one list. It's open source.",
  },
  {
    q: "Hosted or self-hosted: what's the difference?",
    a: `It's the same app with the same features. Hosted means we run it for you: nothing to set up, backups and updates handled, ${money(site.price.monthly)} a month. Self-hosted means you run it on your own server, for free.`,
  },
  {
    q: "Why pay if it's open source?",
    a: "You pay for the convenience, and to keep one independent developer going. You also get direct support and a louder voice in what gets built next. Nothing is locked behind the paywall.",
  },
  {
    q: "Do I need a card for the free trial?",
    a: `Yes. You add a card at checkout to start your ${site.trialDays}-day trial. Cancel before day ${site.trialDays} and you won't be charged. If you don't cancel, your plan starts and we charge the card. Each person gets one free trial. If you used one before, checkout shows the price you pay today.`,
  },
  {
    q: "Can I cancel, and what happens to my data?",
    a: "Cancel any time. Ask us for a copy of your data and we'll send it. We delete everything 30 days after your plan ends.",
  },
  {
    q: "Who sees my data?",
    a: "Your data is yours. We only use it to run the app. If you self-host, everything stays on your own hardware.",
  },
  {
    q: "Can everyone in the house use it?",
    a: "Yes. Everyone signs in to the same account from their own phone or computer. Cook together lets two to four people split one recipe's steps.",
  },
  {
    q: "Is there an app?",
    a: "Not yet. Rakumi works great in your phone's browser. A native app is a maybe for later.",
  },
  {
    q: "What's the AI assistant thing?",
    a: "It's optional. If you use an AI assistant, it can connect to Rakumi to read and change your plans and lists. You can ignore it completely.",
  },
  {
    q: "Who makes this?",
    a: "One independent developer. You can reach us from the contact link in the footer.",
  },
] as const;
