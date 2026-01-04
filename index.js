/**
 * Caller ID Lookup - TESTBED
 *
 * Railway-deployable endpoint for Retell AI inbound webhooks
 * Looks up caller by phone number, returns customer info for dynamic variables
 *
 * TESTBED CREDENTIALS
 * Location: Testbed Location 5
 *
 * IMPORTANT: Meevo /clients list is a cached snapshot that doesn't include
 * recently created clients. This service maintains a local phone cache that
 * gets populated when create_profile creates new clients.
 */

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// TESTBED Meevo API Configuration
const CONFIG = {
  AUTH_URL: 'https://d18devmarketplace.meevodev.com/oauth2/token',
  API_URL: 'https://d18devpub.meevodev.com/publicapi/v1',
  CLIENT_ID: 'a7139b22-775f-4938-8ecb-54aa23a1948d',
  CLIENT_SECRET: 'b566556f-e65d-47dd-a27d-dd1060d9fe2d',
  TENANT_ID: '4',
  LOCATION_ID: '5'
};

// In-memory phone cache for recently created clients
// Key: normalized phone (10 digits), Value: { clientId, firstName, lastName, email, phone, createdAt }
const phoneCache = new Map();

// Clean phone to 10 digits (remove country code if 11 digits starting with 1)
function normalizePhone(phone) {
  let clean = (phone || '').replace(/\D/g, '');
  if (clean.length === 11 && clean.startsWith('1')) {
    clean = clean.substring(1);
  }
  return clean;
}

let token = null;
let tokenExpiry = null;

async function getToken() {
  if (token && tokenExpiry && Date.now() < tokenExpiry - 300000) return token;

  console.log('Getting fresh PRODUCTION token...');
  const res = await axios.post(CONFIG.AUTH_URL, {
    client_id: CONFIG.CLIENT_ID,
    client_secret: CONFIG.CLIENT_SECRET
  });

  token = res.data.access_token;
  tokenExpiry = Date.now() + (res.data.expires_in * 1000);
  console.log('PRODUCTION token obtained');
  return token;
}

