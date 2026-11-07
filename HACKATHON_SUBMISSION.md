# PayPal AI Hackathon — submission draft

## Project title

LastPlate — AI surplus-food marketplace

## Short description

LastPlate helps local bakeries and cafés turn unsold end-of-day food into pickup bundles. Shop owners enter their own inventory and verified ingredient information; AI drafts an editable listing. Shoppers can describe what they are looking for in everyday language, and AI matches that request against currently available bundles. After reviewing a match, the shopper pays with PayPal Sandbox and receives a pickup code.

## What is new in this hackathon build

- Added AI-assisted, human-reviewed merchant listing creation.
- Added natural-language matching against live available bundles, with reasons for recommendations and server-side validation of returned listing IDs.
- Added PayPal Sandbox Orders v2 create/capture checkout, quantity updates, and pickup confirmation.
- Added configuration and run instructions so judges can run the functional build with their own sandbox credentials.

## Tools used

- **PayPal Developer Platform:** PayPal JavaScript SDK checkout and server-side Orders v2 create/capture calls in Sandbox.
- **OpenAI API:** Responses API with Structured Outputs for seller listing drafts and shopper bundle matching.
- **Runtime:** Node.js built-in HTTP server; HTML, CSS, and browser JavaScript.

## Demo video plan (target: 2:20)

**0:00–0:20 — The problem**  
Small food shops often have safe, sellable surplus left near closing, while nearby shoppers are looking for affordable options. The shop needs a fast way to describe and sell what is available today.

**0:20–0:55 — Seller flow**  
Enter a sample bakery’s remaining croissants and buns, quantity, pickup time, price context, and verified ingredient details. Generate the AI draft, edit the title or description, and publish it.

**0:55–1:25 — Shopper AI**  
Ask for an inexpensive bakery snack available before closing. Show the matching bundle and why it fits. Open its details and confirm quantity and pickup information.

**1:25–2:00 — PayPal Sandbox**  
Complete checkout with a PayPal Sandbox buyer account. Show the order confirmation and pickup code, then show the bundle quantity decrease.

**2:00–2:20 — Close**  
Summarize how LastPlate uses AI to help both sides find and describe surplus, with PayPal handling the approved purchase.

## Before recording or submitting

- Put working OpenAI and PayPal Sandbox credentials in a private local `.env` file; never commit credentials.
- Run through the exact flow shown in the video on the device being recorded.
- Upload an English demo video shorter than three minutes to YouTube and make it publicly visible.
- Submit the public repository URL, hosted demo or repository run instructions, project text, identified tools, and video link on Devpost before the deadline.
- Verify the Devpost project is submitted (not only saved as a draft) before **Nov 12, 2026 at 12:00 pm Pacific Time**.

The fallback reservation mode is for preview only; it is not a real PayPal payment or live AI result. Do not show it as the full hackathon flow.
