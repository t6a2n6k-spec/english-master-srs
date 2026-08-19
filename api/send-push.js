import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

// 標準 P-256 VAPID 密鑰對
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BGXGN5pMKEuUgIX3lUQt5D6viELxlhnGpxFT5xDBAALZTpQPDn2MPP-Kig41GeYfyO78Le43coh07WlL_az07pQ';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE';

export default async function handler(req, res) {
  // 設定 CORS 允許跨域請求
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('缺少 Supabase 連線資訊 (URL 或 KEY)！');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. 撈出所有已訂閱通知的手機/平板 Token
    const { data: subscriptions, error } = await supabase
      .from('push_subscriptions')
      .select('*');

    if (error) throw error;

    if (!subscriptions || subscriptions.length === 0) {
      return res.status(200).json({ success: true, message: '目前尚無已訂閱的裝置 Token' });
    }

    // 2. 設定 VAPID 授權資訊
    webpush.setVapidDetails(
      'mailto:admin@example.com',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );

    const bodyData = req.body || {};
    const payload = JSON.stringify({
      title: bodyData.title || '英文大師 SRS',
      body: bodyData.body || '該上線複習今日字卡囉！'
    });

    // 3. 廣播發送給所有已登記裝置
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
