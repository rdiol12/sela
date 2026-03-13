/**
 * Send all regenerated Ludo sprites to Telegram.
 * Usage: node scripts/send-sprites-telegram.mjs
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const DIR = 'workspace/maple-sprites/ludo-regen';

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.png')).sort();
console.log(`Sending ${files.length} sprites to Telegram...`);

for (let i = 0; i < files.length; i++) {
  const file = files[i];
  const filePath = path.join(DIR, file);
  const caption = file.replace('.png', '').replace(/_/g, ' ');

  const fileData = fs.readFileSync(filePath);
  const blob = new Blob([fileData], { type: 'image/png' });
  const form = new FormData();
  form.append('chat_id', TG_CHAT);
  form.append('caption', caption);
  form.append('photo', blob, file);

  try {
    const resp = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, {
      method: 'POST',
      body: form,
    });
    const data = await resp.json();
    console.log(`[${i + 1}/${files.length}] ${file} — ${data.ok ? 'OK' : data.description}`);
  } catch (err) {
    console.log(`[${i + 1}/${files.length}] ${file} — ERROR: ${err.message}`);
  }
  // Telegram rate limit
  await new Promise(r => setTimeout(r, 600));
}
console.log('Done!');
