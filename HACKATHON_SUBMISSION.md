# PayPal AI Hackathon — submission draft

## Project title

LastPlate — AI surplus-food marketplace

## Short description

LastPlate helps neighbourhood bakeries and cafés turn end-of-day surplus into pickup bundles. Sellers enter the remaining items and verified ingredient information; AI drafts an editable listing, and shoppers can ask for a match in plain language. The app then supports a PayPal Sandbox checkout flow and pickup confirmation.

## What is new in this hackathon build

- Added live OpenAI Responses API calls for seller listing drafts and buyer bundle matching.
- Kept the seller in control of the final listing by reviewing and editing the generated draft before publishing.
- Recommended listings are filtered against the currently active inventory so only valid bundle IDs are returned.
- Added a PayPal Sandbox checkout flow for purchase confirmation and pickup-code generation.
- Added configuration and local run instructions for a working demo setup using private credentials.

## Tools used

- PayPal Developer Platform: PayPal Sandbox checkout flow and server-side order capture logic.
- OpenAI API: Responses API with JSON Schema structured outputs for listing drafts and bundle recommendations.
- Runtime: Node.js, Express, SQLite, HTML, CSS, and browser JavaScript.

## Demo video plan (target: under 3 minutes)

0:00–0:20 — The problem: local shops often have surplus food near closing while nearby shoppers want affordable options.
0:20–0:55 — Seller flow: input surplus items, generate an AI draft, review it, and publish the listing.
0:55–1:25 — Buyer flow: ask for a low-cost bakery bundle and review the AI recommendation.
1:25–2:00 — PayPal Sandbox: complete checkout and show the pickup code and order confirmation.
2:00–2:30 — Close: summarize how AI and PayPal combine to make surplus-food pickup simple and trustworthy.

## Before recording or submitting

- Put working OpenAI and PayPal Sandbox credentials in a private local `.env` file; never commit credentials.
- Run the exact flow shown in the video on the same device being recorded.
- Upload a public YouTube video shorter than three minutes and add the link to Devpost.
- Submit the public repository URL and a working run/setup description before the deadline.
- Verify the Devpost project is submitted, not just saved as draft.

The app is intended for demo, local testing, and hackathon validation with sandbox credentials. Do not describe demo fallback responses as if they are live OpenAI or PayPal production flows.
