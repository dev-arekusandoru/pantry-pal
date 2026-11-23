import { money, site } from "../config";

export const faq = [
  {
    q: "What is Rakumi?",
    a: "Rakumi is a kitchen companion for your whole household. Plan the week's meals, keep track of your pantry, save your recipes, cook step by step, and shop from one shared list. It's open source, so anyone can read the code.",
  },
  {
    q: "Hosted or self-hosted: what's the difference?",
    a: `Same app, same features. With hosted, we run it for you. There's nothing to set up, and we take care of backups and updates for ${money(site.price.monthly)} a month. With self-hosted, you run it on your own server for free.`,
  },
  // {
  //   q: "Why pay if it's open source?",
  //   a: "You pay for the convenience, and to keep one independent developer going. You also get direct support and a louder voice in what gets built next. Nothing is locked behind the paywall.",
  // },
  {
    q: "Do I need a card for the free trial?",
    a: `Yes, but we won't charge it during your trial. The card helps us keep it to one free trial per person. Try everything free for ${site.trialDays} days, and cancel any time before day ${site.trialDays} to pay nothing. If you love it, your plan starts on its own when the trial ends.`,
  },
  {
    q: "Can I cancel, and what happens to my data?",
    a: "Yes, any time. If you'd like a copy of your data, just ask and we'll send it to you. We delete everything 30 days after your plan ends.",
  },
  {
    q: "Who sees my data?",
    a: "Your data belongs to you. We use it only to run Rakumi. If you self-host, it stays on your own hardware.",
  },
  {
    q: "Can everyone in the house use it?",
    a: "Yes. Everyone signs in to your household's account from their own phone or computer. Cooking together? Cook mode can split a recipe's steps between two to four people.",
  },
  {
    q: "Is there a mobile app?",
    a: "Not yet. Rakumi works great in your phone's browser, so you can plan and shop from anywhere. Make sure to let us know if you'd like a mobile app!",
  },
  {
    q: "Does Rakumi work with AI assistants?",
    a: "Yes. Rakumi has a built-in MCP (Model Context Protocol) server, so any AI assistant or agent that supports MCP can connect to it. Ask your assistant to plan the week, add to the shopping list, or check what's in the pantry. It's optional, and the app works fully without it.",
  },
] as const;
