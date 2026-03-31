import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function clearDatabase() {
    console.log('⚠️ DELETING ALL RESTAURANTS FROM THE DATABASE...');
    console.log('Starting clear operation...');

    // Due to the ON DELETE CASCADE constraint in our SQL schema, 
    // deleting all restaurants will completely wipe:
    // 1. call_logs
    // 2. bookings
    // 3. bcc_emails
    const { data, error } = await supabase
        .from('restaurants')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete everything where id doesn't equal an all-zero UUID

    if (error) {
        console.error('❌ Failed to clear database:', error);
        process.exit(1);
    } else {
        console.log('✅ DATABASE SUCCESSFULLY CLEARED. All restaurants and related data have been wiped out.');
        console.log('You may now register new restaurants for a totally fresh test environment.');
        process.exit(0);
    }
}

clearDatabase();
