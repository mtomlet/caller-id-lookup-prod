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

  // Get full client details including phoneNumbers
  const clientId = '6fd3f551-c045-4896-b4b1-b3c80026822f';
  const res = await axios.get(
    `${CONFIG.API_URL}/client/${clientId}?TenantId=${CONFIG.TENANT_ID}&LocationId=${CONFIG.LOCATION_ID}`,
    { headers: { Authorization: `Bearer ${token}` }}
  );

  console.log('Amy Holton full data:');
  console.log(JSON.stringify(res.data.data, null, 2));
}

main().catch(console.error);
