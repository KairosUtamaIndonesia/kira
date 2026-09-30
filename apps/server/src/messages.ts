/**
 * What the server tells a person when it refuses a request.
 *
 * The desktop shows these as they arrive, so this file is the one home for their wording.
 * The error codes live beside the routes that raise them and do not change when a message
 * does. Write for the person looking at the ticket: say what is wrong and what to do next,
 * in the project's words — ticket, blocker, chat, workspace — not the server's.
 */

const list = (options: readonly string[], joiner = ', ') => options.join(joiner);

export const messages = {
  ticketNotFound: 'That ticket no longer exists.',
  blockerTicketNotFound: 'The ticket you chose as a blocker no longer exists.',
  relatedTicketNotFound: 'The related ticket no longer exists.',
  projectNotFound: 'That project no longer exists.',
  assigneeNotFound: 'That person is not a member of this project.',

  kindUnknown: (kinds: readonly string[]) => `Choose a ticket kind: ${list(kinds)}.`,
  statusUnknown: (statuses: readonly string[]) => `Choose a status: ${list(statuses)}.`,
  priorityUnknown: (priorities: readonly string[]) => `Choose a priority: ${list(priorities)}.`,
  relationshipUnknown: (relationships: readonly string[]) =>
    `Choose a relationship: ${list(relationships)}.`,
  relationshipNotSupported: 'That kind of relationship is not supported.',
  tagEmpty: 'A tag can’t be empty.',

  nameRequired: 'Give the project a name.',
  prefixInvalid: 'A prefix is two to six characters and starts with a letter, like FND or A1B2C3.',
  prefixTaken: (prefix: string) => `Another project already uses the prefix ${prefix}.`,

  mapRequired: 'Only a map can take a destination spec.',
  mapClosed: 'This map is closed and already has its destination.',
  mapNotYours: 'Only the person who approved the map can finish it.',
  mapChildrenOpen:
    'Close every question and research ticket on the map, each with an approved Outcome, before writing its destination spec.',
  mapDestinationRequired: 'A map closes only once its destination spec is approved.',

  breakdownNotSpecToPublish: 'Only a spec can publish a breakdown.',
  breakdownNotSpecToReady: 'Only a spec can mark its breakdown ready.',
  breakdownAlreadyPublished: 'This spec already has a breakdown.',
  breakdownEmpty: 'A breakdown needs at least one ticket.',
  breakdownDuplicate: 'Each ticket in a breakdown needs its own id.',
  breakdownBlockerUnknown: 'A ticket in a breakdown can only be blocked by another ticket in it.',
  criteriaRequired: 'Say how we’ll know this ticket is done before making it Ready.',

  questionKindRequired: 'Only a question has a linked Kira chat.',
  questionNotYours: 'Only the person who wrote the question can work on it.',
  questionClosed: 'This question is closed and already answered.',
  questionNotReady: 'A question can be worked on once it is ready.',
  chatIdRequired: 'Link a Kira chat to this question first.',
  questionChatRequired: 'Approve the Outcome from the question’s linked Kira chat.',

  outcomeNotFound: 'This ticket has no approved Outcome yet.',
  outcomeResearchOnly: 'Only a research ticket can record an Outcome directly.',
  outcomeNotYoursResearch: 'Only the person who wrote the research can record its Outcome.',
  outcomeNotYoursQuestion: 'Only the person who wrote the question can approve its Outcome.',
  outcomeQuestionOnly: 'Only a question’s Outcome is approved from its linked chat.',
  outcomeExists: 'This ticket already has an approved Outcome.',
  outcomeRequiredToClose: 'Approve an Outcome before closing a question or research ticket.',
  outcomeIncomplete: 'A question or research ticket needs an answer and its sources.',
  decisionProposalInvalid: 'A Decision proposal needs its context and its consequences.',

  blockerSelf: 'A ticket can’t block itself.',
  blockerOtherProject: 'A ticket can only be blocked by another ticket in the same project.',
  blockerCircle:
    'Those two tickets would wait on each other. Choose a ticket that isn’t already blocked by this one.',
  relationshipOtherProject: 'Related tickets must be in the same project.',
  relationshipSelf: 'A ticket can’t be related to itself.',
  parentExists: 'A ticket can have only one parent.',
};
