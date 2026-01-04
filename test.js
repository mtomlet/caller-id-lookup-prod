const axios = require('axios');

const CONFIG = {
  AUTH_URL: 'https://d18devmarketplace.meevodev.com/oauth2/token',
  API_URL: 'https://d18devpub.meevodev.com/publicapi/v1',
  CLIENT_ID: 'a7139b22-775f-4938-8ecb-54aa23a1948d',
  CLIENT_SECRET: 'b566556f-e65d-47dd-a27d-dd1060d9fe2d',
  TENANT_ID: '4',
  LOCATION_ID: '5'
};

async function getToken() {
  const res = await axios.post(CONFIG.AUTH_URL, {
    client_id: CONFIG.CLIENT_ID,
    client_secret: CONFIG.CLIENT_SECRET
  });
  return res.data.access_token;
}

async function main() {
  try {
    console.log('Getting token...');
    const token = await getToken();
    console.log('Got token:', token.substring(0, 50) + '...');

    // Get clients page 1
    const url = `${CONFIG.API_URL}/clients?TenantId=${CONFIG.TENANT_ID}&LocationId=${CONFIG.LOCATION_ID}&PageNumber=1`;
    console.log('\nFetching:', url);

    const res = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    console.log('Status:', res.status);
    const clients = res.data.data || [];
    console.log('Clients on page 1:', clients.length);

    // Look for Amy
    for (const c of clients) {
      if (c.firstName === 'Amy') {
        console.log('Found Amy:', c.firstName, c.lastName, c.primaryPhoneNumber, c.clientId);
      }
    }

    // Search by phone 7572277499
    const phoneToFind = '7572277499';
    for (const c of clients) {
      let clientPhone = (c.primaryPhoneNumber || '').replace(/\D/g, '');
      if (clientPhone.length === 11 && clientPhone.startsWith('1')) {
        clientPhone = clientPhone.substring(1);
      }
      if (clientPhone === phoneToFind || clientPhone.includes(phoneToFind)) {
        console.log('Found by phone:', c.firstName, c.lastName, c.primaryPhoneNumber, c.clientId);
      }
    }

    // Now paginate through ALL pages
    console.log('\n--- Paginating all pages ---');
    let totalClients = 0;
    let amyFound = null;

    for (let page = 1; page <= 20; page++) {
      const pageRes = await axios.get(
        `${CONFIG.API_URL}/clients?TenantId=${CONFIG.TENANT_ID}&LocationId=${CONFIG.LOCATION_ID}&PageNumber=${page}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }}
      );

      const pageClients = pageRes.data.data || [];
      if (pageClients.length === 0) {
        console.log(`Page ${page}: Empty - stopping`);
        break;
      }

      totalClients += pageClients.length;
      console.log(`Page ${page}: ${pageClients.length} clients`);

      for (const c of pageClients) {
        if (c.firstName === 'Amy') {
          amyFound = c;
          console.log('  Found Amy:', c.firstName, c.lastName, c.primaryPhoneNumber, c.clientId);
        }
      }
    }

    console.log('\nTotal clients found:', totalClients);
    console.log('Amy found:', amyFound ? 'YES' : 'NO');

  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.status, error.response.data);
    }
  }
}

main();
