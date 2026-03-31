const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
sb.from('restaurants').select('id,name,vapi_phone_id,vapi_phone_number,vapi_assistant_id').then((r: any) => {
    console.log(JSON.stringify(r.data, null, 2));
    process.exit(0);
});
