# ToolNest — Digital Tools & APK Marketplace

A responsive Node.js marketplace with:
- Online browser tools: image compression and text utilities
- APK catalog and protected paid downloads
- Admin login, product management, APK upload and order list
- Razorpay order creation + signature verification
- PayPal order approval + capture
- SQLite database

## Requirements
- Node.js 20+
- npm
- A server with HTTPS for production payments

## Run locally
```bash
cp .env.example .env
npm install
npm start
```
Open http://localhost:3000

The first admin credentials come from `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`.
Change the default password and `JWT_SECRET` before starting. The database is created in `data/`.

## Configure Razorpay
1. Create an account and get API keys from the Razorpay dashboard.
2. Put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env`.
3. Restart the server. Use test keys first.

## Configure PayPal
1. Create a REST app in PayPal Developer.
2. Put Client ID and Secret in `.env`.
3. Keep `PAYPAL_MODE=sandbox` while testing; set `live` only after production verification.
4. Set `BASE_URL` to your public HTTPS domain.

**Important currency note:** This starter stores prices as paise in INR. Razorpay charges INR. PayPal currently uses USD in the checkout example, and the code formats the same numeric price as USD. Before accepting live PayPal payments, add a proper INR-to-USD conversion/rate source and display the converted price clearly, or use a PayPal-supported currency/pricing table. Do not deploy this sample PayPal pricing behavior unchanged.

## Production deployment
- Use HTTPS, a strong unique `JWT_SECRET`, and non-default admin credentials.
- Use persistent storage for `data/` and `uploads/`; back both up.
- Configure a reverse proxy (Nginx/Caddy) and set `BASE_URL=https://your-domain`.
- Use a process manager such as PM2.
- Add payment webhooks and reconcile payment status server-side before high-volume production.
- Set upload limits and scan APKs before publishing.
- Add privacy policy, terms, refund policy, contact details and applicable tax/GST disclosures.
- Only upload APKs you own or are licensed to distribute. Do not sell modified/pirated apps or bypass app licensing.
- The built-in tools are browser-side demos. Extend the tool catalog and implement each tool's actual UI/logic before listing it as a supported service.

## Notes
- This is a working starter, not a turnkey hosted business. Payment gateways require your own approved merchant accounts and credentials.
- Razorpay verification uses the checkout signature. For production, also configure and verify Razorpay webhooks for resilience.
- PayPal approval return/capture is implemented; the example uses USD for PayPal and needs explicit currency conversion before live use.
