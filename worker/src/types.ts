export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ALLOWED_CHAT_ID: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  WEBHOOK_SECRET?: string;
  /** Salt for the opaque rater ids published in ratings.json. */
  RATINGS_SALT?: string;
  /**
   * Comma-separated Telegram user ids allowed to use the model-backed commands
   * (/ask, /resp, /confirm, described photos) and the restorations (/restore,
   * /redo, /approve, /reject). Unset means nobody: the plain
   * commands keep working for the whole chat either way.
   */
  ALLOWED_USER_IDS?: string;
  GEMINI_API_KEY?: string;
  METRON_USERNAME?: string;
  METRON_PASSWORD?: string;
  COMIC_VINE_API_KEY?: string;
  /** Agent threads, pending proposals, rate limits, the cost ledger, parked jobs. */
  BOT_STATE: KVNamespace;
  /** Model calls and /confirm runs that outlive the webhook. */
  JOBS: Queue;
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

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramFileResponse {
  ok: boolean;
  result?: { file_path: string };
}

export interface GitHubContentsResponse {
  /** Base64, or "" for a file over 1 MB (then `encoding` is "none"). */
  content: string;
  encoding?: string;
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
  startYear?: number | null;
  publisher?: string | null;
  issueCount?: number | null;
  references?: { name: string; url: string }[];
  /** Which metadata sources have already processed this entry (Python pipeline). */
  sources?: string[];
  /** Per-source cover lookup snapshots (Python pipeline). */
  coverSources?: Record<string, number[]>;
  [key: string]: unknown;
}

/** One unresolved (or hand-resolved) name in disambiguation.json. */
export interface DisambiguationEntry {
  id: number | null;
  candidates: { id: number | null; name: string | null }[];
}

/** disambiguation.json: `"source:resource"` → name → entry. */
export type DisambiguationFile = Record<string, Record<string, DisambiguationEntry>>;

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