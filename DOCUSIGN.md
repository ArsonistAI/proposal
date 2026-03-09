# DocuSign + Proposal flow

When the client clicks **Accept Proposal**, the page can generate a PDF and send it to DocuSign so both parties sign.

## 1. Vercel env vars

In your Vercel project, set:

- `DOCUSIGN_INTEGRATION_KEY` — Integration Key (Client ID) from DocuSign Admin
- `DOCUSIGN_USER_ID` — DocuSign user GUID (impersonated user for JWT)
- `DOCUSIGN_ACCOUNT_ID` — DocuSign account ID
- `DOCUSIGN_PRIVATE_KEY` — RSA private key PEM (use `\n` for newlines in env)
- `DOCUSIGN_SENDER_EMAIL` — Email for the second signer (Arsonist AI)
- `DOCUSIGN_SENDER_NAME` — Optional; defaults to "Arsonist AI"
- `DOCUSIGN_AUTH_SERVER` — Optional; e.g. `account-d.docusign.com` for demo

Grant JWT consent for the app in DocuSign Admin (one-time).

## 2. Enable the flow on proposal pages

In each proposal HTML file, set the API base URL so the page can call the Vercel function:

```html
<script>
  var PROPOSAL_ENVELOPE_API = 'https://your-vercel-app.vercel.app';
</script>
```

Replace with your actual Vercel deployment URL. If `PROPOSAL_ENVELOPE_API` is empty, Accept only updates the UI (no PDF, no DocuSign).

## 3. API

- **POST** `/api/send-proposal-envelope`
- Body: `{ pdfBase64, clientName, clientEmail, proposalId }`
- Response: `{ signingUrl }` (redirect the client here) or `{ error, fallback }` on failure.
