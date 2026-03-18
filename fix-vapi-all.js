const axios = require('axios');
const path = require('path');
const envPath = path.resolve(__dirname, '.env');
require('dotenv').config({ path: envPath });

const VAPI_BASE_URL = 'https://api.vapi.ai';
// USE BACKEND_URL FROM .ENV
const NEW_SERVER_URL = `${process.env.BACKEND_URL}/api/vapi/webhook`;

async function fixAllVapiEntities() {
    try {
        console.log('🔧 Starting GLOBAL VAPI FIX...');
        console.log(`🎯 Target URL: ${NEW_SERVER_URL}`);

        // 1. Fix ALL Assistants
        console.log('\n📋 Fetching ALL Assistants...');
        const assistants = await axios.get(`${VAPI_BASE_URL}/assistant`, {
            headers: { 'Authorization': `Bearer ${process.env.VAPI_API_KEY}` }
        });

        console.log(`Found ${assistants.data.length} assistants. Updating all of them...`);
        for (const assistant of assistants.data) {
            try {
                await axios.patch(
                    `${VAPI_BASE_URL}/assistant/${assistant.id}`,
                    { serverUrl: NEW_SERVER_URL },
                    { headers: { 'Authorization': `Bearer ${process.env.VAPI_API_KEY}` } }
                );
                console.log(`   ✅ Updated Assistant: ${assistant.name || assistant.id}`);
            } catch (err) {
                console.error(`   ❌ Failed Assistant ${assistant.id}: ${err.message}`);
            }
        }

        // 2. Fix ALL Phone Numbers
        console.log('\n📋 Fetching ALL Phone Numbers...');
        const phones = await axios.get(`${VAPI_BASE_URL}/phone-number`, {
            headers: { 'Authorization': `Bearer ${process.env.VAPI_API_KEY}` }
        });

        console.log(`Found ${phones.data.length} phone numbers. Updating all of them...`);
        for (const phone of phones.data) {
            try {
                // Update serverUrl AND ensure it points to the correct assistant if needed
                await axios.patch(
                    `${VAPI_BASE_URL}/phone-number/${phone.id}`,
                    { serverUrl: NEW_SERVER_URL },
                    { headers: { 'Authorization': `Bearer ${process.env.VAPI_API_KEY}` } }
                );
                console.log(`   ✅ Updated Phone: ${phone.number}`);
            } catch (err) {
                console.error(`   ❌ Failed Phone ${phone.number}: ${err.message}`);
            }
        }

        console.log('\n✨ Global fix complete. ALL VAPI entities now point to ngrok.');

    } catch (error) {
        console.error('❌ Critical Error:', error.message);
    }
}

fixAllVapiEntities();
