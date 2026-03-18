import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function checkStatus() {
  const { data: restaurants, error } = await supabase
    .from('restaurants')
    .select('*')
    .ilike('name', '%BELLEFOOD%');

  if (error) {
    console.error('Error fetching restaurants:', error);
    return;
  }

  console.log(`Found ${restaurants?.length} matching restaurants:`);
  restaurants?.forEach(r => {
    console.log(`- ID: ${r.id}`);
    console.log(`  Name: ${r.name}`);
    console.log(`  VAPI Phone ID: ${r.vapi_phone_id}`);
    console.log(`  VAPI Phone Number: ${r.vapi_phone_number}`);
    console.log(`  VAPI Assistant ID: ${r.vapi_assistant_id}`);
    console.log(`  Status: ${r.status}`);
    console.log('-------------------');
  });
}

checkStatus();
