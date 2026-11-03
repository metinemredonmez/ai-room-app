"use client";

import type { ImageRef, ToolId } from "./types";

// Hand-off between pages (chat suggestion → studio, result → studio/chat) through sessionStorage,
// so signed image URLs never end up in the address bar, history or Referer headers.

export type StudioPrefill = {
  tool?: ToolId;
  styleId?: string;
  roomId?: string;
  instructions?: string;
  image?: ImageRef;
  fromChat?: boolean;
};

export type ChatPrefill = { image: ImageRef; text?: string };

const STUDIO_KEY = "air_prefill_studio";
const CHAT_KEY = "air_prefill_chat";

function write(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// Read without removing (safe inside useState initializers, which StrictMode may call twice);
// clear separately from an effect once the page has consumed it.
function peek<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function clear(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}

export const setStudioPrefill = (p: StudioPrefill) => write(STUDIO_KEY, p);
export const peekStudioPrefill = () => peek<StudioPrefill>(STUDIO_KEY);
export const clearStudioPrefill = () => clear(STUDIO_KEY);
export const setChatPrefill = (p: ChatPrefill) => write(CHAT_KEY, p);
export const peekChatPrefill = () => peek<ChatPrefill>(CHAT_KEY);
export const clearChatPrefill = () => clear(CHAT_KEY);
