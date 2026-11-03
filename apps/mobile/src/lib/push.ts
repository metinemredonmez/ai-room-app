// Web / unsupported platforms: no push (iOS/Android use push.native.ts).

export const pushAvailable = false;

export async function syncPush(): Promise<void> {}

export async function enablePush(): Promise<boolean> {
  return false;
}

export async function disablePush(): Promise<void> {}

export function onPushOpen(_open: (designId: string) => void): () => void {
  return () => undefined;
}
