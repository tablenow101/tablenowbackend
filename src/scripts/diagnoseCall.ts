import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const VAPI_API_KEY = process.env.VAPI_API_KEY!;
const VAPI_BASE_URL = 'https://api.vapi.ai';
const headers = {
    'Authorization': `Bearer ${VAPI_API_KEY}`,
    'Content-Type': 'application/json'
};

async function diagnose() {
    const phoneId = 'def073f3-451f-4ef7-8033-05d62a33749f';
    const assistantId = '35d95e8c-22ae-4f1f-955c-d9de5dce815a';

    console.log('=== PHONE NUMBER CHECK ===');
    try {
        const phoneRes = await axios.get(`${VAPI_BASE_URL}/phone-number/${phoneId}`, { headers });
        const phone = phoneRes.data;
        console.log(`  ID:          ${phone.id}`);
        console.log(`  Number:      ${phone.number}`);
        console.log(`  AssistantId: ${phone.assistantId}`);
        console.log(`  ServerUrl:   ${phone.serverUrl}`);
        console.log(`  Provider:    ${phone.provider}`);
        console.log(`  Status:      ${phone.status}`);
        console.log(`  FULL:        ${JSON.stringify(phone, null, 2)}`);
    } catch (err: any) {
        console.error('Phone lookup failed:', err.response?.data || err.message);
    }

    console.log('\n=== ASSISTANT CHECK ===');
    try {
        const asstRes = await axios.get(`${VAPI_BASE_URL}/assistant/${assistantId}`, { headers });
        const asst = asstRes.data;
        console.log(`  ID:          ${asst.id}`);
        console.log(`  Name:        ${asst.name}`);
        console.log(`  ServerUrl:   ${asst.serverUrl}`);
        console.log(`  Model:       ${asst.model?.model}`);
        console.log(`  FirstMsg:    ${asst.firstMessage}`);
        console.log(`  Tools:       ${asst.model?.tools?.length || 0}`);
    } catch (err: any) {
        console.error('Assistant lookup failed:', err.response?.data || err.message);
    }
}

diagnose();
