import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    // 替換為全新、精確匹配的密鑰對
    const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY || 'BMxYt5vH63k1M9wB054y40XJp1oG4Y3Xg4jK41_6Z0c20d7_00W_Q6O4H1zXkZ8e20X91xV9s20u8s0vL0a1ZfI';
    const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'Yp3q1vO6zXw4mE0b8n2r9t4o0k7j3y2h5v1s8x5z3gQ';

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. 撈取所有訂閱
    const { data: subscriptions, error } = await supabase
      .from('push_subscriptions')
      .select('*');

    if (error) throw error;
    if (!subscriptions || subscriptions.length === 0) {
      return res.status(200).json({ success: true, message: '目前尚無已訂閱的裝置 Token' });
    }

    // 2. 設定 VAPID
    webpush.setVapidDetails(
      'mailto:admin@example.com',
      vapidPublic,
      vapidPrivate
    );

    const bodyData = req.body || {};
    const payload = JSON.stringify({
      title: bodyData.title || '英文大師 SRS',
      body: bodyData.body || '該上線複習今日字卡囉！'
    });

    // 3. 推播
    const sendResults = await Promise.allSettled(
      subscriptions.map(sub => {
        try {
          const pushConfig = typeof sub.subscription === 'string'
            ? JSON.parse(sub.subscription)
            : sub.subscription;
          return webpush.sendNotification(pushConfig, payload);
        } catch (e) {
          return Promise.reject(e);
        }
      })
    );

    return res.status(200).json({
      success: true,
      total_devices: subscriptions.length,
      sent_status: sendResults.map(r => r.status)
    });
  } catch (err) {
    console.error('Push Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
