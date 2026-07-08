export const EDITOR_PLACEHOLDERS = [
  'Ask anything…',
  'Type /k-flow to route your request',
  'Describe what you want to build',
  'Try /k-feat for a new feature, /k-issue for a bug',
  'What would you like to work on?',
  'Message hcent…',
  '输入问题，或用 /k-xxx 引用技能',
  '先 /k-brainstorm 聊聊想法，再 /k-feat 落地',
  'Typing everything…',
  'How can I help you today?',
];

export function pickRandomPlaceholder(): string {
  return EDITOR_PLACEHOLDERS[Math.floor(Math.random() * EDITOR_PLACEHOLDERS.length)]!;
}
