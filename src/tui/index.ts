import chalk from 'chalk';
import {
  Container,
  Loader,
  Markdown,
  matchesKey,
  Key,
  ProcessTerminal,
  SelectList,
  Text,
  TUI,
  type Component,
  type SelectListTheme,
  type SlashCommand,
} from '@earendil-works/pi-tui';
import { type AppConfig, loadConfig } from '../config/index.js';
import { type Session, type Message, createMessage } from '../session/index.js';

import type { ProviderManager } from '../provider/provider-manager.js';
import { createContextManager, estimateMessagesTokens } from '../agent/context-manager.js';
import type { SessionStore } from '../session/session-store.js';
import type { CommandPalette } from '../skill/command-palette.js';
import type { SkillRegistry } from '../skill/index.js';
import type { ToolRegistry } from '../tools/index.js';
import { type ConfirmFn, createPermissionGate } from '../tools/permission.js';
import { runAgentTurn, type AgentEvents, type AgentStatus } from '../agent/index.js';

import { setupGuideLines, writeUserConfig } from '../setup/index.js';
import { HELP_TEXT } from './help-text.js';
import { appendEditorHistory } from './editor-history.js';
import { pickRandomPlaceholder } from './editor-placeholder.js';
import { EditorWithPlaceholder } from './editor-with-placeholder.js';
import { HcentAutocompleteProvider } from './hcent-autocomplete.js';
import { toolCallSummary } from './message-display.js';
import { defaultEditorTheme, defaultMarkdownTheme } from './pi-themes.js';
import { formatAssistantStream } from './user-message.js';
import { RightAlignedText } from './aligned-text.js';
import {
  buildSkillPointerContent,
  extractSkillReferences,
  hasUserContentBeyondSkills,
} from '../skill/skill-pointer.js';
import { createThinkingLoader, type ThinkingLoaderController } from './thinking-loader.js';
import {
  executeBuiltinCommand,
  parseBuiltinCommand,
  type BuiltinCommandContext,
} from './builtin-commands.js';
import { renderMessageComponent } from './render-message.js';

// ── 权限确认 Overlay（↑↓ 选择 yes/no，Enter 确认）──

const WELCOME_TEXT = [
  '**欢迎使用 hcent！**',
  '',
  '我是终端编码助手，可以帮你分析代码、查找文件、执行操作。',
  '',
  '- `/k-xxx` 引用 skill（按需读取 SKILL.md）',
  '- `/help` 查看全部命令',
  '',
  '在下方输入问题开始对话。',
].join('\n');

class PermissionConfirmOverlay implements Component {
  private header: Text;
  private list: SelectList;

  constructor(
    tool: string,
    args: Record<string, unknown>,
    theme: SelectListTheme,
    onResolve: (ok: boolean) => void,
  ) {
    const summary = toolCallSummary(tool, args);
    const headerLines = [
      chalk.yellow.bold('权限确认'),
      chalk.cyan.bold(tool) + (summary ? chalk.dim(` · ${summary}`) : ''),
      '',
    ].join('\n');
    this.header = new Text(headerLines, 0, 0);
    this.list = new SelectList(
      [
        { value: 'yes', label: '允许 (yes)' },
        { value: 'no', label: '拒绝 (no)' },
      ],
      2,
      theme,
      { maxPrimaryColumnWidth: 24, minPrimaryColumnWidth: 12 },
    );
    this.list.setSelectedIndex(0);
    this.list.onSelect = (item) => onResolve(item.value === 'yes');
    this.list.onCancel = () => onResolve(false);
  }

  invalidate(): void {
    this.header.invalidate();
    this.list.invalidate();
  }

  render(width: number): string[] {
    const hint = chalk.dim('  ↑↓ 选择 · Enter 确认');
    return [...this.header.render(width), ...this.list.render(width), hint];
  }

  handleInput(data: string): void {
    this.list.handleInput?.(data);
  }
}

// ── App Props ──

