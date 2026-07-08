import { Chalk } from 'chalk';
import { Loader, type TUI } from '@earendil-works/pi-tui';

const chalk = new Chalk({ level: 3 });

export const THINKING_PHRASES = [
  '等等等等等等等等',
  '别催别催，快了快了',
  '先别急，哥们',
  '知道你很急，但你先别急',
  '稍等，等我想想…',
  '让我琢磨一下…',
  '稍等，理一理思路…',
  '让我想想怎么说…',
  '先想一下哈…',
  '想了想，马上来…',
  '思考中，稍候…',
  '让我好好想想…',
  '稍等片刻…',
  '在想，快了…',
  '稍等，脑子转一圈…',
  '等等，容我思考一下…',
  '让我认真想想…',
  '稍等，整理一下思路…',
  '嗯，想一想再说…',
  '好，让我先想想…',
] as const;

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const SPINNER_COLORS = [
  (s: string) => chalk.cyan(s),
  (s: string) => chalk.blue(s),
  (s: string) => chalk.magenta(s),
  (s: string) => chalk.yellow(s),
  (s: string) => chalk.green(s),
  (s: string) => chalk.red(s),
] as const;

const SHIMMER_TRAIL = [
  (s: string) => chalk.bold.white(s),
  (s: string) => chalk.cyan.bold(s),
  (s: string) => chalk.blue(s),
] as const;

export const THINKING_PHRASE_MS = 3000;
export const THINKING_SHIMMER_MS = 100;

export function pickThinkingPhrase(exclude?: string): string {
  const pool = exclude
    ? THINKING_PHRASES.filter((p) => p !== exclude)
    : [...THINKING_PHRASES];
  return pool[Math.floor(Math.random() * pool.length)] ?? THINKING_PHRASES[0];
}

/** 光标扫光：高亮头 + 渐隐尾，其余 dim */
export function formatShimmerMessage(text: string, sweepIndex: number): string {
  if (text.length === 0) return chalk.dim(text);
  const len = text.length;
  const head = ((sweepIndex % len) + len) % len;
  return [...text].map((ch, i) => {
    const dist = (head - i + len) % len;
    if (dist < SHIMMER_TRAIL.length) return SHIMMER_TRAIL[dist]!(ch);
    return chalk.dim(ch);
  }).join('');
}

function buildColorfulSpinnerFrames(): string[] {
  return BRAILLE_FRAMES.map((frame, i) => SPINNER_COLORS[i % SPINNER_COLORS.length]!(frame));
}

export interface ThinkingLoaderCallbacks {
  onPhraseChange?: (phrase: string) => void;
}

export interface ThinkingLoaderController {
  loader: Loader;
  start(): void;
  stop(): void;
  currentPhrase: string;
}

export function createThinkingLoader(
  tui: TUI,
  callbacks?: ThinkingLoaderCallbacks,
): ThinkingLoaderController {
  let currentPhrase = pickThinkingPhrase();
  let sweepIndex = 0;
  let phraseTimer: ReturnType<typeof setInterval> | null = null;
  let shimmerTimer: ReturnType<typeof setInterval> | null = null;

  const loader = new Loader(
    tui,
    (s) => s,
    (msg) => formatShimmerMessage(msg, sweepIndex),
    currentPhrase,
    { frames: buildColorfulSpinnerFrames(), intervalMs: 80 },
  );

  const refreshDisplay = () => {
    loader.setMessage(currentPhrase);
  };

  const rotatePhrase = () => {
    currentPhrase = pickThinkingPhrase(currentPhrase);
    sweepIndex = 0;
    refreshDisplay();
    callbacks?.onPhraseChange?.(currentPhrase);
  };

  return {
    loader,
    get currentPhrase() {
      return currentPhrase;
    },
    start() {
      sweepIndex = 0;
      refreshDisplay();
      loader.start();
      shimmerTimer = setInterval(() => {
        sweepIndex++;
        refreshDisplay();
      }, THINKING_SHIMMER_MS);
      phraseTimer = setInterval(rotatePhrase, THINKING_PHRASE_MS);
      callbacks?.onPhraseChange?.(currentPhrase);
    },
    stop() {
      if (shimmerTimer) {
        clearInterval(shimmerTimer);
        shimmerTimer = null;
      }
      if (phraseTimer) {
        clearInterval(phraseTimer);
        phraseTimer = null;
      }
      loader.stop();
    },
  };
}
