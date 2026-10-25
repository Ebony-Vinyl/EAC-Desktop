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
/** What the harness expects back from a permission prompt. */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled';
/** One selectable answer on a structured question. */
export interface QuestionOption {
    label: string;
    description?: string;
}
/** One structured question awaiting an answer. */
export interface QuestionItem {
    id: string;
    question: string;
    detail?: string;
    header?: string;
    options?: QuestionOption[];
    multiSelect?: boolean;
}
/** One answered question, in the shape the harness validates. */
export interface QuestionAnswer {
    id: string;
    selected: string[];
    custom?: string;
}
/** The batch the harness validates for a structured question. */
export interface QuestionAnswerBatch {
    answers: QuestionAnswer[];
}
/** The prompt text to show the user. */
interface Presentation {
    body: string;
}
/**
 * Read a permission decision from a reply.
 *
 * Matched whole-word rather than by substring, so "不可以" denies and "可以" allows without one
 * shadowing the other. An unrecognised reply returns undefined and is not treated as a denial.
 *
 * @param reply - The user's message.
 * @returns The outcome, or undefined when the text is not a decision.
 */
export declare function parseApprovalReply(reply: string): ApprovalOutcome | undefined;
/**
 * Render a permission prompt for the chat.
 *
 * @param request - The harness's approval request.
 * @returns The message body.
 */
export declare function presentApproval(request: {
    toolName?: unknown;
    displayReason?: unknown;
    reason?: unknown;
    command?: unknown;
}): Presentation;
/**
 * Render a structured question for the chat.
 *
 * Options are numbered so the reply can be a single digit rather than the full label — the whole
 * point is to be answerable from a phone keyboard.
 *
 * @param questions - The questions to render.
 * @returns The message body.
 */
export declare function presentQuestions(questions: readonly QuestionItem[]): Presentation;
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
export declare function parseQuestionReply(questions: readonly QuestionItem[], reply: string): QuestionAnswerBatch;
export {};
//# sourceMappingURL=interactions.d.ts.map