import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_BASE_URL = 'https://api.vapi.ai';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function cleanupPool() {
  try {
    console.log('🧹 Starting VAPI Phone Number Cleanup...');

    // 1. Fetch all phone numbers from Vapi
    const vapiResponse = await axios.get(`${VAPI_BASE_URL}/phone-number`, {
      headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` }
    });
    const vapiNumbers = vapiResponse.data;

    // 2. Fetch all known assistants from Supabase
    const { data: restaurants } = await supabase
      .from('restaurants')
      .select('vapi_assistant_id');
    
    const knownAssistantIds = new Set(restaurants?.map(r => r.vapi_assistant_id).filter(Boolean));

    console.log(`Found ${vapiNumbers.length} numbers in Vapi.`);
    console.log(`Supabase has ${knownAssistantIds.size} active assistants.`);

    for (const phone of vapiNumbers) {
      if (phone.assistantId && !knownAssistantIds.has(phone.assistantId)) {
        console.log(`⚠️ Number ${phone.number} is linked to UNKNOWN assistant ${phone.assistantId}. Unlinking...`);
        
        try {
          await axios.patch(
            `${VAPI_BASE_URL}/phone-number/${phone.id}`,
            { assistantId: null },
            { headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` } }
          );
          console.log(`   ✅ Successfully unlinked ${phone.number}`);
        } catch (err: any) {
          console.error(`   ❌ Failed to unlink ${phone.number}:`, err.response?.data || err.message);
        }
      } else if (!phone.assistantId) {
        console.log(`✅ Number ${phone.number} is already available.`);
      } else {
        console.log(`✅ Number ${phone.number} is correctly linked to an active restaurant.`);
      }
    }

    console.log('\n✨ Cleanup complete!');

  } catch (error: any) {
    console.error('❌ Critical Error:', error.response?.data || error.message);
  }
}

cleanupPool();
