const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

export default function handler(_req, res) {
  if (!supabaseUrl || !supabasePublishableKey) {
    return res.status(503).json({ message: 'Supabase 공개 환경변수가 아직 없습니다.' });
  }
  return res.status(200).json({ supabaseUrl, supabasePublishableKey });
}
