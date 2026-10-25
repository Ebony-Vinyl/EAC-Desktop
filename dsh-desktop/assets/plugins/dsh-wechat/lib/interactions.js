/**
 * Answering the harness's interactive prompts over WeChat.
 *
 * Two things normally require a decision the agent cannot make alone: a permission prompt (may
 * this action run?) and a structured question (which of these options do you want?). Both are
 * answered in the desktop conversation pane, through a scoped waterfall event where an answerer
 * either claims the request by returning an outcome or delegates with `next()`.
 *
 * A user whose only device is the phone never sees that pane, and the harness's own answerer
 * fails closed — so the turn stalls with no way to continue. This module claims those requests
 * for conversations that are bound to WeChat, sends the prompt as a chat message, and turns the
 * user's reply back into the outcome the harness expects.
 *
 * Unbound conversations are delegated untouched, so desktop use is unaffected.
 *
 * @module dsh-wechat/interactions
 */
/** Permission words, in both languages the plugin's users write. */
const ALLOW_WORDS = ['允许', '同意', '可以', '好', '行', 'yes', 'y', 'allow', 'ok', 'okay'];
const DENY_WORDS = ['拒绝', '不允许', '不行', '不要', '否', 'no', 'n', 'deny', 'reject', 'cancel', '取消'];
/**
 * Read a permission decision from a reply.
 *
 * Matched whole-word rather than by substring, so "不可以" denies and "可以" allows without one
 * shadowing the other. An unrecognised reply returns undefined and is not treated as a denial.
 *
 * @param reply - The user's message.
 * @returns The outcome, or undefined when the text is not a decision.
 */
export function parseApprovalReply(reply) {
    const text = reply.trim().toLowerCase();
    if (text === '')
        return undefined;
    // Denials are checked first: "不允许" contains "允许", and a denial must not be read as consent.
    if (DENY_WORDS.some((word) => text === word || text.startsWith(`${word} `)))
        return 'rejected';
    if (ALLOW_WORDS.some((word) => text === word || text.startsWith(`${word} `)))
        return 'allowed-once';
    return undefined;
}
/**
 * Render a permission prompt for the chat.
 *
 * @param request - The harness's approval request.
 * @returns The message body.
 */
export function presentApproval(request) {
    const toolName = typeof request.toolName === 'string' ? request.toolName : '某个操作';
    const reason = [request.displayReason, request.reason, request.command].find((value) => typeof value === 'string' && value !== '');
    const lines = [`🔐 需要你确认：${toolName}`];
    if (typeof reason === 'string')
        lines.push(reason, '');
    else
        lines.push('');
    lines.push('回复 允许 或 拒绝');
    return { body: lines.join('\n') };
}
/**
 * Render a structured question for the chat.
 *
 * Options are numbered so the reply can be a single digit rather than the full label — the whole
 * point is to be answerable from a phone keyboard.
 *
 * @param questions - The questions to render.
 * @returns The message body.
 */
export function presentQuestions(questions) {
    const blocks = [];
    for (const [index, item] of questions.entries()) {
        const lines = [];
        if (questions.length > 1)
            lines.push(`${String(index + 1)}. ${item.question}`);
        else
            lines.push(item.question);
        if (item.detail !== undefined && item.detail !== '')
            lines.push(item.detail);
        if (item.options !== undefined && item.options.length > 0) {
            lines.push('');
            for (const [optionIndex, option] of item.options.entries()) {
                const suffix = option.description === undefined ? '' : ` — ${option.description}`;
                lines.push(`${String(optionIndex + 1)}. ${option.label}${suffix}`);
            }
            lines.push('');
            const many = item.multiSelect === true;
            lines.push(many ? '回复编号（可多个，如 1,3），或直接回复你的答案' : '回复编号，或直接回复你的答案');
        }
        else {
            lines.push('');
            lines.push('直接回复你的答案');
        }
        blocks.push(lines.join('\n'));
    }
    return { body: blocks.join('\n\n') };
}
/**
 * Read answers from a reply, one per question.
 *
 * A reply of numbers picks those options; any other text becomes a free-form answer. Text is
 * never rejected: refusing to understand a user leaves them stuck at a prompt, which is the
 * problem this module exists to solve.
 *
 * @param questions - The questions being answered.
 * @param reply - The user's message.
 * @returns One answer per question.
 */
export function parseQuestionReply(questions, reply) {
    const text = reply.trim();
    const answers = questions.map((item) => {
        const options = item.options ?? [];
        const indices = readIndices(text, options.length);
        if (indices.length > 0) {
            const selected = indices.map((index) => options[index]?.label ?? '');
            const multi = item.multiSelect === true ? selected : selected.slice(0, 1);
            return { id: item.id, selected: multi.filter((label) => label !== '') };
        }
        // Not a set of indices: treat the whole reply as the answer. With options present the label
        // is preferred, otherwise the free text is carried in `custom`.
        if (options.length === 0)
            return { id: item.id, selected: [], custom: text };
        const matched = options.find((option) => option.label === text);
        return matched === undefined
            ? { id: item.id, selected: [], custom: text }
            : { id: item.id, selected: [matched.label] };
    });
    return { answers };
}
/**
 * Read the option positions named in a reply.
 *
 * Accepts `2`, `1,3`, `1 3`, and the full-width comma a Chinese keyboard produces. Every number
 * must name a real option, so "5" against three options is not read as a choice.
 *
 * @param text - The user's reply.
 * @param optionCount - How many options the question offers.
 * @returns Zero-based positions, in the order written.
 */
function readIndices(text, optionCount) {
    if (optionCount === 0)
        return [];
    if (!/^[\d\s,，、]+$/.test(text))
        return [];
    const numbers = text.split(/[\s,，、]+/).filter((part) => part !== '');
    const indices = [];
    for (const part of numbers) {
        const value = Number.parseInt(part, 10);
        if (!Number.isInteger(value) || value < 1 || value > optionCount)
            return [];
        indices.push(value - 1);
    }
    return indices;
}
//# sourceMappingURL=interactions.js.map