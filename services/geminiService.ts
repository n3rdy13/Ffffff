
import { GoogleGenAI, GenerateContentResponse, Chat, Content, Modality, Type, HarmCategory, HarmBlockThreshold, SafetySetting } from "@google/genai";
import { Character, Message } from "../types";
import { buildSystemPrompt } from "../constants";

// Default model line-up. Everything here is eligible for the Gemini API free
// tier, so the app works with a free key from https://aistudio.google.com/apikey.
// Imagen portraits and Veo video require a key from a billing-enabled project;
// the code paths that use them fall back or explain when they're unavailable.
export const TEXT_MODEL = 'gemini-3-flash-preview';
export const IMAGE_MODEL_FREE = 'gemini-2.5-flash-image';
export const IMAGE_MODEL_PREMIUM = 'imagen-4.0-generate-001';
export const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
export const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
export const VIDEO_MODEL = 'veo-3.1-fast-generate-preview';

const API_KEY_STORAGE = 'personax_api_key';
const TEXT_MODEL_STORAGE = 'personax_text_model';
const LIVE_MODEL_STORAGE = 'personax_live_model';

const readPref = (key: string, fallback: string): string => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};

const writePref = (key: string, value: string): void => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // localStorage unavailable — preference lasts only this page load
  }
};

export const getTextModel = (): string => readPref(TEXT_MODEL_STORAGE, TEXT_MODEL);
export const setTextModel = (model: string): void => writePref(TEXT_MODEL_STORAGE, model);
export const getLiveModel = (): string => readPref(LIVE_MODEL_STORAGE, LIVE_MODEL);
export const setLiveModel = (model: string): void => writePref(LIVE_MODEL_STORAGE, model);

export interface ModelOption {
  id: string;
  label: string;
}

export interface AvailableModels {
  chat: ModelOption[];
  voice: ModelOption[];
}

const FALLBACK_MODELS: AvailableModels = {
  chat: [{ id: TEXT_MODEL, label: 'Gemini Flash (default)' }],
  voice: [{ id: LIVE_MODEL, label: 'Gemini Native Audio (default)' }],
};

let modelsCache: AvailableModels | null = null;

