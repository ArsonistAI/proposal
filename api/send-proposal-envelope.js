const docusign = require('docusign-esign');

const MAX_PDF_BYTES = 5 * 1024 * 1024; // 5MB
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function jsonResponse(res, status, data, headers) {
  res.writeHead(status, Object.assign({}, corsHeaders(), headers || {}));
  res.end(JSON.stringify(data));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch (e) {
    return jsonResponse(res, 400, { error: 'Invalid JSON body' });
  }

  const pdfBase64 = body.pdfBase64;
  const clientName = body.clientName;
  const clientEmail = body.clientEmail;
  const proposalId = body.proposalId;

  if (!pdfBase64 || !clientName || !clientEmail || !proposalId) {
    return jsonResponse(res, 400, {
      error: 'Missing required fields: pdfBase64, clientName, clientEmail, proposalId',
    });
  }

  const nameTrimmed = String(clientName).trim();
  const emailTrimmed = String(clientEmail).trim().toLowerCase();

  if (nameTrimmed.length < 1 || nameTrimmed.length > 200) {
    return jsonResponse(res, 400, { error: 'Invalid clientName length' });
  }
  if (!EMAIL_REGEX.test(emailTrimmed)) {
    return jsonResponse(res, 400, { error: 'Invalid clientEmail format' });
  }

  let pdfBuffer;
  try {
    pdfBuffer = Buffer.from(pdfBase64, 'base64');
  } catch (e) {
    return jsonResponse(res, 400, { error: 'Invalid pdfBase64' });
  }

  if (pdfBuffer.length > MAX_PDF_BYTES) {
    return jsonResponse(res, 400, { error: 'PDF exceeds 5MB limit' });
  }
  if (pdfBuffer.length < 100) {
    return jsonResponse(res, 400, { error: 'PDF too small to be valid' });
  }

  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
  const userId = process.env.DOCUSIGN_USER_ID;
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const privateKey = process.env.DOCUSIGN_PRIVATE_KEY;
  const senderEmail = process.env.DOCUSIGN_SENDER_EMAIL;
  const senderName = process.env.DOCUSIGN_SENDER_NAME || 'Arsonist AI';

  if (!integrationKey || !userId || !accountId || !privateKey || !senderEmail) {
    return jsonResponse(res, 503, {
      error: 'DocuSign not configured',
      fallback: true,
    });
  }

  function getToken() {
    return new Promise(function (resolve, reject) {
      const apiClient = new docusign.ApiClient();
      apiClient.setOAuthBasePath(process.env.DOCUSIGN_AUTH_SERVER || 'account-d.docusign.com');
      const keyBuf = Buffer.from(privateKey.replace(/\\n/g, '\n'), 'utf8');
      apiClient.requestJWTUserToken(
        integrationKey,
        userId,
        ['signature', 'impersonation'],
        keyBuf,
        600,
        function (err, token) {
          if (err) return reject(err);
          resolve(token);
        }
      );
    });
  }

  try {
    const token = await getToken();
    if (!token || !token.body || !token.body.access_token) {
      throw new Error('JWT token request failed');
    }

    const apiClient = new docusign.ApiClient();
    apiClient.setDefaultHeader('Authorization', 'Bearer ' + token.body.access_token);

    let basePath = 'https://demo.docusign.net/restapi/v2.1';
    if (token.body.accounts && token.body.accounts.length) {
      const acc = token.body.accounts.find(function (a) {
        return a.account_id === accountId;
      });
      if (acc && acc.base_uri) {
        basePath = acc.base_uri + '/restapi/v2.1';
      }
    }
    apiClient.setBasePath(basePath);

    const envelopesApi = new docusign.EnvelopesApi(apiClient);

    const doc = new docusign.Document.constructFromObject({
      documentBase64: pdfBase64,
      name: 'Proposal-' + String(proposalId).replace(/[^a-zA-Z0-9-_]/g, '_') + '.pdf',
      fileExtension: 'pdf',
      documentId: '1',
    });

    const clientSigner = new docusign.Signer.constructFromObject({
      email: emailTrimmed,
      name: nameTrimmed,
      recipientId: '1',
      routingOrder: '1',
      tabs: new docusign.Tabs.constructFromObject({
        signHereTabs: [
          new docusign.SignHere.constructFromObject({
            anchorString: 'Client:',
            anchorUnits: 'pixels',
            anchorYOffset: '5',
            anchorXOffset: '10',
            documentId: '1',
            pageNumber: '1',
          }),
        ],
      }),
    });

    const senderSigner = new docusign.Signer.constructFromObject({
      email: senderEmail,
      name: senderName,
      recipientId: '2',
      routingOrder: '2',
      tabs: new docusign.Tabs.constructFromObject({
        signHereTabs: [
          new docusign.SignHere.constructFromObject({
            anchorString: 'Arsonist AI:',
            anchorUnits: 'pixels',
            anchorYOffset: '5',
            anchorXOffset: '10',
            documentId: '1',
            pageNumber: '1',
          }),
        ],
      }),
    });

    const envelopeDefinition = new docusign.EnvelopeDefinition.constructFromObject({
      emailSubject: 'Proposal: ' + proposalId + ' – Please sign',
      documents: [doc],
      recipients: new docusign.Recipients.constructFromObject({
        signers: [clientSigner, senderSigner],
      }),
      status: 'sent',
    });

    const createResult = await envelopesApi.createEnvelope(accountId, {
      envelopeDefinition: envelopeDefinition,
    });

    const envelopeId = createResult.envelopeId;
    if (!envelopeId) {
      throw new Error('No envelopeId in create response');
    }

    const origin = (req.headers && req.headers.origin) || 'https://arsonistai.github.io';
    const viewRequest = new docusign.RecipientViewRequest.constructFromObject({
      returnUrl: origin + '/proposal/signed?envelope=' + envelopeId,
      clientUserId: '1',
      authenticationMethod: 'none',
      email: emailTrimmed,
      userName: nameTrimmed,
    });

    const viewResult = await envelopesApi.createRecipientView(accountId, envelopeId, {
      recipientViewRequest: viewRequest,
    });

    const signingUrl = viewResult && viewResult.url;
    if (!signingUrl) {
      throw new Error('No signing URL in recipient view response');
    }

    return jsonResponse(res, 200, { signingUrl: signingUrl });
  } catch (err) {
    const fallback = !integrationKey;
    return jsonResponse(res, 502, {
      error: 'Could not create signing session',
      fallback: fallback,
    });
  }
};
