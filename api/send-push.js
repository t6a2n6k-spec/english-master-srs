import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export default async function handler(req, res) {
  // 設定 CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. 撈出所有已訂閱通知的手機/平板 Token
    const { data: subscriptions, error } = await supabase
      .from('push_subscriptions')
      .select('*');

    if (error) throw error;
    if (!subscriptions || subscriptions.length === 0) {
      return res.status(200).json({ message: '目前無訂閱裝置' });
    }

    // 2. 設定 VAPID (如果使用自訂金鑰，也可填入環境變數)
    const vapidPublic = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIhbQFLXYp5Nksh8U';
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY || 'UUxI4O8v9v_78i_E8j5Fh0aW4O-6P0Q8Z3xX1yY2zA';
    
    webpush.setVapidDetails(
      'mailto:admin@example.com',
      vapidPublic,
      vapidPrivate
    );

    const { title, body } = req.body || {};
    const payload = JSON.stringify({
      title: title || '英文大師 SRS',
      body: body || '該複習囉！'
    });

    // 3. 廣播發送給所有裝置
    const sendPromises = subscriptions.map(sub => {
      try {
        const pushConfig = typeof sub.subscription === 'string' 
          ? JSON.parse(sub.subscription) 
          : sub.subscription;
        return webpush.sendNotification(pushConfig, payload);
      } catch (e) {
        return Promise.resolve();
      }
    });

    await Promise.allSettled(sendPromises);

    return res.status(200).json({ success: true, count: subscriptions.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
