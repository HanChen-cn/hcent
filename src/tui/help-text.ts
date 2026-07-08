export const HELP_TEXT = `Available commands:
  /help            Show this help
  /clear           Clear current session (keeps system prompt)
  /model [name]    List models or switch model
  /status          Show current model / message count / status
  /save [title]    Save current session
  /load [id]       List or load saved sessions
  /sessions        List saved sessions
  /exit            Exit the program

Skills:
  /k-xxx           Reference a skill by name (e.g. /k-flow, /k-feat)
                   Multiple skills per message supported
                   Agent reads SKILL.md on demand (progressive disclosure)`;