// Which models exist changes often (previews retire, new families ship), so ask
// the API what this key can use instead of hardcoding a list.
export const listAvailableModels = async (): Promise<AvailableModels> => {
  if (modelsCache) return modelsCache;
  try {
    const ai = getAIClient();
    const chat: ModelOption[] = [];
    const voice: ModelOption[] = [];
    const pager = await ai.models.list();
    for await (const model of pager) {
      const id = (model.name || '').replace(/^models\//, '');
      if (!id.startsWith('gemini')) continue;
      const actions = model.supportedActions || [];
      const option = { id, label: model.displayName || id };
      // Chat picker: text generators, excluding special-purpose variants
      if (actions.includes('generateContent') && !/(image|tts|audio|live|embedding)/.test(id)) {
        chat.push(option);
      }
      // Voice picker: Live API (bidirectional streaming) models
      if (actions.includes('bidiGenerateContent')) {
        voice.push(option);
      }
    }
    if (chat.length === 0 && voice.length === 0) throw new Error('No models returned');
    const ensure = (list: ModelOption[], fallback: ModelOption) => {
      if (!list.some(m => m.id === fallback.id)) list.unshift(fallback);
    };
    ensure(chat, FALLBACK_MODELS.chat[0]);
    ensure(voice, FALLBACK_MODELS.voice[0]);
    modelsCache = { chat, voice };
    return modelsCache;
  } catch (error) {
    console.error('Could not list models:', error);
    return FALLBACK_MODELS;
  }
};

export const getApiKey = (): string => {
  try {
    const stored = localStorage.getItem(API_KEY_STORAGE);
    if (stored) return stored;
  } catch {
    // localStorage unavailable (private mode etc.) — fall through to env key
  }
  return process.env.API_KEY || '';
};

export const saveApiKey = (key: string): void => {
  try {
    if (key) {
      localStorage.setItem(API_KEY_STORAGE, key);
    } else {
      localStorage.removeItem(API_KEY_STORAGE);
    }
  } catch {
    // localStorage unavailable — key will only last for this page load via env
  }
};

export const hasApiKey = (): boolean => !!getApiKey();

export class MissingApiKeyError extends Error {
  constructor() {
    super('No Gemini API key set. Get a free key at aistudio.google.com/apikey and add it via the key button, or set GEMINI_API_KEY in .env.local.');
    this.name = 'MissingApiKeyError';
  }
}

const getAIClient = () => {
  const apiKey = getApiKey();
  if (!apiKey) throw new MissingApiKeyError();
  return new GoogleGenAI({ apiKey });
};

const getSafetySettings = (spicy: boolean): SafetySetting[] | undefined => {
  if (!spicy) return undefined;
  return [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  ];
};

// Messages → SDK history (user/model turns only; system notices aren't part of
// the model conversation). Lets a rebuilt chat keep its context.
export const messagesToHistory = (messages: Message[]): Content[] =>
  messages
    .filter(m => (m.role === 'user' || m.role === 'model') && m.text.trim())
    .map(m => ({ role: m.role as 'user' | 'model', parts: [{ text: m.text }] }));

export const startTextChat = (character: Character, history?: Content[]): Chat => {
  const ai = getAIClient();

  return ai.chats.create({
    model: getTextModel(),
    config: {
      systemInstruction: buildSystemPrompt(character),
      temperature: 0.9,
      topP: 0.95,
      safetySettings: getSafetySettings(character.spicyMode),
    },
    history,
  });
};

export const summarizeMemory = async (character: Character, history: Message[]): Promise<string> => {
  try {
    const ai = getAIClient();
    const chatHistory = history.map(m => `${m.role === 'user' ? 'User' : m.role === 'system' ? 'System' : character.name}: ${m.text}`).join('\n');
    
    const prompt = `
      Current Memory: "${character.memory || 'None'}"
      
      New Conversation History:
      ${chatHistory}
      
      Based on the new conversation history and the current memory, generate a concise updated memory summary. 
      Focus on:
      1. Facts about the user (name, job, likes, dislikes).
      2. Key emotional events or topics discussed.
      3. Evolution of the relationship.
      
      Keep the summary under 500 characters. Preserve important context from the old memory while incorporating new insights.
      Write it from the perspective of ${character.name}.
    `.trim();

    const response = await ai.models.generateContent({
      model: getTextModel(),
      contents: prompt,
      config: {
        safetySettings: getSafetySettings(character.spicyMode),
      },
    });

    return response.text || character.memory;
  } catch (error) {
    console.error("Memory summarization failed:", error);
    return character.memory;
  }
};

export const analyzeRelationship = async (character: Character, history: Message[]): Promise<{ bondLevel: number, bondStatus: string }> => {
  try {
    const ai = getAIClient();
    const chatHistory = history.slice(-10).map(m => `${m.role === 'user' ? 'User' : m.role === 'system' ? 'System' : character.name}: ${m.text}`).join('\n');
    
    const response = await ai.models.generateContent({
      model: getTextModel(),
      contents: `
        Character: ${character.name}
        Current Bond Level: ${character.bondLevel} (0-100)
        Current Status: ${character.bondStatus}
        
        Recent History:
        ${chatHistory}
        
        Analyze the recent interaction. How has the relationship changed?
        Provide the NEW Bond Level (adjust by -5 to +10 based on the quality of interaction) and a NEW short Emotional Status (2-3 words).
        Return ONLY a JSON object with keys "bondLevel" and "bondStatus".
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            bondLevel: { type: Type.NUMBER },
            bondStatus: { type: Type.STRING }
          },
          required: ["bondLevel", "bondStatus"]
        },
        safetySettings: getSafetySettings(character.spicyMode),
      },
    });

    const result = JSON.parse(response.text || '{}');
    return {
      bondLevel: Math.max(0, Math.min(100, result.bondLevel ?? character.bondLevel)),
      bondStatus: result.bondStatus || character.bondStatus
    };
  } catch (error) {
    console.error("Relationship analysis failed:", error);
    return { bondLevel: character.bondLevel, bondStatus: character.bondStatus };
  }
};

// Generated portraits are 1-2MB PNGs; avatars are saved in localStorage (~5MB
// on Safari), so shrink them to a small JPEG before they are stored.
const shrinkImage = (dataUrl: string, maxSize = 512): Promise<string> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });

export const generateCharacterImage = async (prompt: string): Promise<string | null> => {
  // Free-tier model first; Imagen needs a billing-enabled project, so it is
  // only tried as a fallback for keys that have access to it.
  try {
    const ai = getAIClient();
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL_FREE,
      contents: {
        parts: [{ text: `High quality character portrait: ${prompt}, vibrant colors, detailed features, cinematic lighting` }],
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData?.data) {
        return shrinkImage(`data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`);
      }
    }
    throw new Error('No image returned');
  } catch (error) {
    console.error("Image generation failed:", error);
    try {
      const ai = getAIClient();
      const response = await ai.models.generateImages({
        model: IMAGE_MODEL_PREMIUM,
        prompt: `High quality character portrait: ${prompt}, vibrant colors, detailed features, cinematic lighting, 8k resolution, photorealistic`,
        config: {
          numberOfImages: 1,
          aspectRatio: '1:1',
        }
      });

      const base64EncodeString = response.generatedImages?.[0]?.image?.imageBytes;
      if (base64EncodeString) {
        return shrinkImage(`data:image/png;base64,${base64EncodeString}`);
      }
    } catch (innerError) {
      console.error("Fallback image generation also failed:", innerError);
    }
    return null;
  }
};

export interface VideoProgress {
  step: number;        // 1-based current pipeline step
  totalSteps: number;  // 4
  label: string;       // what is actually happening right now
}

export const generateVideo = async (
  character: Character,
  history: Message[],
  cameraFrameBase64?: string | null,
  onProgress?: (p: VideoProgress) => void,
): Promise<string | null> => {
  const ai = getAIClient();
  const report = (step: number, label: string) => onProgress?.({ step, totalSteps: 4, label });

  try {
    report(1, 'Writing scene prompt');
    const recentChat = history.map(m => {
      const speaker = m.role === 'user' ? 'User' : m.role === 'system' ? 'System' : character.name;
      return `${speaker}: ${m.text}`;
    }).join('\n');

    const promptEngineeringRequest = `
      You are a cinematic director and Veo prompt engineer.
      Create a vivid, high-fidelity 720p video prompt for the following character and scene:
      
      CHARACTER: ${character.name}
      APPEARANCE: ${character.appearance.hairColor} ${character.appearance.hairStyle} hair, ${character.appearance.eyeColor} eyes, wearing ${character.appearance.clothingStyle}.
      MOOD/STATUS: ${character.bondStatus} (${character.voiceSettings.emotion})
      PERSONALITY: ${character.personality}
      BOND LEVEL: ${character.bondLevel}/100
      NUANCED DYNAMICS: ${character.nuancedDynamics || "Developing connection"}
      RECENT CONVERSATIONAL CONTEXT:
      ${recentChat}

      OUTPUT ONLY THE VEO PROMPT. 
      Focus on emotionally resonant details based on the relationship dynamics and recent chat.
      - Lighting (moody, golden hour, cinematic shadows, neon glows if applicable)
      - Subtle actions (tilting head, shy smile, intense gaze, specific movements)
      - Atmospheric environment
      - High fidelity details (micro-expressions, sweat, fabric texture, cinematic depth of field)
      Limit to 800 characters.
    `;

    const promptResponse = await ai.models.generateContent({
      model: getTextModel(),
      contents: promptEngineeringRequest,
      config: {
        safetySettings: getSafetySettings(character.spicyMode),
      },
    });

    const refinedPrompt = promptResponse.text || `Cinematic shot of ${character.name}, looking emotionally at the camera.`;

    report(2, 'Submitting to Veo');
    let operation;
    if (cameraFrameBase64) {
      operation = await ai.models.generateVideos({
        model: VIDEO_MODEL,
        prompt: refinedPrompt,
        image: {
          imageBytes: cameraFrameBase64.split(',')[1] || cameraFrameBase64,
          mimeType: 'image/jpeg'
        },
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });
    } else {
      operation = await ai.models.generateVideos({
        model: VIDEO_MODEL,
        prompt: refinedPrompt,
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });
    }

    const renderStart = Date.now();
    let poll = 0;
    while (!operation.done) {
      poll += 1;
      report(3, `Rendering — ${Math.round((Date.now() - renderStart) / 1000)}s (check #${poll})`);
      await new Promise(resolve => setTimeout(resolve, 10000));
      operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) return null;

    report(4, 'Downloading video');
    const response = await fetch(`${downloadLink}&key=${getApiKey()}`);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    throw error;
  }
};

let playbackContext: AudioContext | null = null;

// iOS only lets a page start audio from a user tap, and a context created after
// an awaited network call stays silent. Call this synchronously from the tap.
const getPlaybackContext = (): AudioContext => {
  if (!playbackContext || playbackContext.state === 'closed') {
    playbackContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (playbackContext.state !== 'running') {
    playbackContext.resume().catch(() => undefined);
  }
  return playbackContext;
};

// iOS 17+: 'playback' lets speech play even when the ringer switch is on silent;
// 'auto' hands control back to Safari (needed before using the microphone).
export const setAudioSessionType = (type: 'auto' | 'playback'): void => {
  const session = (navigator as any).audioSession;
  if (!session) return;
  try {
    session.type = type;
  } catch {
    // Older WebKit without this session type
  }
};

export type TtsStage = 'request' | 'generate' | 'decode' | 'play' | 'done' | 'error';

export const TTS_STAGES: { stage: TtsStage; step: number; label: string }[] = [
  { stage: 'request', step: 1, label: 'Preparing request' },
  { stage: 'generate', step: 2, label: 'Generating speech' },
  { stage: 'decode', step: 3, label: 'Decoding audio' },
  { stage: 'play', step: 4, label: 'Playing' },
];

export const speakText = async (
  text: string,
  character: Character,
  onProgress?: (stage: TtsStage) => void,
): Promise<void> => {
  setAudioSessionType('playback');
  const audioContext = getPlaybackContext();
  try {
    onProgress?.('request');
    const ai = getAIClient();
    const prompt = `[Mood: ${character.voiceSettings.emotion}, Character: ${character.name}, Bond: ${character.bondStatus}] Speak the following: ${text}`;

    onProgress?.('generate');
    const response = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: character.voiceName },
          },
        },
        safetySettings: getSafetySettings(character.spicyMode),
      },
    });

    // Audio may not be the first part of the response
    const base64Audio = response.candidates?.[0]?.content?.parts
      ?.find(p => p.inlineData?.data)?.inlineData?.data;
    if (!base64Audio) {
      throw new Error('No audio returned — the model may have declined this text.');
    }
    onProgress?.('decode');
    const audioBuffer = await decodeAudioData(
      decodePCM(base64Audio),
      audioContext,
      24000,
      1
    );
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = character.voiceSettings.rate || 1.0;
    source.detune.value = (character.voiceSettings.pitch - 1.0) * 1200;
    source.connect(audioContext.destination);
    onProgress?.('play');
    await new Promise<void>(resolve => {
      source.onended = () => resolve();
      // 'ended' never fires if iOS keeps the context suspended; don't leave the UI stuck
      setTimeout(resolve, (audioBuffer.duration / source.playbackRate.value) * 1000 + 1000);
      source.start();
    });
    onProgress?.('done');
  } catch (error) {
    console.error("TTS generation failed:", error);
    onProgress?.('error');
    throw error;
  }
};

export function encodePCM(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decodePCM(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}
