import type { Env, PanelEntry, TelegramUpdate } from "./types";
import { parseCaption, slugify } from "./caption";
import { downloadFile, sendReply } from "./telegram";
import {
  arrayBufferToBase64,
  commitFile,
  deletePanel,
  isUpdatableField,
  nextSeq,
  readGalleryJson,
  updateGalleryJson,
  updatePanel,
} from "./github";

const HELP_TEXT = `Comic Snaps Bot — Commands:

Add a panel:
  Post a photo with a caption in this format (notes and tags are optional):
  Title // Issue # // Year // Artist // notes // tags

  Example:
  Saga // 1 // 2012 // Fiona Staples // great spread // sci-fi, space opera

Commands:
  /delete {id} — Delete a panel by its numeric ID
  /update {id} {field} {value} — Update a field on a panel

Updatable fields: title, issue, year, artist, notes, tags

Examples:
  /delete 5
  /update 3 artist Fiona Staples
  /update 3 tags sci-fi, space opera`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    // Verify webhook secret (if configured)
    const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 403 });
    }

    const update: TelegramUpdate = await request.json();
    const message = update.message;

    if (!message) {
      return new Response("OK");
    }

    // Silently ignore messages from other chats
    if (String(message.chat.id) !== env.TELEGRAM_ALLOWED_CHAT_ID) {
      return new Response("OK");
    }

    // Handle text commands
    if (message.text) {
      const text = message.text.trim();

      try {
        if (text === "/help" || text === "/start") {
          await sendReply(
            env.TELEGRAM_BOT_TOKEN,
            message.chat.id,
            message.message_id,
            HELP_TEXT
          );
          return new Response("OK");
        }

        const deleteMatch = text.match(/^\/delete\s+(\d+)$/);
        if (deleteMatch) {
          const seq = parseInt(deleteMatch[1], 10);
          const removed = await deletePanel(env, seq);
          if (!removed) {
            await sendReply(
              env.TELEGRAM_BOT_TOKEN,
              message.chat.id,
              message.message_id,
              `No panel found with ID ${seq}.`
            );
          } else {
            await sendReply(
              env.TELEGRAM_BOT_TOKEN,
              message.chat.id,
              message.message_id,
              `Deleted panel #${seq}: ${removed.title} #${removed.issue}`
            );
          }
          return new Response("OK");
        }

        const updateMatch = text.match(/^\/update\s+(\d+)\s+(\S+)\s+([\s\S]+)$/);
        if (updateMatch) {
          const seq = parseInt(updateMatch[1], 10);
          const field = updateMatch[2];
          const value = updateMatch[3].trim();

          if (!isUpdatableField(field)) {
            await sendReply(
              env.TELEGRAM_BOT_TOKEN,
              message.chat.id,
              message.message_id,
              `Invalid field "${field}". Updatable fields: title, issue, year, artist, notes, tags`
            );
            return new Response("OK");
          }

          const updated = await updatePanel(env, seq, field, value);
          if (!updated) {
            await sendReply(
              env.TELEGRAM_BOT_TOKEN,
              message.chat.id,
              message.message_id,
              `No panel found with ID ${seq}.`
            );
          } else {
            await sendReply(
              env.TELEGRAM_BOT_TOKEN,
              message.chat.id,
              message.message_id,
              `Updated panel #${seq}: set ${field} to "${value}"\n→ ${updated.title} #${updated.issue}`
            );
          }
          return new Response("OK");
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        await sendReply(
          env.TELEGRAM_BOT_TOKEN,
          message.chat.id,
          message.message_id,
          `Error: ${errorMessage}`
        );
        return new Response("OK");
      }

      // Unknown text — ignore
      return new Response("OK");
    }

    // Photo without caption → remind the sender of the expected format
    if (message.photo && !message.caption) {
      await sendReply(
        env.TELEGRAM_BOT_TOKEN,
        message.chat.id,
        message.message_id,
        "Photo received but no caption found.\n\nExpected format:\nTitle // Issue # // Year // Artist // notes // tags\n\nExample:\nSaga // 1 // 2012 // Fiona Staples // great spread // sci-fi, space opera"
      );
      return new Response("OK");
    }

    // Ignore anything that isn't a photo with a caption
    if (!message.photo || !message.caption) {
      return new Response("OK");
    }

    try {
      // 1. Parse caption
      const metadata = parseCaption(message.caption);

      // 2. Extract poster info
      const postedBy =
        message.from?.first_name || message.from?.username || "unknown";

      // 3. Download the largest resolution photo from Telegram
      const photo = message.photo[message.photo.length - 1];
      const imageBytes = await downloadFile(photo.file_id, env.TELEGRAM_BOT_TOKEN);

      // 4. Generate paths and IDs
      const timestamp = Math.floor(Date.now() / 1000);
      const slug = slugify(metadata.title);
      const filename = `issue-${metadata.issue}-${timestamp}.jpg`;
      const repoImagePath = `public/images/${slug}/${filename}`;
      const browserImagePath = `images/${slug}/${filename}`;
      const id = `${slug}-${metadata.issue}-${timestamp}`;

      // 5. Commit image file to GitHub
      const base64Image = arrayBufferToBase64(imageBytes);
      await commitFile(
        env,
        repoImagePath,
        base64Image,
        `Add panel: ${metadata.title} #${metadata.issue}`
      );

      // 6. Assign sequential ID and append entry to gallery.json
      const { gallery } = await readGalleryJson(env);
      const seq = nextSeq(gallery);

      const entry: PanelEntry = {
        seq,
        id,
        title: metadata.title,
        slug,
        issue: metadata.issue,
        year: metadata.year,
        artist: metadata.artist,
        image: browserImagePath,
        notes: metadata.notes,
        tags: metadata.tags,
        postedBy,
        addedAt: new Date().toISOString(),
      };
      await updateGalleryJson(env, entry);

      // 7. Confirm via Telegram
      const notesLine = metadata.notes ? `\n  Notes: ${metadata.notes}` : "";
      const tagsLine = metadata.tags.length > 0 ? `\n  Tags: ${metadata.tags.join(", ")}` : "";
      await sendReply(
        env.TELEGRAM_BOT_TOKEN,
        message.chat.id,
        message.message_id,
        `Added to gallery (ID: ${seq}):\n  ${metadata.title} #${metadata.issue} (${metadata.year})\n  Artist: ${metadata.artist}${notesLine}${tagsLine}\n  → ${browserImagePath}`
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown error";
      await sendReply(
        env.TELEGRAM_BOT_TOKEN,
        message.chat.id,
        message.message_id,
        `Error: ${errorMessage}`
      );
    }

    return new Response("OK");
  },
};
