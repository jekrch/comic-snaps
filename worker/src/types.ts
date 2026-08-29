export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ALLOWED_CHAT_ID: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  WEBHOOK_SECRET?: string;
  /** Salt for the opaque rater ids published in ratings.json. */
  RATINGS_SALT?: string;
}

export interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  photo?: TelegramPhotoSize[];
  caption?: string;
  text?: string;
  media_group_id?: string;
  reply_to_message?: TelegramMessage;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramSendResponse {
  ok: boolean;
  result?: { message_id: number };
}

export interface TelegramFileResponse {
  ok: boolean;
  result?: { file_path: string };
}

export interface GitHubContentsResponse {
  content: string;
  sha: string;
}

export interface PanelMetadata {
  title: string;
  issue: number | string;
  year: number;
  /** Null when the caption omits it — resolved from the series' last panel. */
  artist: string | null;
  notes: string | null;
  tags: string[];
  seriesTags: string[];
  artistTags: string[];
}

export interface PanelEntry {
  seq: number;
  id: string;
  title: string;
  slug: string;
  issue: number | string;
  year: number;
  artist: string;
  image: string;
  notes: string | null;
  tags: string[];
  postedBy: string;
  addedAt: string;
}

export interface Gallery {
  panels: PanelEntry[];
}

export interface SeriesEntry {
  id: string;
  name: string;
  tags?: string[];
  aliases?: string[] | null;
  parentSeries?: string | null;
  [key: string]: unknown;
}

export interface ArtistEntry {
  id: string;
  name: string;
  aliases?: string[];
  tags?: string[];
  [key: string]: unknown;
}

export interface SeriesFile {
  series: SeriesEntry[];
}

export interface ArtistsFile {
  artists: ArtistEntry[];
}