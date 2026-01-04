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
  const token = await getToken();

  // Try to fetch specific client
  const clientId = '6fd3f551-c045-4896-b4b1-b3c80026822f';
  console.log('Looking for Amy Holton clientId:', clientId);

  try {
    const res = await axios.get(
      `${CONFIG.API_URL}/client/${clientId}?TenantId=${CONFIG.TENANT_ID}&LocationId=${CONFIG.LOCATION_ID}`,
      { headers: { Authorization: `Bearer ${token}` }}
    );
    console.log('Found:', res.data);
  } catch (err) {
    console.log('Not found:', err.response?.status, err.response?.data?.error?.message || err.message);
  }

  // Also search last 5 pages which might have newer clients
  console.log('\n--- Last 5 pages of clients ---');
  for (let page = 20; page >= 16; page--) {
    const res = await axios.get(
      `${CONFIG.API_URL}/clients?TenantId=${CONFIG.TENANT_ID}&LocationId=${CONFIG.LOCATION_ID}&PageNumber=${page}`,
      { headers: { Authorization: `Bearer ${token}` }}
    );
    const clients = res.data.data || [];
    console.log(`Page ${page}: ${clients.length} clients`);
    if (clients.length > 0) {
      // Show last 3 clients
      const last3 = clients.slice(-3);
      for (const c of last3) {
        console.log(`  - ${c.firstName} ${c.lastName}, ${c.primaryPhoneNumber || 'no phone'}, created: ${c.createdDateUtc || 'unknown'}`);
      }
    }
  }
}

main().catch(console.error);
