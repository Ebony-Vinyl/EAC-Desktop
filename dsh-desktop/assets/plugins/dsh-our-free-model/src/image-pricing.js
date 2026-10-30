/**
 * 缺少厂商视觉计价协议时的同步估算，供宿主的 Token 预算和结果落盘使用。
 * 1024 是兜底估算值，不代表所有厂商的真实消耗或上限。已移出请求的图片只计描述文本。
 */
export const FALLBACK_IMAGE_PRICING = Object.freeze({
  /** @param {readonly { offloaded?: boolean }[]} images */
  priceImages(images) {
    return images.map(image => image.offloaded === true
      ? { visualTokens: 0, text: '[image omitted]' }
      : { visualTokens: 1024, text: '[image]' })
  },
})
