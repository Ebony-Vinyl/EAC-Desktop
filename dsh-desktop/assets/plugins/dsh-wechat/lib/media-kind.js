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
import { UploadMediaType } from '../../core/lib/index.js';
/** Extensions the service treats as an image. */
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;
/** Extensions the service treats as a video. */
const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|avi|mkv|webm|3gp)$/i;
/**
 * Classify a file by its extension.
 *
 * Anything unrecognised is a file attachment, which is the safe default: a file always
 * arrives, just as a download rather than inline media.
 *
 * @param fileName - Name of the file being sent.
 * @returns The kind to upload and announce it as.
 */
export function mediaKindOf(fileName) {
    if (IMAGE_EXTENSIONS.test(fileName))
        return 'image';
    if (VIDEO_EXTENSIONS.test(fileName))
        return 'video';
    return 'file';
}
/** Upload media type per kind, matching the service's own `UploadMediaType`. */
export const MEDIA_TYPE_BY_KIND = {
    image: UploadMediaType.IMAGE,
    video: UploadMediaType.VIDEO,
    file: UploadMediaType.FILE,
};
/** Label used in the boot log, so an outbound send is greppable by kind. */
export const MEDIA_LABEL_BY_KIND = {
    image: '图片',
    video: '视频',
    file: '文件',
};
//# sourceMappingURL=media-kind.js.map