# LastPlate

A small marketplace prototype for same-day surplus food from neighbourhood bakeries and cafés. Shops enter what they have left, get a reviewed listing draft, and publish pickup bundles. Buyers reserve a bundle and receive a pickup code.

## Run locally

Requires Node.js 20 or newer. No package installation is needed.

```sh
npm start
```

Then open <http://localhost:3000>.

Without credentials, the site uses a clearly marked local demo reservation flow and a simple writing-helper fallback. The fallback is not an AI model and does not charge money.

## Optional integrations

Set credentials in the shell before starting the server:

```sh
export OPENAI_API_KEY="your-key"
export OPENAI_MODEL="gpt-6-astra"
export PAYPAL_CLIENT_ID="your-sandbox-client-id"
export PAYPAL_CLIENT_SECRET="your-sandbox-secret"
npm start
```

The OpenAI key is used only by the server to draft a short title, description, suggested price, and tags. The shop reviews the draft and sets the final price. Ingredients and allergen information are entered by the shop and are not inferred by the model.

PayPal uses the JavaScript SDK and server-side Orders v2 create/capture calls against PayPal Sandbox. Use sandbox credentials only. Set `CURRENCY` to another PayPal-supported currency code if needed; the default is `CAD`.

## Prototype limits

Listings and reservations are held in server memory, so they reset when the server restarts. There is no seller login, database, email receipt, real inventory lock across multiple server instances, or production food-compliance workflow. Do not use this prototype to take real payments or publish commercial food listings without adding those pieces.
