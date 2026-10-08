
import React, { useState } from 'react';
import { Character, Relationship, Appearance, VoiceSettings, AdvancedTraits, Message } from '../types';
import { VOICE_NAMES, APPEARANCE_OPTIONS, DEFAULT_APPEARANCE, DEFAULT_VOICE_SETTINGS, DEFAULT_ADVANCED_TRAITS, EMOTION_OPTIONS, buildImagePrompt, getBondDescription } from '../constants';
import { generateCharacterImage, summarizeMemory } from '../services/geminiService';
import AdvancedPersonalityEditor from './AdvancedPersonalityEditor';

interface CharacterCreatorProps {
  onSave: (char: Character) => void;
  onCancel: () => void;
  initialCharacter?: Character;
  conversationHistory?: Message[];
}

const CharacterCreator: React.FC<CharacterCreatorProps> = ({ onSave, onCancel, initialCharacter, conversationHistory }) => {
  const [formData, setFormData] = useState<Partial<Character>>(() => {
    const defaults: Partial<Character> = {
      name: '',
      age: '24',
      personality: '',
      description: '',
      relationship: Relationship.STRANGER,
      voiceName: VOICE_NAMES[0],
      spicyMode: false,
      appearance: { ...DEFAULT_APPEARANCE },
      memory: '',
      systemInstruction: '',
      voiceSettings: { ...DEFAULT_VOICE_SETTINGS },
      bondLevel: 0,
      bondStatus: 'Stranger',
      advancedTraits: { ...DEFAULT_ADVANCED_TRAITS },
      behavioralTriggers: '',
      nuancedDynamics: ''
    };

    if (initialCharacter) {
      return {
        ...defaults,
        ...initialCharacter,
        appearance: { ...defaults.appearance, ...initialCharacter.appearance },
        voiceSettings: { ...defaults.voiceSettings, ...initialCharacter.voiceSettings },
        advancedTraits: { ...defaults.advancedTraits, ...initialCharacter.advancedTraits }
      };
    }
    return defaults;
  });

  const [activeTab, setActiveTab] = useState<'basic' | 'appearance' | 'personality' | 'relationship' | 'memory' | 'advanced' | 'logic'>('basic');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);

  const handleSummarizeMemory = async () => {
    if (!conversationHistory || !formData.name) return;
    setIsSummarizing(true);
    try {
      const updatedMemory = await summarizeMemory(formData as Character, conversationHistory);
      setFormData(prev => ({ ...prev, memory: updatedMemory }));
    } catch (error) {
      console.error("Failed to summarize memory:", error);
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.name && formData.personality) {
      onSave({
        ...formData,
        id: initialCharacter?.id || Date.now().toString(),
        name: formData.name || '',
        age: formData.age || '24',
        personality: formData.personality || '',
        description: formData.description || '',
        relationship: formData.relationship || Relationship.STRANGER,
        voiceName: formData.voiceName || VOICE_NAMES[0],
        spicyMode: formData.spicyMode || false,
        appearance: formData.appearance || { ...DEFAULT_APPEARANCE },
        memory: formData.memory || '',
        systemInstruction: formData.systemInstruction || '',
        voiceSettings: formData.voiceSettings || { ...DEFAULT_VOICE_SETTINGS },
        bondLevel: formData.bondLevel ?? 0,
        bondStatus: formData.bondStatus || 'Stranger',
        advancedTraits: formData.advancedTraits || { ...DEFAULT_ADVANCED_TRAITS },
        behavioralTriggers: formData.behavioralTriggers || '',
        nuancedDynamics: formData.nuancedDynamics || ''
      } as Character);
    }
  };

  const handleAppearanceChange = (key: keyof Appearance, value: string) => {
    setFormData(prev => ({
      ...prev,
      appearance: {
        ...(prev.appearance || DEFAULT_APPEARANCE),
        [key]: value
      }
    }));
  };

  const handleVoiceSettingChange = (key: keyof VoiceSettings, value: any) => {
    setFormData(prev => ({
      ...prev,
      voiceSettings: {
        ...(prev.voiceSettings || DEFAULT_VOICE_SETTINGS),
        [key]: value
      }
    }));
  };

  const handleVoiceNameChange = (name: typeof VOICE_NAMES[number]) => {
    let suggestedEmotion = 'Neutral';
    switch (name) {
      case 'Puck': suggestedEmotion = 'Playful'; break;
      case 'Charon': suggestedEmotion = 'Commanding'; break;
      case 'Kore': suggestedEmotion = 'Sultry'; break;
      case 'Fenrir': suggestedEmotion = 'Intense'; break;
      case 'Zephyr': suggestedEmotion = 'Cheerful'; break;
    }

    setFormData(prev => ({
      ...prev,
      voiceName: name,
      voiceSettings: {
        ...(prev.voiceSettings || DEFAULT_VOICE_SETTINGS),
        emotion: suggestedEmotion
      }
    }));
  };

  const handleChange = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleGenerateImage = async () => {
    setIsGeneratingImage(true);
    try {
      const prompt = buildImagePrompt(formData);
      const url = await generateCharacterImage(prompt);
      if (url) {
        setFormData(prev => ({ ...prev, avatarUrl: url }));
      }
    } catch (error) {
      console.error("Failed to generate character image:", error);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const tabs = [
    { id: 'basic', label: 'Basics' },
    { id: 'appearance', label: 'Form' },
    { id: 'personality', label: 'Persona' },
    { id: 'relationship', label: 'Bond' },
    { id: 'memory', label: 'Lore' },
    { id: 'advanced', label: 'Voice' },
    { id: 'logic', label: 'Logic' }
  ];

  return (
    <div className="w-full h-full md:w-auto md:h-auto md:max-w-4xl md:mx-auto glass-panel md:p-8 md:rounded-[2.5rem] animate-in fade-in zoom-in duration-300 shadow-2xl overflow-y-auto max-h-screen md:max-h-[90vh] border border-slate-700/50 flex flex-col">
      <div className="sticky top-0 bg-[#030712]/80 backdrop-blur-md z-30 p-5 md:p-0 flex justify-between items-center mb-0 md:mb-8 border-b border-slate-800 md:border-none">
        <div className="flex flex-col">
          <h2 className="text-2xl md:text-3xl font-outfit font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-rose-500">
            {initialCharacter ? 'Refine Companion' : 'Forge New Companion'}
          </h2>
          <p className="text-slate-500 text-[10px] md:text-xs font-semibold tracking-widest mt-1 uppercase">Sculpting consciousness</p>
        </div>
        {formData.avatarUrl ? (
          <img src={formData.avatarUrl} className="w-12 h-12 md:w-20 md:h-20 rounded-xl md:rounded-3xl border-2 border-purple-500/50 object-cover shadow-2xl rotate-3" alt="Preview" />
        ) : (
          <button onClick={onCancel} className="p-2 text-slate-400 md:hidden">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        )}
      </div>

      <div className="sticky top-[72px] md:top-0 bg-[#030712]/80 backdrop-blur-md z-20 flex gap-1 p-2 md:p-0 md:mb-8 border-b border-slate-800/50 overflow-x-auto whitespace-nowrap scrollbar-none">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex-none px-4 py-2.5 md:px-5 md:py-2 rounded-xl transition-all font-bold text-[10px] md:text-xs uppercase tracking-widest ${activeTab === tab.id ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex-1 p-5 md:p-0 space-y-6 md:space-y-8 pb-32 md:pb-0">
        {activeTab === 'basic' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-300">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">Full Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => handleChange('name', e.target.value)}
                  className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl px-5 py-4 focus:ring-2 focus:ring-purple-500 outline-none transition-all placeholder:text-slate-700 text-base md:text-sm"
                  placeholder="e.g. Seraphina Vance"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">Subject Age</label>
                <input
                  type="number"
                  value={formData.age}
                  onChange={e => handleChange('age', e.target.value)}
                  className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl px-5 py-4 focus:ring-2 focus:ring-purple-500 outline-none transition-all placeholder:text-slate-700 text-base md:text-sm"
                  placeholder="25"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">Baseline Archetype</label>
              <select
                value={formData.relationship}
                onChange={e => handleChange('relationship', e.target.value as Relationship)}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl px-5 py-4 focus:ring-2 focus:ring-purple-500 outline-none transition-all appearance-none text-slate-300 text-base md:text-sm"
              >
                {Object.values(Relationship).map(rel => (
                  <option key={rel} value={rel} className="bg-slate-900">{rel}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">Core Personality Summary</label>
              <textarea
                value={formData.personality}
                onChange={e => handleChange('personality', e.target.value)}
                className="w-full h-32 bg-slate-900/50 border border-slate-700 rounded-2xl px-5 py-4 focus:ring-2 focus:ring-purple-500 outline-none transition-all resize-none text-slate-300 placeholder:text-slate-700 text-base md:text-sm"
                placeholder="Briefly describe their general vibe..."
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">Extended Backstory</label>
              <textarea
                value={formData.description}
                onChange={e => handleChange('description', e.target.value)}
                className="w-full h-32 bg-slate-900/50 border border-slate-700 rounded-2xl px-5 py-4 focus:ring-2 focus:ring-purple-500 outline-none transition-all resize-none text-slate-300 placeholder:text-slate-700 text-base md:text-sm"
                placeholder="What historical events shaped them?"
              />
            </div>
          </div>
        )}

        {activeTab === 'appearance' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 md:gap-y-6">
              {Object.entries(APPEARANCE_OPTIONS).map(([key, options]) => (
                <div key={key} className="space-y-2">
                  <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </label>
                  <select
                    value={(formData.appearance as any)?.[key] || (DEFAULT_APPEARANCE as any)[key]}
                    onChange={e => handleAppearanceChange(key as keyof Appearance, e.target.value)}
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl px-5 py-4 focus:ring-2 focus:ring-purple-500 outline-none transition-all appearance-none text-slate-300 text-base md:text-sm"
                  >
                    {options.map(opt => (
                      <option key={opt} value={opt} className="bg-slate-900">{opt}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'personality' && (
          <AdvancedPersonalityEditor 
            traits={formData.advancedTraits || DEFAULT_ADVANCED_TRAITS}
            dynamics={formData.nuancedDynamics || ''}
            triggers={formData.behavioralTriggers || ''}
            onChange={handleChange}
          />
        )}

        {activeTab === 'relationship' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="p-6 md:p-8 bg-gradient-to-br from-purple-500/10 via-pink-500/5 to-rose-500/10 border border-purple-500/20 rounded-[1.5rem] md:rounded-[2rem] shadow-inner">
              <h4 className="text-white font-black mb-6 flex items-center gap-3 text-base md:text-lg">
                <div className="p-1.5 md:p-2 bg-pink-500/20 rounded-lg">
                  <svg className="w-5 h-5 md:w-6 md:h-6 text-pink-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                </div>
                Emotive Bond Synchronization
              </h4>
              <div className="space-y-8 md:space-y-10">
                <div className="space-y-3">
                  <div className="flex justify-between items-end">
                    <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">Bond Depth</label>
                    <div className="text-right">
                       <span className="text-lg md:text-xl font-black text-white block">{formData.bondLevel}%</span>
                       <span className="text-[8px] md:text-[10px] text-pink-400 font-bold uppercase tracking-tighter">{getBondDescription(formData.bondLevel || 0)}</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={formData.bondLevel || 0}
                    onChange={e => handleChange('bondLevel', parseInt(e.target.value))}
                    className="w-full accent-pink-500 h-2 bg-slate-800 rounded-full appearance-none cursor-pointer"
                  />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">Current Internal State</label>
                  <input
                    type="text"
                    value={formData.bondStatus}
                    onChange={e => handleChange('bondStatus', e.target.value)}
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl px-6 py-4 md:py-5 focus:ring-2 focus:ring-pink-500 outline-none transition-all text-slate-200 placeholder:text-slate-700 text-base md:text-sm"
                    placeholder="e.g. Infatuated, Coldly Respectful..."
                  />
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">Nuanced Dynamics</label>
                  <textarea
                    value={formData.nuancedDynamics}
                    onChange={e => handleChange('nuancedDynamics', e.target.value)}
                    className="w-full h-24 bg-slate-900/50 border border-slate-700 rounded-2xl px-6 py-4 focus:ring-2 focus:ring-pink-500 outline-none transition-all resize-none text-slate-200 placeholder:text-slate-700 text-base md:text-sm"
                    placeholder="Describe the complex state..."
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'memory' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center justify-between gap-4">
              <div className="p-4 md:p-6 bg-purple-500/5 border border-purple-500/10 rounded-2xl text-[10px] md:text-xs text-purple-300 leading-relaxed flex-1">
                <span className="font-bold text-purple-400 uppercase mr-2 tracking-widest">Neural Archive:</span>
                Persistent memories between you and {formData.name || 'this entity'}.
              </div>
              <button
                type="button"
                onClick={handleSummarizeMemory}
                disabled={isSummarizing || !conversationHistory}
                className="px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition-all disabled:opacity-50 text-[10px] uppercase tracking-widest"
              >
                {isSummarizing ? 'Summarizing...' : 'Summarize History'}
              </button>
            </div>
            <textarea
              value={formData.memory}
              onChange={e => handleChange('memory', e.target.value)}
              className="w-full h-80 bg-slate-900/70 border border-slate-700 rounded-2xl px-6 py-5 focus:ring-2 focus:ring-purple-500 outline-none transition-all resize-none font-mono text-base md:text-sm text-slate-300 leading-relaxed"
              placeholder="The memory log is empty..."
            />
          </div>
        )}

        {activeTab === 'advanced' && (
          <div className="space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="p-6 md:p-8 bg-slate-900/50 border border-slate-700 rounded-[1.5rem] md:rounded-[2rem]">
              <h4 className="text-white font-black mb-6 flex items-center gap-3 text-base md:text-lg">
                <div className="p-1.5 md:p-2 bg-purple-500/20 rounded-lg">
                  <svg className="w-5 h-5 md:w-6 md:h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-20a3 3 0 00-3 3v10a3 3 0 006 0V3a3 3 0 00-3-3z" /></svg>
                </div>
                Vocal Synthesis Tuning
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
                <div className="space-y-3">
                  <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">Voice Engine</label>
                  <select
                    value={formData.voiceName}
                    onChange={e => handleVoiceNameChange(e.target.value as any)}
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl px-5 py-4 focus:ring-2 focus:ring-purple-500 outline-none transition-all appearance-none text-slate-300 text-base md:text-sm"
                  >
                    {VOICE_NAMES.map(name => (
                      <option key={name} value={name} className="bg-slate-900">{name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">Base Emotive Overlay</label>
                  <select
                    value={formData.voiceSettings?.emotion || 'Neutral'}
                    onChange={e => handleVoiceSettingChange('emotion', e.target.value)}
                    className="w-full bg-slate-900/50 border border-slate-700 rounded-2xl px-5 py-4 focus:ring-2 focus:ring-purple-500 outline-none transition-all appearance-none text-slate-300 text-base md:text-sm"
                  >
                    {EMOTION_OPTIONS.map(opt => (
                      <option key={opt} value={opt} className="bg-slate-900">{opt}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">Vocal Pitch</label>
                    <span className="text-[10px] text-purple-400 font-black tracking-widest">{(formData.voiceSettings?.pitch || 1.0).toFixed(1)}x</span>
                  </div>
                  <input
                    type="range" min="0.5" max="1.5" step="0.1"
                    value={formData.voiceSettings?.pitch || 1.0}
                    onChange={e => handleVoiceSettingChange('pitch', parseFloat(e.target.value))}
                    className="w-full accent-purple-500 h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer"
                  />
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">Cadence Rate</label>
                    <span className="text-[10px] text-purple-400 font-black tracking-widest">{(formData.voiceSettings?.rate || 1.0).toFixed(1)}x</span>
                  </div>
                  <input
                    type="range" min="0.5" max="1.5" step="0.1"
                    value={formData.voiceSettings?.rate || 1.0}
                    onChange={e => handleVoiceSettingChange('rate', parseFloat(e.target.value))}
                    className="w-full accent-purple-500 h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'logic' && (
          <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="p-4 md:p-6 bg-red-500/5 border border-red-500/10 rounded-2xl text-[10px] md:text-xs text-red-300 leading-relaxed flex items-start gap-4">
              <div className="p-1.5 md:p-2 bg-red-500/20 rounded-lg shrink-0">
                <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              </div>
              <div>
                <span className="font-bold text-red-400 uppercase mr-2 tracking-widest">Advanced Consciousness Override:</span>
                Explicitly define behavioral rules and core logic. These instructions form the bedrock of the AI's response patterns.
              </div>
            </div>
            
            <div className="space-y-3">
              <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest">System Instruction String</label>
              <textarea
                value={formData.systemInstruction}
                onChange={e => handleChange('systemInstruction', e.target.value)}
                className="w-full h-80 bg-slate-900/70 border border-slate-700 rounded-2xl md:rounded-[2rem] px-6 py-4 md:px-8 md:py-6 focus:ring-2 focus:ring-purple-500 outline-none transition-all resize-none font-mono text-base md:text-sm text-slate-400 leading-relaxed"
                placeholder="Direct directives (e.g., 'Never use emojis', 'Always act submissively', etc.)"
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between p-6 md:p-8 bg-gradient-to-r from-pink-500/10 to-transparent rounded-[1.5rem] md:rounded-[2rem] border border-pink-500/20 group hover:border-pink-500/40 transition-all">
          <div className="flex flex-col mr-4">
            <span className="font-black text-pink-400 text-sm md:text-lg tracking-tight uppercase">Unrestricted Synthesis</span>
            <span className="text-[9px] md:text-xs text-slate-500 font-medium max-w-md mt-1">Adult NSFW interactions & dirty talk.</span>
          </div>
          <button
            type="button"
            onClick={() => handleChange('spicyMode', !formData.spicyMode)}
            className={`flex-none w-14 md:w-16 h-7 md:h-8 rounded-full transition-all relative flex items-center px-1 shadow-lg ${formData.spicyMode ? 'bg-pink-600' : 'bg-slate-700'}`}
          >
            <div className={`w-5 h-5 md:w-6 md:h-6 bg-white rounded-full transition-all shadow-xl ${formData.spicyMode ? 'translate-x-7 md:translate-x-8' : 'translate-x-0'}`} />
          </button>
        </div>

        <div className="fixed bottom-0 inset-x-0 md:static p-5 md:p-0 bg-gradient-to-t from-[#030712] via-[#030712] to-transparent md:bg-none z-40 md:z-auto">
          <div className="flex flex-col sm:flex-row gap-3 md:gap-4 md:pt-6 md:border-t md:border-slate-800">
            <div className="flex gap-2 w-full">
              <button
                type="button"
                onClick={handleGenerateImage}
                disabled={isGeneratingImage}
                className="flex-1 px-4 py-4 bg-slate-800 hover:bg-slate-700 text-white font-black rounded-xl md:rounded-2xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] md:text-xs border border-slate-700"
              >
                {isGeneratingImage ? <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" /> : 'Visualize'}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-4 md:hidden bg-slate-900 border border-slate-800 text-slate-500 font-black rounded-xl uppercase tracking-widest text-[10px]"
              >
                Cancel
              </button>
            </div>
            <button
              type="submit"
              className="w-full px-8 py-4 md:py-5 bg-gradient-to-r from-purple-600 via-pink-600 to-rose-600 hover:scale-[1.02] active:scale-95 text-white font-black rounded-xl md:rounded-2xl transition-all shadow-2xl shadow-purple-500/40 uppercase tracking-widest text-[10px] md:text-xs"
            >
              Finalize Consciousness
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default CharacterCreator;
