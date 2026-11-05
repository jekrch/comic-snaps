import type { Env, PanelEntry, SeriesFile } from "./types";
import { parseCaption, slugify } from "./caption";
import { downloadFile } from "./telegram";
import {
  arrayBufferToBase64,
  commitFile,
  formatIssue,
  lastArtistForSlug,
  nextSeq,
  readGalleryJson,
  readJsonFile,
  updateGalleryJson,
} from "./github";
import { invalidateSourceCache } from "./ratings";
import { resolveSeries } from "./series";

/**
 * Post a panel: parse the caption, commit the photo, append the gallery entry,
 * and return the confirmation to send. Throws with a user-facing message when
 * the caption can't be used.
 *
 * Shared by captioned photos and by /confirm on a described one, so a panel the
 * agent wrote the caption for is posted exactly the way a typed one is.
 */
export async function ingestPanel(
  env: Env,
  caption: string,
  fileId: string,
  postedBy: string
): Promise<string> {
  const metadata = parseCaption(caption);

  // Read the gallery and series up front: the title has to resolve to its
  // series, and a caption with no artist inherits the one from the series' most
  // recent panel, before anything is committed.
  const [{ gallery }, { data: seriesFile }] = await Promise.all([
    readGalleryJson(env),
    readJsonFile<SeriesFile>(env, "public/data/series.json"),
  ]);
  const series = resolveSeries(metadata.title, seriesFile?.series ?? [], gallery.panels);
  const { slug, title } = series;
  const seq = nextSeq(gallery);

  let artist = metadata.artist;
  let inheritedArtist = false;
  if (!artist) {
    artist = lastArtistForSlug(gallery, slug);
    if (!artist) {
      throw new Error(
        `No artist given and "${title}" isn't in the gallery yet.\n\nInclude the artist:\n${title} // ${metadata.issue} // ${metadata.year} // Artist Name`
      );
    }
    inheritedArtist = true;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const issueSlug = slugify(String(metadata.issue));
  const filename = `issue-${issueSlug}-${timestamp}.jpg`;
  const repoImagePath = `public/images/${slug}/${filename}`;
  const browserImagePath = `images/${slug}/${filename}`;
  const id = `${slug}-${issueSlug}-${timestamp}`;

  const imageBytes = await downloadFile(fileId, env.TELEGRAM_BOT_TOKEN);
  await commitFile(
    env,
    repoImagePath,
    arrayBufferToBase64(imageBytes),
    `Add panel: ${title} ${formatIssue(metadata.issue)}`
  );

  const entry: PanelEntry = {
    seq,
    id,
    title,
    slug,
    issue: metadata.issue,
    year: metadata.year,
    artist,
    image: browserImagePath,
    notes: metadata.notes,
    tags: metadata.tags,
    postedBy,
    addedAt: new Date().toISOString(),
  };
  await updateGalleryJson(env, entry);
  await invalidateSourceCache();

  const matchedLine =
    series.existing && title !== metadata.title.trim() ? `\n  (matched series "${title}")` : "";
  const artistLine = `\n  Artist: ${artist}${inheritedArtist ? " (from last post in series)" : ""}`;
  const notesLine = metadata.notes ? `\n  Notes: ${metadata.notes}` : "";
  const tagsLine = metadata.tags.length > 0 ? `\n  Tags: ${metadata.tags.join(", ")}` : "";
  return `Added to gallery (ID: ${seq}):\n  ${title} ${formatIssue(metadata.issue)} (${metadata.year})${matchedLine}${artistLine}${notesLine}${tagsLine}\n  → ${browserImagePath}`;
}
