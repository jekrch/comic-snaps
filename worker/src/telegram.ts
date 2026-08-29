import type {
  InlineKeyboardMarkup,
  TelegramFileResponse,
  TelegramSendResponse,
} from "./types";

const TELEGRAM_API = "https://api.telegram.org";

/** Download a photo from Telegram by file_id. */
export async function downloadFile(
  fileId: string,
  botToken: string
): Promise<ArrayBuffer> {
  const fileResp = await fetch(
    `${TELEGRAM_API}/bot${botToken}/getFile?file_id=${fileId}`
  );
  const fileData: TelegramFileResponse = await fileResp.json();
  if (!fileData.ok || !fileData.result) {
    throw new Error(`Telegram getFile failed: ${JSON.stringify(fileData)}`);
  }

  const downloadResp = await fetch(
    `${TELEGRAM_API}/file/bot${botToken}/${fileData.result.file_path}`
  );
  if (!downloadResp.ok) {
    throw new Error(`Image download failed (HTTP ${downloadResp.status})`);
  }
  return downloadResp.arrayBuffer();
}

/**
 * Send a reply message in a Telegram chat, optionally with an inline keyboard.
 * Returns the sent `message_id`, or null if Telegram rejected the send.
 */
export async function sendReply(
  botToken: string,
  chatId: number,
  replyToId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<number | null> {
  const resp = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyToId,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });

  if (!resp.ok) return null;
  const data: TelegramSendResponse = await resp.json();
  return data.ok && data.result ? data.result.message_id : null;
}

/**
 * Acknowledge a callback query. Telegram spins the button on the client until
 * this lands, so it should fire before any slow work.
 */
export async function answerCallbackQuery(
  botToken: string,
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await fetch(`${TELEGRAM_API}/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    }),
  });
}

/**
 * Rewrite one of the bot's own messages in place — used to update a rating
 * tally without adding a message per tap. Telegram errors when the new text is
 * identical to the old, which is harmless here, so failures are swallowed.
 */
export async function editMessageText(
  botToken: string,
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> {
  await fetch(`${TELEGRAM_API}/bot${botToken}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
}