// Cache endpoint - called by create_profile when new clients are created
// This bypasses the Meevo /clients cache delay issue
app.post('/cache', (req, res) => {
  try {
    const { client_id, first_name, last_name, email, phone } = req.body;

    if (!phone || !client_id) {
      return res.status(400).json({ success: false, error: 'phone and client_id required' });
    }

    const normalizedPhone = normalizePhone(phone);
    phoneCache.set(normalizedPhone, {
      clientId: client_id,
      firstName: first_name || '',
      lastName: last_name || '',
      email: email || '',
      phone: phone,
      createdAt: new Date().toISOString()
    });

    console.log(`[Cache] Added: ${normalizedPhone} -> ${client_id} (${first_name} ${last_name})`);
    res.json({ success: true, cached_phone: normalizedPhone });
  } catch (error) {
    console.error('[Cache] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper: Look up client directly by ID from Meevo (works for new clients)
async function lookupClientById(clientId, authToken) {
  try {
    const res = await axios.get(
      `${CONFIG.API_URL}/client/${clientId}?TenantId=${CONFIG.TENANT_ID}&LocationId=${CONFIG.LOCATION_ID}`,
      { headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/json' }}
    );
    return res.data.data || null;
  } catch (err) {
    console.log(`[Direct Lookup] Client ${clientId} not found:`, err.message);
    return null;
  }
}

app.post('/lookup', async (req, res) => {
  try {
    // Handle Retell AI inbound webhook format
    const { event, call_inbound } = req.body;

    // Extract phone from inbound webhook or direct call
    const phone = call_inbound?.from_number || req.body.phone;

    if (!phone) {
      // Return in Retell inbound webhook format
      if (event === 'call_inbound') {
        return res.json({
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
      // Fallback for direct calls
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
    console.log(`[Lookup] Searching for phone: ${phone} (normalized: ${cleanPhone})`);

    // STEP 1: Check local cache FIRST (for recently created clients)
    const cached = phoneCache.get(cleanPhone);
    if (cached) {
      console.log(`[Lookup] CACHE HIT: ${cached.firstName} ${cached.lastName} (${cached.clientId})`);

      // Verify with direct Meevo lookup to get latest data
      const authToken = await getToken();
      const meevoClient = await lookupClientById(cached.clientId, authToken);

      if (meevoClient) {
        console.log(`[Lookup] Verified via Meevo direct lookup`);
        const client = meevoClient;

        if (event === 'call_inbound') {
          return res.json({
            call_inbound: {
              dynamic_variables: {
                existing_customer: 'true',
                first_name: client.firstName || cached.firstName,
                last_name: client.lastName || cached.lastName,
                client_id: client.clientId || cached.clientId,
                email: client.emailAddress || cached.email,
                phone: phone
              }
            }
          });
        }
        return res.json({
          existing_customer: true,
          first_name: client.firstName || cached.firstName,
          last_name: client.lastName || cached.lastName,
          client_id: client.clientId || cached.clientId,
          email: client.emailAddress || cached.email,
          phone: phone,
          source: 'cache+meevo'
        });
      }

      // Cache hit but Meevo lookup failed - use cached data
      console.log(`[Lookup] Using cached data (Meevo verify failed)`);
      if (event === 'call_inbound') {
        return res.json({
          call_inbound: {
            dynamic_variables: {
              existing_customer: 'true',
              first_name: cached.firstName,
              last_name: cached.lastName,
              client_id: cached.clientId,
              email: cached.email,
              phone: phone
            }
          }
        });
      }
      return res.json({
        existing_customer: true,
        first_name: cached.firstName,
        last_name: cached.lastName,
        client_id: cached.clientId,
        email: cached.email,
        phone: phone,
        source: 'cache'
      });
    }

    // STEP 2: Cache miss - search Meevo /clients list (paginated)
    console.log(`[Lookup] Cache miss, searching Meevo /clients...`);
    const authToken = await getToken();

    let client = null;
    let pageNumber = 1;
    const maxPages = 100; // Safety limit

    while (!client && pageNumber <= maxPages) {
      const clientsRes = await axios.get(
        `${CONFIG.API_URL}/clients?TenantId=${CONFIG.TENANT_ID}&LocationId=${CONFIG.LOCATION_ID}&PageNumber=${pageNumber}`,
        { headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/json' }}
      );

      const clients = clientsRes.data.data || clientsRes.data;

      if (!clients || clients.length === 0) {
        console.log(`[Lookup] No more clients at page ${pageNumber}`);
        break;
      }

      console.log(`[Lookup] Searching page ${pageNumber} (${clients.length} clients)`);

      client = clients.find(c => {
        const clientPhone = normalizePhone(c.primaryPhoneNumber);
        return clientPhone === cleanPhone;
      });

      pageNumber++;
    }

    if (!client) {
      // New customer - return null values
      console.log(`[Lookup] Not found in Meevo - treating as new customer`);
      if (event === 'call_inbound') {
        return res.json({
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
      return res.json({
        existing_customer: false,
        first_name: null,
        last_name: null,
        client_id: null,
        email: null,
        phone: phone
      });
    }

    // Found in Meevo /clients list
    console.log(`[Lookup] Found in Meevo: ${client.firstName} ${client.lastName}`);

    // Return in Retell inbound webhook format
    if (event === 'call_inbound') {
      return res.json({
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

    // Fallback for direct calls
    res.json({
      existing_customer: true,
      first_name: client.firstName || null,
      last_name: client.lastName || null,
      client_id: client.clientId,
      email: client.emailAddress || null,
      phone: client.primaryPhoneNumber || phone,
      source: 'meevo'
    });

  } catch (error) {
    console.error('[Lookup] Error:', error.message);
    // On error, return as new customer to not block the call
    const { event, call_inbound } = req.body;
    const phone = call_inbound?.from_number || req.body.phone;

    if (event === 'call_inbound') {
      return res.json({
        call_inbound: {
          dynamic_variables: {
            existing_customer: 'false',
            first_name: '',
            last_name: '',
            client_id: '',
            email: '',
            phone: phone || '',
            error: error.message
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
  environment: 'TESTBED',
  location_id: CONFIG.LOCATION_ID,
  pagination: 'enabled',
  cache_size: phoneCache.size,
  cache_entries: Array.from(phoneCache.entries()).map(([phone, data]) => ({
    phone,
    name: `${data.firstName} ${data.lastName}`,
    clientId: data.clientId.substring(0, 8) + '...'
  }))
}));

// Debug endpoint to view cache
app.get('/cache', (req, res) => res.json({
  size: phoneCache.size,
  entries: Array.from(phoneCache.entries()).map(([phone, data]) => ({
    phone,
    ...data
  }))
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Caller ID lookup server running on port ${PORT} (TESTBED)`));
