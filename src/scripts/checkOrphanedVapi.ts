import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const assistantIds = [
  'a5e9636b-12c6-4d10-986c-9fee1142257f',
  '266153f6-53a1-4cb7-b4eb-a6be934b5daf',
  '810e3b73-ee23-4f7e-a90f-aa0c2718213e',
  'd14ad4fb-cdfd-4b6d-b483-7c76fc912fdf',
  '933eefc2-750d-4cef-9e83-b3707f19c4ac'
];

async function checkAssistants() {
  const { data: restaurants, error } = await supabase
    .from('restaurants')
    .select('id, name, vapi_assistant_id, vapi_phone_number')
    .in('vapi_assistant_id', assistantIds);

  if (error) {
    console.error('Error fetching restaurants:', error);
    return;
  }

  console.log('Active assignments in Supabase:');
  restaurants?.forEach(r => {
    console.log(`- Restaurant: ${r.name}`);
    console.log(`  Assistant ID: ${r.vapi_assistant_id}`);
    console.log(`  Phone: ${r.vapi_phone_number}`);
  });

  const matchedIds = restaurants?.map(r => r.vapi_assistant_id) || [];
  const orphanedIds = assistantIds.filter(id => !matchedIds.includes(id));

  console.log('\nOrphaned Assistant IDs (assigned in Vapi but not in our DB):');
  orphanedIds.forEach(id => console.log(`- ${id}`));
}

checkAssistants();
