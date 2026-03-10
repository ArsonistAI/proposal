# DocuSign + Proposal flow

When the client clicks **Accept Proposal**, the page can generate a PDF and send it to DocuSign so both parties sign.

**Developer account:** jsabutis@gmail.com

## 1. RSA key pair (already generated)

An RSA key pair is in `.docusign-keys/` (folder is gitignored):

1. **Add the public key to DocuSign:** Sign in at [DocuSign Admin](https://admindemo.docusign.com) (or account-d.docusign.com) as jsabutis@gmail.com → **Apps and Keys** → your app (Integration Key) → **Add RSA Key** or **Add Key** → choose “Add my own public key” and paste the **entire contents** of `.docusign-keys/public.pem`.
2. **Add the private key to Vercel:** Open `.docusign-keys/private.key`, copy the **entire** contents (including `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----`), and paste into Vercel env var `DOCUSIGN_PRIVATE_KEY`. In Vercel you can paste as-is; if you need one line, replace each real newline with `\n`. After copying to Vercel, delete `private.key` from your machine.

## 2. Other DocuSign + Vercel setup

**In DocuSign (jsabutis@gmail.com):**

- **Apps and Keys:** Copy your **Integration Key** → Vercel `DOCUSIGN_INTEGRATION_KEY`.
- **Settings / API and Keys:** Copy **Account ID** (numeric or GUID) → Vercel `DOCUSIGN_ACCOUNT_ID`.
- **User ID:** In the same area, find the **User ID** (GUID) for jsabutis@gmail.com → Vercel `DOCUSIGN_USER_ID`.
- **Grant consent:** In Apps and Keys, click **Grant Consent** for your app (one-time).

**In Vercel** (project → Settings → Environment Variables):

- `DOCUSIGN_INTEGRATION_KEY` — from DocuSign
- `DOCUSIGN_USER_ID` — user GUID for jsabutis@gmail.com
- `DOCUSIGN_ACCOUNT_ID` — from DocuSign
- `DOCUSIGN_PRIVATE_KEY` — full contents of `.docusign-keys/private.key` (see above)
- `DOCUSIGN_SENDER_EMAIL` — **jon@arsonistai.com** (second signer on envelopes)
- `DOCUSIGN_SENDER_NAME` — e.g. **Arsonist AI** (optional)
- `DOCUSIGN_AUTH_SERVER` — **account-d.docusign.com** (demo) or **account.docusign.com** (production)

Redeploy the Vercel project after setting env vars.

## 3. Enable the flow on proposal pages

In each proposal HTML file, set the API base URL so the page can call the Vercel function:

```html
<script>
  var PROPOSAL_ENVELOPE_API = 'https://your-vercel-app.vercel.app';
</script>
```

Replace with your actual Vercel deployment URL. If `PROPOSAL_ENVELOPE_API` is empty, Accept only updates the UI (no PDF, no DocuSign).

## 4. API

- **POST** `/api/send-proposal-envelope`
- Body: `{ pdfBase64, clientName, clientEmail, proposalId }`
- Response: `{ signingUrl }` (redirect the client here) or `{ error, fallback }` on failure.
