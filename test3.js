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

    // Search all clients and list those with phone containing 757
    console.log('Listing ALL clients with phone containing 757 or last name "Holton":\n');

    for (let page = 1; page <= 50; page++) {
      const res = await axios.get(
        `${CONFIG.API_URL}/clients?TenantId=${CONFIG.TENANT_ID}&LocationId=${CONFIG.LOCATION_ID}&PageNumber=${page}`,
        { headers: { Authorization: `Bearer ${token}` }}
      );

      const clients = res.data.data || [];
      if (clients.length === 0) break;

      for (const c of clients) {
        const phone = c.primaryPhoneNumber || '';

        if (phone.includes('757') || (c.lastName && c.lastName.toLowerCase().includes('holton'))) {
          console.log(`Page ${page}: ${c.firstName} ${c.lastName}, Phone: ${phone}, ID: ${c.clientId}`);
        }
      }
    }

    // Also try to get a specific client by ID (the one from the conversation summary)
    console.log('\n--- Trying to fetch client by ID ---');
    const clientId = '6fd3f551-c045-4896-b4b1-b3c80026822f';
    try {
      const clientRes = await axios.get(
        `${CONFIG.API_URL}/client/${clientId}?TenantId=${CONFIG.TENANT_ID}`,
        { headers: { Authorization: `Bearer ${token}` }}
      );
      console.log('Client found:', clientRes.data);
    } catch (err) {
      console.log('Client not found by ID:', err.response?.status, err.response?.data);
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
