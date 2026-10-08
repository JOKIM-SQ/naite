export {};
declare global {
  var supabase: { createClient: typeof import('@supabase/supabase-js').createClient };
}
