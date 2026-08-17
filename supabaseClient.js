// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 輔助函數：將 Base64 公鑰轉為 Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

// 註冊 Web Push 訂閱並存入 Supabase
export async function subscribeToPush(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('此瀏覽器或裝置不支援 Web Push 通知');
  }

  const registration = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  
  if (permission !== 'granted') {
    throw new Error('通知權限未被允許');
  }

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }

  // 儲存或更新至 Supabase 的 push_subscriptions 資料表
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    subscription_json: subscription.toJSON(),
  }, { onConflict: 'user_id' });

  if (error) throw error;
  return true;
}