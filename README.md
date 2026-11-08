# LastPlate

A local, AI-assisted surplus-food marketplace for neighbourhood shops. Sellers can publish end-of-day bundles, shoppers can search in plain language, and the app supports a PayPal Sandbox checkout flow for pickup orders.

## What the app does

1. A shop enters what remains at closing, pickup time, price context, and ingredient details.
2. An OpenAI Responses API request drafts a listing title, description, suggested price, and tags.
3. The seller reviews and edits that draft before publishing.
4. A shopper describes what they want in plain language and the app recommends matching listings from the live menu.
5. A buyer completes a PayPal Sandbox checkout and receives a pickup code.

## Run locally

Requires Node.js 20 or newer.

```bash
cp .env.example .env
# fill in your private values in .env
npm install
npm start
```

Then open http://localhost:3000.

## Environment variables

```dotenv
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
PAYPAL_CLIENT_ID=your_paypal_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_paypal_sandbox_secret
CURRENCY=CAD
PORT=3000
SESSION_SECRET=a-long-random-secret
```

- `OPENAI_API_KEY` is required for the real AI draft and recommendation flow.
- `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` are required for real PayPal Sandbox checkout.
- Keep `.env` private and do not commit it to Git.

## Notes

- The app reads `.env` automatically when it starts.
- AI output is structured with the OpenAI Responses API and validated before being used.
- Recommendations are filtered against the currently active listings before being returned to the client.
- Seller and buyer flows are still intended for local demo use unless you add the required credentials and test the full flow in your environment.

## License

MIT.
