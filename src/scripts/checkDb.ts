import { supabase } from '../config/supabase';

async function checkDb() {
  const { data, error } = await supabase.from('restaurants').select('id, name, google_calendar_tokens');
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  if (data && data.length > 0) {
    console.log(`Found ${data.length} restaurants.`);
    data.forEach(r => {
      console.log(`Restaurant: ${r.name}`);
      console.log(`Has Calendar Tokens:`, r.google_calendar_tokens ? 'YES' : 'NO');
    });
  } else {
    console.log('No restaurants found.');
  }
}

checkDb();
