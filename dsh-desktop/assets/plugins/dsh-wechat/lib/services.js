/**
 * Host surface this plugin needs, declared locally.
 *
 * The shapes match the official controllers shipped inside DSH. They are declared
 * here rather than imported because an installable bundle must not depend on the
 * host's internal packages at build time — the same approach the official
 * `dsh-orb` bundle takes. Anything missing here simply keeps the plugin pending.
 *
 * @module dsh-wechat/services
 */
/**
 * Extract the session, visible text, and completion signal from a stream payload.
 *
 * The frame shape is host-owned, so this reads it defensively and tolerates
 * unknown variants rather than throwing. Getting this wrong fails silently — a
 * mismatched field name means the reply is dropped with no error anywhere — so it
 * is written against the documented chunk variants.
 *
 * @param payload - The `agent/assistant-stream` payload.
 */
export function readStreamFrame(payload) {
    const rawId = payload.agent?.session?.id;
    const sessionId = typeof rawId === 'string' ? rawId : undefined;
    const withId = sessionId === undefined ? {} : { sessionId };
    const frame = payload.frame;
    if (typeof frame !== 'object' || frame === null)
        return withId;
    const record = frame;
    if (record.type === 'end')
        return { ...withId, completed: true };
    // The model chunk carries the content; `start` frames carry none.
    const chunk = record.chunk;
    if (typeof chunk !== 'object' || chunk === null) {
        // A frame with no chunk is not a shape this reader understands. Reporting the frame kind
        // is the only way to learn what the harness actually sends: the tool-call chunks this
        // plugin keys on were never observed arriving, and an unobserved assumption cannot be
        // distinguished from a wrong one by reading the code.
        return {
            ...withId,
            frameShape: `frame:${Object.keys(record).join(',')};type=${String(record.type)}`,
        };
    }
    const item = chunk;
    // Every chunk kind seen, reported once by the caller. Chunk types are a closed set, so this
    // is bounded and shows exactly which vocabulary the stream uses.
    const observed = { ...withId, chunkType: String(item.type) };
    switch (item.type) {
        case 'text-delta':
            // The model's actual output.
            return typeof item.text === 'string' ? { ...withId, text: item.text, ...observed } : observed;
        case 'tool-call-delta': {
            // Observed: this frame carries `type,index,id,argumentsDelta` and **no tool name**. The
            // name has to come from elsewhere, which is why the block boundaries report their own
            // fields below rather than this reader guessing a second time.
            const id = typeof item.id === 'string' ? item.id : undefined;
            const name = typeof item.name === 'string' ? item.name : undefined;
            if (id === undefined || name === undefined || name === '') {
                return { ...withId, toolCallShape: Object.keys(item).join(','), ...observed };
            }
            return { ...withId, toolCall: { id, name }, ...observed };
        }
        case 'block-start':
        case 'block-end':
            // A tool block's opening frame is the likely carrier of the tool name, since the delta
            // frames carry only an id and argument fragments.
            return {
                ...withId,
                blockShape: `${String(item.type)}:${Object.keys(item).join(',')}`,
                ...observed,
            };
        default:
            // `reasoning-delta`, `block-start`, `block-end`, `usage`, `finish`, and anything added
            // later: not user-visible text.
            //
            // `block-end` and `finish` are deliberately not completion signals, even though they
            // read like ones. `finish` fires once per model step, and a turn that calls tools has
            // several steps, so flushing on it splits one answer into several WeChat messages. Only
            // the `end` frame — handled above — closes the turn.
            return observed;
    }
}
//# sourceMappingURL=services.js.map