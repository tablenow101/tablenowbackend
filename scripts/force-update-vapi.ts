/**
 * Force-update all VAPI assistants with the latest config from vapi.service.ts
 * Run once after any prompt/config change:
 *   npx ts-node scripts/force-update-vapi.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import supabase from '../src/config/supabase';
import vapiService from '../src/services/vapi.service';

async function main() {
    console.log('🔄 Force-updating all VAPI assistants...\n');

    const { data: restaurants, error } = await supabase
        .from('restaurants')
        .select('id, name, vapi_assistant_id')
        .not('vapi_assistant_id', 'is', null);

    if (error) {
        console.error('❌ Supabase error:', error.message);
        process.exit(1);
    }

    if (!restaurants || restaurants.length === 0) {
        console.log('⚠️  No restaurants with a VAPI assistant found.');
        process.exit(0);
    }

    for (const r of restaurants) {
        console.log(`📍 ${r.name} — assistant: ${r.vapi_assistant_id}`);
        try {
            const result = await vapiService.updateAssistant(r.vapi_assistant_id, r);
            if (result) {
                console.log(`   ✅ Updated: transcriber=${result.transcriber?.provider}, voice=${result.voice?.provider}/${result.voice?.voiceId}`);
            } else {
                console.log(`   ⚠️  Assistant not found on VAPI (404)`);
            }
        } catch (err: any) {
            console.error(`   ❌ Error: ${err.message}`);
        }
    }

    console.log('\n✅ Done.');
    process.exit(0);
}

main();
