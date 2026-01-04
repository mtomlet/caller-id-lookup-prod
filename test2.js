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
    const token = await getToken();
    console.log('Searching for phone 7572277499 in all clients...\n');

    const phoneToFind = '7572277499';
    let found = false;

    for (let page = 1; page <= 50; page++) {
      const res = await axios.get(
        `${CONFIG.API_URL}/clients?TenantId=${CONFIG.TENANT_ID}&LocationId=${CONFIG.LOCATION_ID}&PageNumber=${page}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }}
      );

      const clients = res.data.data || [];
      if (clients.length === 0) break;

      for (const c of clients) {
        let clientPhone = (c.primaryPhoneNumber || '').replace(/\D/g, '');
        // Normalize phone (remove leading 1)
        if (clientPhone.length === 11 && clientPhone.startsWith('1')) {
          clientPhone = clientPhone.substring(1);
        }

        // Check if phone contains or matches
        if (clientPhone.includes(phoneToFind) || phoneToFind.includes(clientPhone)) {
          console.log(`FOUND on page ${page}:`, c.firstName, c.lastName, c.primaryPhoneNumber, c.clientId);
          found = true;
        }

        // Also check for "Holton" lastName
        if (c.lastName && c.lastName.toLowerCase() === 'holton') {
          console.log(`FOUND Holton:`, c.firstName, c.lastName, c.primaryPhoneNumber, c.clientId);
          found = true;
        }
      }
    }

    if (!found) {
      console.log('NOT FOUND: No client with phone 7572277499 or lastName "Holton"');
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
