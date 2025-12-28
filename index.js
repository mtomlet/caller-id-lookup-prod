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

    const authToken = await getToken();

    // Look up client by phone
    const clientsRes = await axios.get(
      `${CONFIG.API_URL}/clients?TenantId=${CONFIG.TENANT_ID}&LocationId=${CONFIG.LOCATION_ID}`,
      { headers: { Authorization: `Bearer ${authToken}` }}
    );

    const clients = clientsRes.data.data || clientsRes.data;

    // Clean phone: remove non-digits, then strip leading 1 if 11 digits (US country code)
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
      cleanPhone = cleanPhone.substring(1);
    }

    const client = clients.find(c => {
      let clientPhone = (c.primaryPhoneNumber || '').replace(/\D/g, '');
      if (clientPhone.length === 11 && clientPhone.startsWith('1')) {
        clientPhone = clientPhone.substring(1);
      }
      return clientPhone === cleanPhone;
    });

    if (!client) {
      // New customer - return null values
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

    // Existing customer - return their info for Retell dynamic variables
    console.log('Found existing customer:', client.firstName, client.lastName);

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
      phone: client.primaryPhoneNumber || phone
    });

  } catch (error) {
    console.error('PRODUCTION Caller ID lookup error:', error.message);
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
  location: 'Phoenix Encanto',
  location_id: CONFIG.LOCATION_ID
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PRODUCTION Caller ID lookup server running on port ${PORT}`));
