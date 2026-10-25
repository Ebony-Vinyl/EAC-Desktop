/**
 * How an outbound attachment is classified for the WeChat service.
 *
 * The service keeps its objects apart by kind: an image, a video, and a generic file are
 * uploaded under different media types and announced with different message items. Getting
 * the kind wrong is not cosmetic — a video uploaded as a file arrives as an opaque download
 * instead of a playable clip.
 *
 * This lives on its own so the mapping can be tested without standing up the whole send path.
 *
 * @module dsh-wechat/media-kind
 */
import { type UploadMediaTypeValue } from '@dsh-wechat/core';
/** The three kinds this channel sends outbound. */
export type MediaKind = 'image' | 'video' | 'file';
/**
 * Classify a file by its extension.
 *
 * Anything unrecognised is a file attachment, which is the safe default: a file always
 * arrives, just as a download rather than inline media.
 *
 * @param fileName - Name of the file being sent.
 * @returns The kind to upload and announce it as.
 */
export declare function mediaKindOf(fileName: string): MediaKind;
/** Upload media type per kind, matching the service's own `UploadMediaType`. */
export declare const MEDIA_TYPE_BY_KIND: Record<MediaKind, UploadMediaTypeValue>;
/** Label used in the boot log, so an outbound send is greppable by kind. */
export declare const MEDIA_LABEL_BY_KIND: Record<MediaKind, string>;
//# sourceMappingURL=media-kind.d.ts.map