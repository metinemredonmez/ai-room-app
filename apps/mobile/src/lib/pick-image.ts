import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { api, ApiError, type ImageRef } from '@/lib/api';

const MAX_BYTES = 10 * 1024 * 1024;

/** The backend checks the declared type against the file signature, so derive it from the bytes. */
function sniffMime(base64: string, fallback: string | undefined): string {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (base64.startsWith('UklGR')) return 'image/webp';
  if (base64.slice(5, 16).includes('ZnR5c')) return 'image/heic';
  return fallback ?? 'image/jpeg';
}

async function assetToBase64(asset: ImagePicker.ImagePickerAsset): Promise<{ data: string; mimeType: string }> {
  let data = asset.base64 ?? null;
  if (!data && asset.uri.startsWith('data:')) data = asset.uri.slice(asset.uri.indexOf(',') + 1);
  if (!data && Platform.OS === 'web') {
    const blob = await (await fetch(asset.uri)).blob();
    data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  if (!data) throw new ApiError(400, 'bad_request', 'no image data');
  return { data, mimeType: sniffMime(data, asset.mimeType) };
}

export type PickSource = 'library' | 'camera';

/** Returns null when the user cancels. Throws ApiError('camera_denied' | 'payload_too_large' | …). */
export async function pickAndUpload(source: PickSource): Promise<ImageRef | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.8,
    base64: true,
    allowsEditing: false,
    exif: false,
  };
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new ApiError(0, 'camera_denied', 'camera permission denied');
    result = await ImagePicker.launchCameraAsync(options);
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options);
  }
  if (result.canceled || !result.assets?.length) return null;
  const { data, mimeType } = await assetToBase64(result.assets[0]);
  if (data.length * 0.75 > MAX_BYTES) throw new ApiError(413, 'payload_too_large', 'too large');
  const { image } = await api.upload(data, mimeType);
  return image;
}
