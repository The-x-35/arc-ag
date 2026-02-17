import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load .env file manually
function loadEnvFile() {
  try {
    const envPath = join(process.cwd(), '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    const lines = envContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          process.env[key.trim()] = value.trim();
        }
      }
    }
  } catch (error) {
    // .env might not exist, that's okay
  }
}

// Load environment variables
loadEnvFile();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables.');
  console.error('Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Generate a random 6-character invite code (A-Z, 0-9)
 */
function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Check if a code already exists in the database
 */
async function codeExists(code: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('invite_codes')
    .select('code')
    .eq('code', code)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
    throw error;
  }

  return !!data;
}

/**
 * Generate unique invite codes
 */
async function generateUniqueCodes(count: number): Promise<string[]> {
  const codes: string[] = [];
  const existingCodes = new Set<string>();

  // Fetch existing codes to avoid duplicates
  const { data: existing } = await supabase
    .from('invite_codes')
    .select('code');

  if (existing) {
    existing.forEach((row) => existingCodes.add(row.code));
  }

  while (codes.length < count) {
    const code = generateInviteCode();
    
    // Check if code is already in our set or exists in DB
    if (!existingCodes.has(code) && !(await codeExists(code))) {
      codes.push(code);
      existingCodes.add(code);
    }
  }

  return codes;
}

/**
 * Insert invite codes into database
 */
async function insertInviteCodes(codes: string[]): Promise<void> {
  const codesToInsert = codes.map(code => ({
    code,
    is_used: false
  }));

  const { error } = await supabase
    .from('invite_codes')
    .insert(codesToInsert);

  if (error) {
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('Generating 120 unique invite codes...');
    
    const codes = await generateUniqueCodes(120);
    console.log(`Generated ${codes.length} unique codes`);
    
    console.log('Inserting codes into database...');
    await insertInviteCodes(codes);
    
    console.log('✅ Successfully inserted 120 invite codes into database!');
    console.log('\nFirst 10 codes:');
    codes.slice(0, 10).forEach((code, i) => {
      console.log(`  ${i + 1}. ${code}`);
    });
    
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error generating invite codes:', error.message);
    process.exit(1);
  }
}

main();
