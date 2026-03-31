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

async function cleanupVapi() {
    console.log('🧹 Starting VAPI cleanup...\n');

    // Step 1: Get all phone numbers
    const phonesRes = await axios.get(`${VAPI_BASE_URL}/phone-number`, { headers });
    const phones = phonesRes.data;

    // Step 2: Get all assistants
    const assistantsRes = await axios.get(`${VAPI_BASE_URL}/assistant`, { headers });
    const assistants = assistantsRes.data;

    console.log(`📞 Found ${phones.length} phone numbers`);
    console.log(`🤖 Found ${assistants.length} assistants\n`);

    // Step 3: Unlink ALL phone numbers from their assistants
    for (const phone of phones) {
        if (phone.assistantId) {
            console.log(`🔓 Unlinking phone ${phone.id} (${phone.number || phone.name || 'SIP'}) from assistant ${phone.assistantId}...`);
            try {
                await axios.patch(
                    `${VAPI_BASE_URL}/phone-number/${phone.id}`,
                    { assistantId: null },
                    { headers }
                );
                console.log(`   ✅ Unlinked!`);
            } catch (err: any) {
                console.error(`   ❌ Failed:`, err.response?.data || err.message);
            }
        }
    }

    // Step 4: Delete ALL assistants (they are orphaned test data)
    for (const assistant of assistants) {
        console.log(`🗑️  Deleting assistant: ${assistant.id} (${assistant.name})...`);
        try {
            await axios.delete(`${VAPI_BASE_URL}/assistant/${assistant.id}`, { headers });
            console.log(`   ✅ Deleted!`);
        } catch (err: any) {
            console.error(`   ❌ Failed:`, err.response?.data || err.message);
        }
    }

    // Step 5: Verify final state
    console.log('\n📊 Final state:');
    const finalPhones = await axios.get(`${VAPI_BASE_URL}/phone-number`, { headers });
    const realPhones = finalPhones.data.filter((p: any) => p.number);
    const sipPhones = finalPhones.data.filter((p: any) => !p.number);
    
    console.log(`  Real callable numbers (available): ${realPhones.length}`);
    realPhones.forEach((p: any) => console.log(`    📞 ${p.number} (ID: ${p.id}) - assistantId: ${p.assistantId || 'NONE ✅'}`));
    
    console.log(`  SIP-only numbers: ${sipPhones.length}`);
    sipPhones.forEach((p: any) => console.log(`    🌐 ${p.name || p.id} - assistantId: ${p.assistantId || 'NONE ✅'}`));

    console.log('\n✅ VAPI cleanup complete! Real phone numbers are now available for new restaurants.');
}

cleanupVapi().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
