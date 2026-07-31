const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ CRITICAL: SUPABASE_URL or SUPABASE_KEY is not set!');
  console.error('   Add them in Railway Variables and redeploy.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    transport: WebSocket
  },
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

console.log('✅ Supabase client initialized');
console.log('   URL:', supabaseUrl.substring(0, 30) + '...');

module.exports = { supabase };
