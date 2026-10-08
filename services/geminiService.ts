
import { GoogleGenAI, GenerateContentResponse, Chat, Modality, Type } from "@google/genai";
import { Character, Message } from "../types";
import { buildSystemPrompt } from "../constants";

const getAIClient = () => new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

const getSafetySettings = (spicy: boolean) => {
  if (!spicy) return undefined;
  return [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  ];
};

export const startTextChat = (character: Character): Chat => {
  const ai = getAIClient();
  const safetySettings = getSafetySettings(character.spicyMode);

  return ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: {
      systemInstruction: buildSystemPrompt(character),
      temperature: 0.9,
      topP: 0.95,
    },
    safetySettings,
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
      model: 'gemini-3-flash-preview',
      contents: prompt,
      safetySettings: getSafetySettings(character.spicyMode),
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
      model: 'gemini-3-flash-preview',
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
        }
      },
      safetySettings: getSafetySettings(character.spicyMode),
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

export const generateCharacterImage = async (prompt: string): Promise<string | null> => {
  try {
    const ai = getAIClient();
    const response = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt: `High quality character portrait: ${prompt}, vibrant colors, detailed features, cinematic lighting, 8k resolution, photorealistic`,
      config: {
        numberOfImages: 1,
        aspectRatio: '1:1',
      }
    });

    const base64EncodeString: string = response.generatedImages[0].image.imageBytes;
    return `data:image/png;base64,${base64EncodeString}`;
  } catch (error) {
    console.error("Image generation failed:", error);
    // Fallback to flash image if Imagen fails (e.g. key permissions)
    try {
      const ai = getAIClient();
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: `High quality character portrait: ${prompt}, vibrant colors, detailed features, cinematic lighting` }],
        },
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    } catch (innerError) {
      console.error("Fallback image generation also failed:", innerError);
    }
    return null;
  }
};

export const generateVideo = async (character: Character, history: Message[], cameraFrameBase64?: string | null): Promise<string | null> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  
  try {
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
      model: 'gemini-3-flash-preview',
      contents: promptEngineeringRequest,
      safetySettings: getSafetySettings(character.spicyMode),
    });

    const refinedPrompt = promptResponse.text || `Cinematic shot of ${character.name}, looking emotionally at the camera.`;

    let operation;
    if (cameraFrameBase64) {
      operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
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
        model: 'veo-3.1-fast-generate-preview',
        prompt: refinedPrompt,
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });
    }

    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) return null;

    const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    throw error;
  }
};

export const speakText = async (text: string, character: Character): Promise<void> => {
  try {
    const ai = getAIClient();
    const prompt = `[Mood: ${character.voiceSettings.emotion}, Character: ${character.name}, Bond: ${character.bondStatus}] Speak the following: ${text}`;
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: character.voiceName },
          },
        },
      },
      safetySettings: getSafetySettings(character.spicyMode),
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
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
      source.start();
      source.onended = () => {
        setTimeout(() => audioContext.close(), 1000);
      };
    }
  } catch (error) {
    console.error("TTS generation failed:", error);
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
