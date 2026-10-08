
export enum Relationship {
  STRANGER = 'Stranger',
  FRIEND = 'Friend',
  PARTNER = 'Partner',
  RIVAL = 'Rival',
  SUBORDINATE = 'Subordinate',
  SUPERIOR = 'Superior',
  WIFE = 'Wife',
  WIFES_FRIEND = "Wife's Friend"
}

export interface Appearance {
  hairColor: string;
  hairStyle: string;
  eyeColor: string;
  bodyType: string;
  clothingStyle: string;
  skinTone: string;
}

export interface VoiceSettings {
  pitch: number; // 0.5 to 1.5
  rate: number;  // 0.5 to 1.5
  emotion: string; // e.g., 'Sultry', 'Cheerful', 'Neutral'
}

export interface AdvancedTraits {
  tenderness: number;    // 0-100
  dominance: number;     // 0-100
  curiosity: number;     // 0-100
  rebelliousness: number; // 0-100
  empathy: number;       // 0-100
  wit: number;           // 0-100
}

export interface Character {
  id: string;
  name: string;
  age: string;
  personality: string;
  description: string;
  relationship: Relationship;
  avatarUrl?: string;
  voiceName: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
  systemInstruction: string;
  initialGreeting?: string;
  spicyMode: boolean;
  appearance: Appearance;
  memory: string; 
  voiceSettings: VoiceSettings;
  bondLevel: number; 
  bondStatus: string; 
  advancedTraits: AdvancedTraits;
  behavioralTriggers: string;
  nuancedDynamics: string;
  popularity?: number;
  createdAt?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: number;
}
