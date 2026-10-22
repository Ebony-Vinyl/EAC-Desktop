/** 跨宿主版本的同步视觉 Token 估算；不是厂商账单或上限。 */
export declare const FALLBACK_IMAGE_PRICING: Readonly<{
  priceImages(images: readonly { offloaded?: boolean }[]): {
    visualTokens: number
    text: string
  }[]
}>
