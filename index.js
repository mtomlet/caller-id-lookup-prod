/**
 * Caller ID Lookup - PRODUCTION (Phoenix Encanto)
 *
 * Railway-deployable endpoint for Retell AI inbound webhooks
 * Looks up caller by phone number, returns customer info for dynamic variables
 *
 * PRODUCTION CREDENTIALS - DO NOT USE FOR TESTING
 * Location: Keep It Cut - Phoenix Encanto (201664)
 *
 * Search Strategy:
 * 1. First search CDC (Change Data Capture) for recent changes (fast)
 * 2. Then paginate through /clients endpoint
 */

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// PRODUCTION Meevo API Configuration
const CONFIG = {
  AUTH_URL: 'https://marketplace.meevo.com/oauth2/token',
  API_URL: 'https://na1pub.meevo.com/publicapi/v1',
  CLIENT_ID: 'f6a5046d-208e-4829-9941-034ebdd2aa65',
  CLIENT_SECRET: '2f8feb2e-51f5-40a3-83af-3d4a6a454abe',
  TENANT_ID: '200507',
  LOCATION_ID: '201664'  // Phoenix Encanto
};

let token = null;
let tokenExpiry = null;

async function getToken() {
  if (token && tokenExpiry && Date.now() < tokenExpiry - 300000) return token;

  console.log('[Auth] Getting fresh PRODUCTION token...');
  const res = await axios.post(CONFIG.AUTH_URL, {
    client_id: CONFIG.CLIENT_ID,
    client_secret: CONFIG.CLIENT_SECRET
  });

  token = res.data.access_token;
  tokenExpiry = Date.now() + (res.data.expires_in * 1000);
  console.log('[Auth] PRODUCTION token obtained');
  return token;
}

// Clean phone to 10 digits (remove country code if 11 digits starting with 1)
function normalizePhone(phone) {
  let clean = (phone || '').replace(/\D/g, '');
  if (clean.length === 11 && clean.startsWith('1')) {
    clean = clean.substring(1);
  }
  return clean;
}

// Search CDC for recent changes (fast, last 3 days)
async function searchCDC(authToken, phoneToFind) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 3);
  const dateStr = startDate.toISOString().split('T')[0];

  for (let page = 1; page <= 10; page++) {
    try {
      const res = await axios.get(
        `${CONFIG.API_URL}/cdc/entity/Client/changes?tenantid=${CONFIG.TENANT_ID}&locationid=${CONFIG.LOCATION_ID}&StartDate=${dateStr}&PageNumber=${page}&format=json`,
        { headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/json' } }
      );

      const data = res.data.data || [];
      if (data.length === 0) break;

      for (const change of data) {
        const c = change.Client_T;
        if (!c || !c.ClientPhone_T) continue;

        for (const phone of c.ClientPhone_T) {
          const phoneNum = normalizePhone(phone.PhoneNumber || phone.FullPhoneNumber);
          if (phoneNum === phoneToFind) {
            return {
              clientId: c.EntityId,
              firstName: c.FirstName,
              lastName: c.LastName,
              emailAddress: c.EmailAddress,
              primaryPhoneNumber: phoneNum,
              source: 'cdc'
            };
          }
        }
      }
    } catch (err) {
      console.log(`[CDC] Error on page ${page}:`, err.message);
      break;
    }
  }
  return null;
}

