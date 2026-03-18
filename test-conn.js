const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function test() {
  console.log('Testing Supabase connection...');
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data, error } = await supabase.from('restaurants').select('count', { count: 'exact', head: true });
    if (error) throw error;
    console.log('✅ Supabase connected. Restaurant count:', data);
  } catch (e) {
    console.error('❌ Supabase failed:', e.message);
  }

  console.log('\nTesting VAPI connection...');
  try {
    const res = await axios.get('https://api.vapi.ai/assistant', {
      headers: { 'Authorization': `Bearer ${process.env.VAPI_API_KEY}` }
    });
    console.log('✅ VAPI connected. Assistants found:', res.data.length);
  } catch (e) {
    console.error('❌ VAPI failed:', e.message);
  }
}

test();
