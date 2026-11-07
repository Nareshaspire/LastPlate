# LastPlate

**An AI surplus-food marketplace for neighbourhood shops.** LastPlate helps bakeries and cafés turn end-of-day food into clear, fairly priced pickup bundles, then helps nearby shoppers find a good fit and pay through PayPal Sandbox.

## The experience

1. A shop enters its remaining items, quantity, pickup deadline, price context, and verified ingredient/allergen information.
2. AI drafts an honest title, description, price suggestion, and tags. The shop reviews and edits the draft before publishing.
3. A shopper describes what they want in everyday language. AI matches the request against currently available bundles and explains each match.
4. The shopper reviews a specific bundle, quantity, shop details, and pickup deadline, then chooses PayPal checkout. The server creates and captures the PayPal Sandbox order using its own listing and price records.
5. A completed order reduces the available quantity and returns a pickup code.

AI does not create or approve listings, infer ingredients, promise dietary suitability, verify food safety, or authorize payments. Buyers with allergies or medical dietary needs are directed to confirm details with the shop. The shopper always reviews the selected bundle and approves payment in PayPal.

## Run locally

Requires Node.js 20 or newer. No package installation is needed.

```sh
cp .env.example .env
# Add your keys to .env, then:
npm start
```

Open <http://localhost:3000>.

Without API credentials, LastPlate shows a clearly labelled local demo reservation and a non-AI writing preview. AI buyer matching and PayPal checkout require the credentials below. Do not describe the fallback as an AI recommendation or real payment.

## Connect AI and PayPal Sandbox

Create a free PayPal Developer account and a Sandbox app. Add the Sandbox client ID and secret to `.env`; never put the secret in browser code or Git. Add an OpenAI API key for live AI drafting and buyer matching. `.env` is ignored by Git.

```dotenv
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-6-astra
PAYPAL_CLIENT_ID=your_paypal_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_paypal_sandbox_secret
CURRENCY=CAD
PORT=3000
```

Restart `npm start` after changing `.env`. PayPal is configured for Sandbox only. The amount is looked up from the selected listing on the server; the browser cannot set the charge amount.

## AI and payments

- **AI:** OpenAI Responses API with Structured Outputs. One task drafts merchant listings from seller-provided notes. A separate task matches a shopper request to exact IDs from the live available bundle catalogue; the server validates every returned ID. Buyer requests are sent to OpenAI, so do not enter allergy or medical information.
- **PayPal:** PayPal JavaScript SDK checkout backed by server-side Orders v2 create and capture requests to PayPal Sandbox. The app does not claim to be a payment processor or use production credentials.
- **Data:** Sample listings and orders are held in server memory and reset on restart. There is no seller login, persistent database, reservation expiry, refund flow, email receipt, or production food-safety workflow.

## Hackathon demo walkthrough

Use Sandbox credentials and an OpenAI API key for the full experience.

1. On the merchant form, enter a short surplus list and verified ingredients; request an AI draft, edit it, and publish.
2. On the buyer page, ask for a low-cost bundle before a chosen pickup time. Show the AI explanation and select a recommended listing.
3. Complete PayPal Sandbox checkout. Show the confirmation and pickup code, then show inventory reduced.

For a UI-only preview, use the sample bakery bundles. The fallback reservation is clearly marked as a demo and does not move money.

See [HACKATHON_SUBMISSION.md](HACKATHON_SUBMISSION.md) for a project description draft and a sub-three-minute recording plan.

## License

MIT. See [LICENSE](LICENSE).
