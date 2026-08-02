/**
 * One image described per message.
 *
 * Off the main thread because a directory is decoded all at once and a phone
 * photo is twelve megapixels: the same decode the texture pool meters one frame
 * at a time, run a few hundred times in a row with a progress bar watching. The
 * `File` crosses by structured clone, which does not copy the bytes.
 */
import { describeImage } from "./analyze";
import type { ImageDescription } from "./analyze";

export interface DescribeRequest {
  file: Blob;
}

export type DescribeResponse =
  | ({ ok: true } & ImageDescription)
  | { ok: false; error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<DescribeRequest>) => void) | null;
  postMessage: (message: DescribeResponse) => void;
};

scope.onmessage = (event) => {
  void describeImage(event.data.file).then(
    (description) => scope.postMessage({ ok: true, ...description }),
    (error: unknown) =>
      scope.postMessage({ ok: false, error: error instanceof Error ? error.message : "decode failed" })
  );
};
