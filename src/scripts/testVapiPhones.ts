import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const VAPI_API_KEY = process.env.VAPI_API_KEY!;
const VAPI_BASE_URL = 'https://api.vapi.ai';

async function testVapiPhones() {
    console.log('🔍 Fetching ALL phone numbers from VAPI account...\n');
    
    const headers = {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json'
    };

    try {
        const response = await axios.get(`${VAPI_BASE_URL}/phone-number`, { headers });
        const phones = response.data;

        console.log(`📞 Total phone numbers in account: ${phones.length}\n`);

        phones.forEach((phone: any, index: number) => {
            console.log(`===== PHONE #${index + 1} =====`);
            console.log(`  ID:            ${phone.id}`);
            console.log(`  provider:      ${phone.provider}`);
            console.log(`  number:        ${phone.number}`);
            console.log(`  phoneNumber:   ${phone.phoneNumber}`);
            console.log(`  sipUri:        ${phone.sipUri}`);
            console.log(`  name:          ${phone.name}`);
            console.log(`  assistantId:   ${phone.assistantId || '(none - available)'}`);
            console.log(`  ALL KEYS:      ${Object.keys(phone).join(', ')}`);
            console.log(`  FULL OBJECT:   ${JSON.stringify(phone, null, 2)}`);
            console.log('');
        });

        // Check which ones are available (no assistant linked)
        const available = phones.filter((p: any) => !p.assistantId);
        console.log(`\n✅ Available (unassigned) numbers: ${available.length}`);
        available.forEach((p: any) => {
            console.log(`  - ${p.number || p.phoneNumber || p.sipUri || p.name || p.id}`);
        });

    } catch (error: any) {
        console.error('❌ Error:', error.response?.data || error.message);
    }
}

testVapiPhones();
