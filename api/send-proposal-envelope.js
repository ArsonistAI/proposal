const docusign = require('docusign-esign');

const MAX_PDF_BYTES = 5 * 1024 * 1024; // 5MB
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function jsonResponse(res, status, data) {
  res.writeHead(status, corsHeaders());
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
  const authServer = process.env.DOCUSIGN_AUTH_SERVER || 'account-d.docusign.com';

  if (!integrationKey || !userId || !accountId || !privateKey || !senderEmail) {
    return jsonResponse(res, 503, { error: 'DocuSign not configured', fallback: true });
  }

  function normalizePrivateKey(raw) {
    // Handle escaped newlines (e.g. stored as literal \n in env var)
    let k = raw.replace(/\\n/g, '\n');
    // If still no real newlines, the key is a single line — reformat as PEM
    if (!k.includes('\n')) {
      const headerMatch = k.match(/^(-----[^-]+-----)(.+)(-----[^-]+-----)$/);
      if (headerMatch) {
        const header = headerMatch[1];
        const b64 = headerMatch[2].replace(/\s/g, '');
        const footer = headerMatch[3];
        const lines = b64.match(/.{1,64}/g) || [b64];
        k = header + '\n' + lines.join('\n') + '\n' + footer;
      }
    }
    return k;
  }

  function getToken() {
    return new Promise(function (resolve, reject) {
      const apiClient = new docusign.ApiClient();
      apiClient.setOAuthBasePath(authServer);
      const keyStr = normalizePrivateKey(privateKey);
      console.log('JWT key length:', keyStr.length, '| has header:', keyStr.includes('BEGIN'), '| authServer:', authServer, '| userId:', userId, '| integrationKey:', integrationKey ? integrationKey.substring(0, 8) + '...' : 'MISSING');
      apiClient.requestJWTUserToken(
        integrationKey,
        userId,
        ['signature', 'impersonation'],
        Buffer.from(keyStr, 'utf8'),
        600,
        function (err, token) {
          if (err) {
            const jwtBody = err && err.response && err.response.body;
            console.error('JWT auth failed:', err.message, '| body:', JSON.stringify(jwtBody));
            return reject(Object.assign(err, { isJwtError: true }));
          }
          resolve(token);
        }
      );
    });
  }

  try {
    const token = await getToken();
    if (!token || !token.body || !token.body.access_token) {
      throw new Error('JWT token request failed - no access_token');
    }

    const apiClient = new docusign.ApiClient();
    apiClient.addDefaultHeader('Authorization', 'Bearer ' + token.body.access_token);

    // Resolve base path from token accounts; fallback based on authServer
    let basePath;
    const accounts = (token.body && token.body.accounts) || [];
    const acc = accounts.find(function (a) {
      return a.account_id === accountId || a.account_guid === accountId;
    });
    if (acc && acc.base_uri) {
      basePath = acc.base_uri + '/restapi/v2.1';
    } else if (authServer.includes('account-d.')) {
      basePath = 'https://demo.docusign.net/restapi/v2.1';
    } else {
      basePath = 'https://na4.docusign.net/restapi/v2.1';
    }
    console.log('DocuSign basePath:', basePath, '| accounts in token:', accounts.length, '| matched:', !!acc);
    apiClient.setBasePath(basePath);

    const envelopesApi = new docusign.EnvelopesApi(apiClient);

    const doc = new docusign.Document.constructFromObject({
      documentBase64: pdfBase64,
      name: 'Proposal-' + String(proposalId).replace(/[^a-zA-Z0-9-_]/g, '_') + '.pdf',
      fileExtension: 'pdf',
      documentId: '1',
    });

    // clientUserId must be set here AND in createRecipientView for embedded signing
    const clientSigner = new docusign.Signer.constructFromObject({
      email: emailTrimmed,
      name: nameTrimmed,
      recipientId: '1',
      routingOrder: '1',
      clientUserId: '1',
      tabs: new docusign.Tabs.constructFromObject({
        signHereTabs: [
          new docusign.SignHere.constructFromObject({
            anchorString: 'Client:',
            anchorIgnoreIfNotPresent: 'true',
            anchorUnits: 'pixels',
            anchorYOffset: '5',
            anchorXOffset: '10',
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
            anchorIgnoreIfNotPresent: 'true',
            anchorUnits: 'pixels',
            anchorYOffset: '5',
            anchorXOffset: '10',
          }),
        ],
      }),
    });

    const envelopeDefinition = new docusign.EnvelopeDefinition.constructFromObject({
      emailSubject: 'Proposal ' + proposalId + ' - Please sign',
      documents: [doc],
      recipients: new docusign.Recipients.constructFromObject({
        signers: [clientSigner, senderSigner],
      }),
      status: 'sent',
    });

    console.log('Creating envelope for:', emailTrimmed, '| proposalId:', proposalId, '| pdfBytes:', pdfBuffer.length);

    const createResult = await envelopesApi.createEnvelope(accountId, {
      envelopeDefinition: envelopeDefinition,
    });

    const envelopeId = createResult.envelopeId;
    if (!envelopeId) {
      throw new Error('No envelopeId in create response');
    }

    console.log('Envelope created:', envelopeId);

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
    const message = err && err.message ? err.message : String(err);
    const errResp = err && err.response ? err.response : null;
    const httpStatus = errResp && errResp.status;
    let dsBody = (errResp && errResp.body) || (errResp && errResp.data);
    if (typeof dsBody === 'string') {
      try { dsBody = dsBody.length ? JSON.parse(dsBody) : null; } catch (_) { dsBody = { raw: dsBody }; }
    }
    // Log everything so it appears in Vercel function logs
    console.error('DocuSign error | message:', message, '| http status:', httpStatus, '| body:', JSON.stringify(dsBody), '| isJwtError:', !!(err && err.isJwtError));

    let detail = message;
    if (dsBody && typeof dsBody === 'object') {
      if (dsBody.message) detail = dsBody.message;
      if (dsBody.error) detail = dsBody.error + (dsBody.error_description ? ': ' + dsBody.error_description : '');
      if (dsBody.errorCode) detail += ' [' + dsBody.errorCode + ']';
    }

    const isJwt = err && err.isJwtError;
    return jsonResponse(res, 502, {
      error: isJwt ? 'DocuSign authentication failed' : 'Could not create signing session',
      detail: detail,
      hint: isJwt ? 'Check DOCUSIGN_PRIVATE_KEY format, DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, and DOCUSIGN_AUTH_SERVER in Vercel env vars' : undefined,
      docusignStatus: httpStatus,
      docusignBody: dsBody || undefined,
    });
  }
};