export interface PiTuiAppProps {
  config: AppConfig;
  session: Session;
  providerManager: ProviderManager;
  tools: ToolRegistry;
  store: SessionStore;
  palette: CommandPalette;
  skillRegistry: SkillRegistry;
  needsSetup?: boolean;
}

// ── 主应用 ──

export function runPiTuiApp(props: PiTuiAppProps): void {
  const {
    config,
    session,
    providerManager,
    tools,
    store,
    palette,
    skillRegistry,
    needsSetup: initialNeedsSetup = false,
  } = props;

  const terminal = new ProcessTerminal();
  // pi-tui 通过 CURSOR_MARKER + 相对移动定位硬件光标（供 IME）。
  // Windows 默认开启可见硬件光标；设 PI_HARDWARE_CURSOR=0 关闭，=1 强制开启。
  const showVisibleHwCursor =
    process.env.PI_HARDWARE_CURSOR === '1' ||
    (process.platform === 'win32' && process.env.PI_HARDWARE_CURSOR !== '0');
  const tui = new TUI(terminal, showVisibleHwCursor);

  const mdTheme = defaultMarkdownTheme;
  const editorTheme = defaultEditorTheme;

  const messages = new Container();
  const footer = new Container();
  const confirmSlot = new Container();
  const statusBar = new RightAlignedText('', 0);
  const editor = new EditorWithPlaceholder(tui, editorTheme);

  let currentPlaceholder = pickRandomPlaceholder();

  const refreshPlaceholderHint = () => {
    editor.setPlaceholder(editor.getText().length === 0 && !setupMode ? currentPlaceholder : '');
    tui.requestRender();
  };

  editor.onChange = () => refreshPlaceholderHint();

  footer.addChild(confirmSlot);
  footer.addChild(statusBar);
  footer.addChild(editor);
  tui.addChild(messages);
  tui.addChild(footer);
  tui.setFocus(editor);

  let setupMode = initialNeedsSetup;
  let setupError = '';
  let modelName = providerManager.activeModelConfig.name;
  let status: AgentStatus = 'idle';
  let isProcessing = false;
  let showHelp = false;
  let welcomeComponent: Markdown | null = null;
  let helpComponent: Text | null = null;
  let streamingMd: Markdown | null = null;
  let streamingText = '';
  let lastStreamDeltaAt = 0;
  let streamIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let loader: Loader | null = null;
  let thinkingLoaderCtrl: ThinkingLoaderController | null = null;
  let currentThinkingPhrase = '';
  let activeToolCallId: string | null = null;
  let confirmPanel: PermissionConfirmOverlay | null = null;

  const mountEditor = () => {
    if (!footer.children.includes(editor)) {
      footer.addChild(editor);
    }
    tui.setFocus(editor);
  };

  const unmountEditor = () => {
    if (footer.children.includes(editor)) {
      footer.removeChild(editor);
    }
  };

  const clearConfirmPanel = () => {
    confirmSlot.clear();
    confirmPanel = null;
    mountEditor();
  };

  const statusLabel = (s: typeof status): string => {
    switch (s) {
      case 'thinking': return currentThinkingPhrase || '稍等，等我想想…';
      case 'calling_tool': return '调用工具中…';
      case 'awaiting_permission': return '等待权限确认…';
      default: return '';
    }
  };

  /** 流式 token 超过此间隔未更新，则视为非活跃（应显示 Loader + Agent 状态） */
  const STREAM_IDLE_MS = 400;

  const clearStreamIdleTimer = () => {
    if (streamIdleTimer) {
      clearTimeout(streamIdleTimer);
      streamIdleTimer = null;
    }
  };

  const scheduleStreamIdleCheck = () => {
    clearStreamIdleTimer();
    streamIdleTimer = setTimeout(() => {
      streamIdleTimer = null;
      if (!isProcessing || !streamingMd) return;
      refreshLoader();
      updateStatusBar();
      tui.requestRender();
    }, STREAM_IDLE_MS + 50);
  };

  /** 是否正在真实流式输出（近期收到 token 且有可见流式组件） */
  const isActivelyStreaming = () => {
    if (!streamingMd || streamingText.trim().length === 0) return false;
    return Date.now() - lastStreamDeltaAt < STREAM_IDLE_MS;
  };

  const activityLabel = (): string => {
    if (isActivelyStreaming()) return '输出中…';
    return statusLabel(status);
  };

  const updateStatusBar = () => {
    const mc = providerManager.activeModelConfig;
    const tokens = estimateMessagesTokens(session.snapshot());
    const pct = Math.round((tokens / mc.maxContextTokens) * 100);
    const label = activityLabel();
    const activity = status !== 'idle' ? chalk.yellow(` · ${label}`) : '';
    statusBar.setText(
      chalk.dim(`${modelName} · ctx: `)
        + chalk.cyan(`${tokens}/${mc.maxContextTokens} (${pct}%)`)
        + activity,
    );
  };

  const refreshWelcome = () => {
    if (setupMode || showHelp) {
      if (welcomeComponent) {
        messages.removeChild(welcomeComponent);
        welcomeComponent = null;
      }
      return;
    }
    if (!welcomeComponent) {
      welcomeComponent = new Markdown(WELCOME_TEXT, 1, 0, mdTheme);
      messages.addChild(welcomeComponent);
    }
  };

  const clearMessagesUi = () => {
    messages.clear();
    welcomeComponent = null;
    helpComponent = null;
    refreshWelcome();
  };

  const removeStreaming = () => {
    clearStreamIdleTimer();
    lastStreamDeltaAt = 0;
    streamingText = '';
    if (streamingMd) {
      messages.removeChild(streamingMd);
      streamingMd = null;
    }
  };

  const removeLoader = () => {
    if (thinkingLoaderCtrl) {
      thinkingLoaderCtrl.stop();
      messages.removeChild(thinkingLoaderCtrl.loader);
      thinkingLoaderCtrl = null;
    }
    if (loader) {
      loader.stop();
      messages.removeChild(loader);
      loader = null;
    }
    currentThinkingPhrase = '';
  };

  const showLoader = (message: string) => {
    removeLoader();
    if (status === 'thinking') {
      thinkingLoaderCtrl = createThinkingLoader(tui, {
        onPhraseChange: (phrase) => {
          currentThinkingPhrase = phrase;
          updateStatusBar();
        },
      });
      currentThinkingPhrase = thinkingLoaderCtrl.currentPhrase;
      messages.addChild(thinkingLoaderCtrl.loader);
      thinkingLoaderCtrl.start();
    } else {
      loader = new Loader(tui, (s) => chalk.cyan(s), (s) => chalk.dim(s), message);
      messages.addChild(loader);
      loader.start();
    }
    tui.requestRender();
  };

  /** 非真实流式输出且仍在处理时，恢复消息区 Loader */
  const refreshLoader = () => {
    if (!isProcessing || status === 'idle' || confirmPanel) {
      removeLoader();
      return;
    }
    if (isActivelyStreaming()) {
      removeLoader();
      return;
    }
    showLoader(activityLabel());
  };

  const renderMessage = (m: Message, activeId: string | null): Component | null =>
    renderMessageComponent(m, activeId, mdTheme);

  const rebuildMessages = () => {
    const keepStreaming = streamingMd;
    messages.clear();
    welcomeComponent = null;
    if (showHelp && helpComponent) {
      messages.addChild(helpComponent);
    } else {
      if (!setupMode) {
        welcomeComponent = new Markdown(WELCOME_TEXT, 1, 0, mdTheme);
        messages.addChild(welcomeComponent);
      }
      for (const m of session.snapshot()) {
        const comp = renderMessage(m, activeToolCallId);
        if (comp) messages.addChild(comp);
      }
    }
    if (keepStreaming) messages.addChild(keepStreaming);
    updateStatusBar();
    tui.requestRender();
  };

  const syncMessages = () => {
    rebuildMessages();
    if (isProcessing && status !== 'idle') refreshLoader();
  };

  const confirmFn: ConfirmFn = (req) =>
    new Promise<boolean>((resolve) => {
      removeLoader();
      confirmPanel = new PermissionConfirmOverlay(
        req.tool,
        req.args,
        editorTheme.selectList,
        (ok) => {
          clearConfirmPanel();
          editor.disableSubmit = isProcessing;
          resolve(ok);
          tui.requestRender();
        },
      );
      confirmSlot.clear();
      confirmSlot.addChild(confirmPanel);
      unmountEditor();
      editor.disableSubmit = true;
      tui.setFocus(confirmPanel);
      tui.requestRender();
    });

  const buildDeps = () => {
    const gate = createPermissionGate(confirmFn);
    const mc = providerManager.activeModelConfig;
    return {
      provider: providerManager.current,
      tools,
      permission: gate,
      session,
      config,
      contextManager: createContextManager(
        { maxContextTokens: mc.maxContextTokens, reserveForReply: 4096, summarizeThreshold: 0.3 },
        providerManager.current,
      ),
    };
  };

  const buildEvents = (): AgentEvents => ({
    onStatus(s) {
      status = s;
      if (s === 'idle') {
        removeLoader();
        removeStreaming();
        if (showVisibleHwCursor) tui.setShowHardwareCursor(true);
      } else if (s === 'thinking' || s === 'calling_tool') {
        removeStreaming();
      }
      syncMessages();
      updateStatusBar();
    },
    onAssistantDelta(text) {
      removeLoader();
      if (showVisibleHwCursor) tui.setShowHardwareCursor(false);
      streamingText += text;
      lastStreamDeltaAt = Date.now();
      if (!streamingMd) {
        streamingMd = new Markdown('', 1, 0, mdTheme);
        messages.addChild(streamingMd);
      }
      streamingMd.setText(formatAssistantStream(streamingText));
      scheduleStreamIdleCheck();
      updateStatusBar();
      tui.requestRender();
    },
    onAssistantComplete() {
      removeStreaming();
      syncMessages();
    },
    onStreamStart() {
      removeStreaming();
      syncMessages();
    },
    onToolCall(call) {
      activeToolCallId = call.id;
      syncMessages();
    },
    onToolResult() {
      activeToolCallId = null;
      syncMessages();
    },
    onError() {
      syncMessages();
    },
  });

  const renderSetupGuide = () => {
    const lines = setupGuideLines();
    if (setupError) lines.push(`错误: ${setupError}`);
    return new Text(lines.map((l, i) => (i === 0 ? chalk.cyan.bold(l) : l)).join('\n'), 1, 0);
  };

  const activateSkillsFromInput = (text: string): boolean => {
    const { skills, unknown } = extractSkillReferences(text, (name) => skillRegistry.get(name));

    for (const skill of skills) {
      session.addSkill(
        skill.name,
        skill.filePath,
        skill.description,
        buildSkillPointerContent(skill),
      );
    }

    if (skills.length > 0) {
      const names = skills.map((s) => s.name).join(', ');
      session.append(createMessage({ role: 'system', content: `已引用 skill: ${names}` }));
    }

    if (unknown.length > 0) {
      session.append(createMessage({
        role: 'system',
        content: `未找到 skill: ${unknown.map((n) => `/${n}`).join(', ')}. 输入 /help 查看可用命令与 skill`,
        kind: 'error',
      }));
    }

    return skills.length > 0 || unknown.length > 0;
  };

  const toggleHelp = (on: boolean) => {
    showHelp = on;
    if (on) {
      helpComponent = new Text(HELP_TEXT, 1, 1);
      messages.clear();
      messages.addChild(helpComponent);
    } else {
      helpComponent = null;
      rebuildMessages();
    }
    tui.requestRender();
  };

  const builtinCommandContext = (): BuiltinCommandContext => ({
    session,
    store,
    providerManager,
    config,
    modelName,
    status,
    setModelName: (name) => { modelName = name; },
    onHelp: toggleHelp,
    onClear: () => {
      session.clear();
      showHelp = false;
      helpComponent = null;
      activeToolCallId = null;
      clearMessagesUi();
      syncMessages();
    },
    onExit: () => {
      tui.stop();
      process.exit(0);
    },
    syncMessages,
  });

  const handleSetupSubmit = (text: string) => {
    try {
      writeUserConfig(text);
      const newConfig = loadConfig(process.cwd());
      Object.assign(config, newConfig);
      providerManager.switch(newConfig.activeModel);
      session.append(createMessage({ role: 'system', content: 'API Key 已配置并保存。现在可以开始使用了！输入 /help 查看命令。' }));
      setupMode = false;
      setupError = '';
      modelName = providerManager.activeModelConfig.name;
      editor.setText('');
      syncMessages();
    } catch (err) {
      setupError = err instanceof Error ? err.message : String(err);
      messages.clear();
      messages.addChild(renderSetupGuide());
      tui.requestRender();
    }
  };

  const handleSkillInput = (text: string): boolean => {
    const hadSkillRefs = activateSkillsFromInput(text);
    const triggerMatched = skillRegistry.match(text);
    const slashSkills = extractSkillReferences(text, (n) => skillRegistry.get(n)).skills;
    if (triggerMatched && !slashSkills.some((s) => s.name === triggerMatched.name)) {
      session.addSkill(
        triggerMatched.name,
        triggerMatched.filePath,
        triggerMatched.description,
        buildSkillPointerContent(triggerMatched),
      );
      session.append(createMessage({ role: 'system', content: `已引用 skill: ${triggerMatched.name}` }));
    }
    if (!hadSkillRefs && !triggerMatched) return false;
    syncMessages();
    return !hasUserContentBeyondSkills(text);
  };

  const runAgentFromInput = async (text: string) => {
    isProcessing = true;
    editor.disableSubmit = true;
    if (showVisibleHwCursor) tui.setShowHardwareCursor(false);
    showHelp = false;
    helpComponent = null;
    streamingText = '';
    removeStreaming();
    activeToolCallId = null;

    await runAgentTurn(text, buildDeps(), buildEvents());

    clearStreamIdleTimer();
    syncMessages();
    streamingText = '';
    removeStreaming();
    activeToolCallId = null;
    status = 'idle';
    isProcessing = false;
    editor.disableSubmit = false;
    if (showVisibleHwCursor) tui.setShowHardwareCursor(true);
    updateStatusBar();
    tui.requestRender();
  };

  const handleSubmit = async (submittedText?: string) => {
    if (isProcessing) return;
    const text = (submittedText ?? editor.getExpandedText()).trim();
    if (!text) return;

    if (setupMode) {
      handleSetupSubmit(text);
      return;
    }

    appendEditorHistory(editor, text);
    editor.setText('');
    currentPlaceholder = pickRandomPlaceholder();
    refreshPlaceholderHint();

    const cmd = parseBuiltinCommand(text);
    if (cmd) {
      await executeBuiltinCommand(cmd, builtinCommandContext());
      return;
    }

    if (handleSkillInput(text)) return;

    await runAgentFromInput(text);
  };

  // Autocomplete：内置命令 + skill
  const slashCommands: SlashCommand[] = palette.entries().map((e) => ({
    name: e.type === 'skill' ? e.name : e.name,
    description: e.description,
  }));

  const autocomplete = new HcentAutocompleteProvider(slashCommands, process.cwd());
  editor.setAutocompleteProvider(autocomplete);

  editor.onSubmit = (text) => {
    void handleSubmit(text);
  };

  tui.addInputListener((data) => {
    if (matchesKey(data, Key.ctrl('c'))) {
      tui.stop();
      process.exit(0);
      return { consume: true };
    }
    return undefined;
  });

  if (setupMode) {
    messages.addChild(renderSetupGuide());
  } else {
    refreshWelcome();
  }
  updateStatusBar();
  refreshPlaceholderHint();

  tui.start();
}