// Search /clients endpoint with pagination
// NOTE: Meevo returns DIFFERENT results based on ItemsPerPage! Using 20 for consistency.
async function searchClients(authToken, phoneToFind, maxPages = 250) {
  for (let page = 1; page <= maxPages; page++) {
    try {
      const res = await axios.get(
        `${CONFIG.API_URL}/clients?tenantid=${CONFIG.TENANT_ID}&locationid=${CONFIG.LOCATION_ID}&PageNumber=${page}&ItemsPerPage=20`,
        { headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/json' } }
      );

      const clients = res.data.data || [];
      if (clients.length === 0) break;

      for (const c of clients) {
        if (normalizePhone(c.primaryPhoneNumber) === phoneToFind) {
          return {
            clientId: c.clientId,
            firstName: c.firstName,
            lastName: c.lastName,
            emailAddress: c.emailAddress,
            primaryPhoneNumber: c.primaryPhoneNumber,
            source: 'clients'
          };
        }
      }
    } catch (err) {
      console.log(`[Clients] Error on page ${page}:`, err.message);
      break;
    }
  }
  return null;
}

// Combined search: CDC first (fast), then /clients (comprehensive)
async function findClientByPhone(authToken, phoneToFind) {
  // Step 1: Search CDC for recent changes (fast)
  console.log(`[Search] Checking CDC for recent changes...`);
  let client = await searchCDC(authToken, phoneToFind);
  if (client) {
    console.log(`[Search] Found in CDC: ${client.firstName} ${client.lastName}`);
    return client;
  }

  // Step 2: Search /clients endpoint (max 250 pages × 20 per page = 5000 clients)
  console.log(`[Search] Checking /clients endpoint...`);
  client = await searchClients(authToken, phoneToFind, 250);
  if (client) {
    console.log(`[Search] Found in /clients: ${client.firstName} ${client.lastName}`);
    return client;
  }

  return null;
}

// Retell AI Inbound Webhook Handler
// Request: { "event": "call_inbound", "call_inbound": { "from_number": "+1234567890", "to_number": "+0987654321" } }
// Response: { "call_inbound": { "dynamic_variables": { ... } } }
app.post('/lookup', async (req, res) => {
  try {
    console.log('[Webhook] Received:', JSON.stringify(req.body));

    const { event, call_inbound } = req.body;

    // Extract phone - Retell sends from_number inside call_inbound object
    const phone = call_inbound?.from_number || req.body.phone;

    // For Retell inbound webhooks, always return call_inbound response format
    if (event === 'call_inbound') {
      if (!phone) {
        console.log('[Webhook] No phone number provided');
        return res.status(200).json({
          call_inbound: {
            dynamic_variables: {
              existing_customer: 'false',
              first_name: '',
              last_name: '',
              client_id: '',
              email: ''
            }
          }
        });
      }

      const cleanPhone = normalizePhone(phone);
      console.log(`[Lookup] Searching for phone: ${phone} (normalized: ${cleanPhone})`);

      const authToken = await getToken();
      const client = await findClientByPhone(authToken, cleanPhone);

      if (!client) {
        console.log(`[Lookup] Not found - new customer`);
        return res.status(200).json({
          call_inbound: {
            dynamic_variables: {
              existing_customer: 'false',
              first_name: '',
              last_name: '',
              client_id: '',
              email: '',
              phone: phone
            }
          }
        });
      }

      console.log(`[Lookup] Found: ${client.firstName} ${client.lastName}`);
      return res.status(200).json({
        call_inbound: {
          dynamic_variables: {
            existing_customer: 'true',
            first_name: client.firstName || '',
            last_name: client.lastName || '',
            client_id: client.clientId || '',
            email: client.emailAddress || '',
            phone: client.primaryPhoneNumber || phone
          }
        }
      });
    }

    // Non-Retell direct API call (for testing)
    if (!phone) {
      return res.json({
        existing_customer: false,
        first_name: null,
        last_name: null,
        client_id: null,
        email: null,
        phone: null
      });
    }

    const cleanPhone = normalizePhone(phone);
    const authToken = await getToken();
    const client = await findClientByPhone(authToken, cleanPhone);

    if (!client) {
      return res.json({
        existing_customer: false,
        first_name: null,
        last_name: null,
        client_id: null,
        email: null,
        phone: phone
      });
    }

    res.json({
      existing_customer: true,
      first_name: client.firstName || null,
      last_name: client.lastName || null,
      client_id: client.clientId,
      email: client.emailAddress || null,
      phone: client.primaryPhoneNumber || phone,
      source: client.source
    });

  } catch (error) {
    console.error('[Lookup] Error:', error.message);

    // Always return valid response for Retell - don't let errors block calls
    const { event, call_inbound } = req.body || {};
    const phone = call_inbound?.from_number || req.body?.phone || '';

    if (event === 'call_inbound') {
      return res.status(200).json({
        call_inbound: {
          dynamic_variables: {
            existing_customer: 'false',
            first_name: '',
            last_name: '',
            client_id: '',
            email: '',
            phone: phone
          }
        }
      });
    }

    res.json({
      existing_customer: false,
      first_name: null,
      last_name: null,
      client_id: null,
      email: null,
      phone: phone || null,
      error: error.message
    });
  }
});

app.get('/health', (req, res) => res.json({
  status: 'ok',
  environment: 'PRODUCTION',
  location_id: CONFIG.LOCATION_ID
}));

// Test endpoint
app.get('/test-lookup', async (req, res) => {
  try {
    const phone = req.query.phone || '';
    if (!phone) {
      return res.json({ error: 'Phone query parameter required' });
    }

    const cleanPhone = normalizePhone(phone);
    console.log(`[Test] Searching for: ${cleanPhone}`);

    const authToken = await getToken();
    const startTime = Date.now();

    const client = await findClientByPhone(authToken, cleanPhone);

    res.json({
      search_phone: cleanPhone,
      elapsed_ms: Date.now() - startTime,
      found: client || null
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Caller ID lookup server running on port ${PORT} (PRODUCTION)`));
