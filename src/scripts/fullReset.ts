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

async function fullReset() {
  try {
    console.log('🚮 Starting FULL SYSTEM RESET...');

    // 1. VAPI CLEANUP
    console.log('\n🧹 Cleaning VAPI...');
    
    // a. Fetch and unassign all phone numbers
    const phoneResponse = await axios.get(`${VAPI_BASE_URL}/phone-number`, {
      headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` }
    });
    console.log(`Found ${phoneResponse.data.length} phone numbers. Unassigning all...`);
    for (const phone of phoneResponse.data) {
      if (phone.assistantId) {
        await axios.patch(
          `${VAPI_BASE_URL}/phone-number/${phone.id}`,
          { assistantId: null, serverUrl: null },
          { headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` } }
        );
        console.log(`   ✅ Unassigned ${phone.number}`);
      }
    }

    // b. Delete all assistants
    const assistantResponse = await axios.get(`${VAPI_BASE_URL}/assistant`, {
      headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` }
    });
    console.log(`Found ${assistantResponse.data.length} assistants. Deleting all...`);
    for (const assistant of assistantResponse.data) {
      try {
        await axios.delete(`${VAPI_BASE_URL}/assistant/${assistant.id}`, {
          headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` }
        });
        console.log(`   ✅ Deleted assistant: ${assistant.name || assistant.id}`);
      } catch (e: any) {
        console.error(`   ❌ Failed to delete assistant ${assistant.id}:`, e.message);
      }
    }

    // 2. SUPABASE CLEANUP
    console.log('\n🔥 Cleaning Supabase Tables...');
    
    // Delete in order to satisfy foreign keys
    const tables = ['bookings', 'call_logs', 'bcc_emails', 'restaurants'];
    for (const table of tables) {
      console.log(`   🗑️ Clearing table: ${table}...`);
      const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000'); // Delete everything
      if (error) {
        console.error(`   ❌ Error clearing ${table}:`, error.message);
      } else {
        console.log(`   ✅ ${table} cleared.`);
      }
    }

    console.log('\n✨ FULL RESET COMPLETE. You have a clean slate!');

  } catch (error: any) {
    console.error('❌ Critical Error during reset:', error.response?.data || error.message);
  }
}

fullReset();
