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

async function checkVapiSync() {
  try {
    console.log('🔍 Starting VAPI Sync Check...');

    const { data: restaurants, error } = await supabase
      .from('restaurants')
      .select('id, name, vapi_assistant_id, vapi_phone_id');

    if (error) throw error;

    console.log(`Found ${restaurants.length} restaurants in database.`);

    for (const restaurant of restaurants) {
      console.log(`\n🔹 Checking ${restaurant.name} (${restaurant.id})...`);
      let updates: any = {};
      let needsUpdate = false;

      // 1. Check Assistant
      if (restaurant.vapi_assistant_id) {
        try {
          await axios.get(`${VAPI_BASE_URL}/assistant/${restaurant.vapi_assistant_id}`, {
            headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` }
          });
          console.log(`   ✅ Assistant ${restaurant.vapi_assistant_id} exists.`);
        } catch (err: any) {
          if (err.response?.status === 404) {
            console.log(`   ❌ Assistant ${restaurant.vapi_assistant_id} NOT FOUND on VAPI. Clearing ID...`);
            updates.vapi_assistant_id = null;
            needsUpdate = true;
          } else {
            console.error(`   ⚠️  Error checking assistant: ${err.message}`);
          }
        }
      } else {
        console.log(`   ⚪ No assistant ID in database.`);
      }

      // 2. Check Phone Number
      if (restaurant.vapi_phone_id) {
        try {
          await axios.get(`${VAPI_BASE_URL}/phone-number/${restaurant.vapi_phone_id}`, {
            headers: { 'Authorization': `Bearer ${VAPI_API_KEY}` }
          });
          console.log(`   ✅ Phone Number ${restaurant.vapi_phone_id} exists.`);
        } catch (err: any) {
          if (err.response?.status === 404) {
            console.log(`   ❌ Phone Number ${restaurant.vapi_phone_id} NOT FOUND on VAPI. Clearing ID...`);
            updates.vapi_phone_id = null;
            updates.vapi_phone_number = null;
            needsUpdate = true;
          } else {
            console.error(`   ⚠️  Error checking phone number: ${err.message}`);
          }
        }
      } else {
        console.log(`   ⚪ No phone ID in database.`);
      }

      if (needsUpdate) {
        const { error: updateError } = await supabase
          .from('restaurants')
          .update(updates)
          .eq('id', restaurant.id);
        
        if (updateError) {
          console.error(`   ❌ Failed to update database for ${restaurant.name}:`, updateError.message);
        } else {
          console.log(`   ✨ Updated ${restaurant.name} database record.`);
        }
      }
    }

    console.log('\n✅ VAPI Sync Check complete!');

  } catch (error: any) {
    console.error('❌ Critical Error during sync check:', error.response?.data || error.message);
  }
}

checkVapiSync();
