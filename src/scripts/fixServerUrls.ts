import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const VAPI_API_KEY = process.env.VAPI_API_KEY!;
const VAPI_BASE_URL = 'https://api.vapi.ai';
const CORRECT_SERVER_URL = 'https://tablenow.io/api/vapi/webhook';

const headers = {
    'Authorization': `Bearer ${VAPI_API_KEY}`,
    'Content-Type': 'application/json'
};

async function fixServerUrls() {
    console.log('🔧 Fixing Server URLs on ALL VAPI phone numbers...\n');

    const phonesRes = await axios.get(`${VAPI_BASE_URL}/phone-number`, { headers });
    const phones = phonesRes.data;

    for (const phone of phones) {
        const label = phone.number || phone.name || phone.id;
        const currentUrl = phone.serverUrl || '(none)';
        
        if (currentUrl !== CORRECT_SERVER_URL) {
            console.log(`❌ ${label} has WRONG serverUrl: ${currentUrl}`);
            console.log(`   🔧 Fixing to: ${CORRECT_SERVER_URL}...`);
            try {
                await axios.patch(
                    `${VAPI_BASE_URL}/phone-number/${phone.id}`,
                    { serverUrl: CORRECT_SERVER_URL },
                    { headers }
                );
                console.log(`   ✅ Fixed!\n`);
            } catch (err: any) {
                console.error(`   ❌ Failed:`, err.response?.data || err.message);
            }
        } else {
            console.log(`✅ ${label} already has correct serverUrl`);
        }
    }

    // Also fix ALL assistants
    console.log('\n🤖 Fixing Server URLs on ALL assistants...\n');
    const assistantsRes = await axios.get(`${VAPI_BASE_URL}/assistant`, { headers });
    const assistants = assistantsRes.data;

    for (const assistant of assistants) {
        const currentUrl = assistant.serverUrl || '(none)';
        if (currentUrl !== CORRECT_SERVER_URL) {
            console.log(`❌ Assistant "${assistant.name}" has WRONG serverUrl: ${currentUrl}`);
            console.log(`   🔧 Fixing...`);
            try {
                await axios.patch(
                    `${VAPI_BASE_URL}/assistant/${assistant.id}`,
                    { serverUrl: CORRECT_SERVER_URL },
                    { headers }
                );
                console.log(`   ✅ Fixed!\n`);
            } catch (err: any) {
                console.error(`   ❌ Failed:`, err.response?.data || err.message);
            }
        } else {
            console.log(`✅ Assistant "${assistant.name}" already has correct serverUrl`);
        }
    }

    console.log('\n🎉 All server URLs are now pointing to the correct webhook!');
}

fixServerUrls().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
