/**
 * Caller ID Lookup - PRODUCTION (Phoenix Encanto)
 *
 * Railway-deployable endpoint for Retell AI inbound webhooks
 * Looks up caller by phone number, returns customer info for dynamic variables
 *
 * PRODUCTION CREDENTIALS - DO NOT USE FOR TESTING
 * Location: Keep It Cut - Phoenix Encanto (201664)
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

    // STEP 2: Search using CDC endpoint (includes newly created clients)
    console.log(`[Lookup] Searching Meevo CDC for phone: ${cleanPhone}`);
    const authToken = await getToken();

    let client = null;
    let pageNumber = 1;
    const maxPages = 20;

    while (!client && pageNumber <= maxPages) {
      const cdcRes = await axios.get(
        `${CONFIG.API_URL}/cdc/entity/Client/changes?tenantid=${CONFIG.TENANT_ID}&locationid=${CONFIG.LOCATION_ID}&StartDate=2020-01-01&PageNumber=${pageNumber}&format=json`,
        { headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/json' }}
      );

      const changes = cdcRes.data.data || cdcRes.data || [];
      if (!changes.length) break;

      // Extract Client_T data and search by phone
      for (const change of changes) {
        const c = change.Client_T;
        if (!c || !c.ClientPhone_T) continue;

        // Check if any phone matches
        const phoneMatch = c.ClientPhone_T.some(p =>
          normalizePhone(p.PhoneNumber) === cleanPhone ||
          normalizePhone(p.FullPhoneNumber) === cleanPhone
        );

        if (phoneMatch) {
          // Convert CDC format to standard format
          client = {
            clientId: c.EntityId,
            firstName: c.FirstName,
            lastName: c.LastName,
            emailAddress: c.EmailAddress,
            primaryPhoneNumber: c.ClientPhone_T[0]?.PhoneNumber
          };
          console.log(`[Lookup] Found in CDC page ${pageNumber}: ${c.FirstName} ${c.LastName}`);
          break;
        }
      }

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
  environment: 'PRODUCTION',
  location_id: CONFIG.LOCATION_ID,
  pagination: 'enabled',
  cache_size: phoneCache.size,
  cache_entries: Array.from(phoneCache.entries()).map(([phone, data]) => ({
    phone,
    name: `${data.firstName} ${data.lastName}`,
    clientId: data.clientId.substring(0, 8) + '...'
  }))
}));

// Debug endpoint - search CDC by phone
app.get('/debug', async (req, res) => {
  try {
    const phone = normalizePhone(req.query.phone || '7571234999');
    const authToken = await getToken();

    // Get all CDC pages
    let allClients = [];
    let page = 1;
    while (page <= 20) {
      const cdcRes = await axios.get(
        `${CONFIG.API_URL}/cdc/entity/Client/changes?tenantid=${CONFIG.TENANT_ID}&locationid=${CONFIG.LOCATION_ID}&StartDate=2026-01-01&PageNumber=${page}&format=json`,
        { headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/json' }}
      );
      const changes = cdcRes.data.data || cdcRes.data || [];
      if (!changes.length) break;
      allClients = allClients.concat(changes.map(c => c.Client_T).filter(c => c));
      page++;
    }

    // Search by phone in ClientPhone_T array
    const found = allClients.find(c => {
      if (!c.ClientPhone_T) return false;
      return c.ClientPhone_T.some(p => normalizePhone(p.PhoneNumber) === phone || normalizePhone(p.FullPhoneNumber) === phone);
    });

    // Filter to our location
    const ourLocation = allClients.filter(c => c.LocationId === 201664 || c.HomeLocationId === 201664);

    res.json({
      total_clients: allClients.length,
      pages_fetched: page - 1,
      our_location_count: ourLocation.length,
      search_phone: phone,
      found: found ? {
        id: found.EntityId,
        name: found.FirstName + ' ' + found.LastName,
        location: found.LocationId,
        phones: found.ClientPhone_T
      } : null,
      our_location_sample: ourLocation.slice(0, 3).map(c => ({
        name: c.FirstName + ' ' + c.LastName,
        phone: c.ClientPhone_T?.[0]?.PhoneNumber
      }))
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Caller ID lookup server running on port ${PORT} (PRODUCTION)`));
