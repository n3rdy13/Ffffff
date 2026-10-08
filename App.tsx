
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Character, Message, Relationship } from './types';
import { DEFAULT_CHARACTERS, DISCOVER_CHARACTERS, getBondDescription } from './constants';
import CharacterCreator from './components/CharacterCreator';
import VoiceInterface from './components/VoiceInterface';
import { startTextChat, summarizeMemory, analyzeRelationship, generateVideo, speakText, hasApiKey, saveApiKey, messagesToHistory, getTextModel, setTextModel, listAvailableModels, ModelOption, TtsStage, TTS_STAGES, VideoProgress } from './services/geminiService';

interface SavedChat {
  id: string;
  characterName: string;
  characterAvatar?: string;
  messages: Message[];
  timestamp: number;
  bondStatus: string;
}

const loadStored = <T,>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch (error) {
    console.error(`Could not read ${key}:`, error);
    return fallback;
  }
};

// SDK errors often carry a raw JSON body; show the human message inside it.
const humanizeError = (raw: string): string => {
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      const msg = parsed?.error?.message || parsed?.message;
      if (typeof msg === 'string' && msg) return msg;
    } catch {
      // not JSON — fall through to the raw text
    }
  }
  return raw;
};

// Safari caps localStorage at ~5MB; a failed write must not crash the app.
const persist = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Could not save ${key} (storage full?):`, error);
  }
};

const App: React.FC = () => {
  const [characters, setCharacters] = useState<Character[]>(() => loadStored('persona_characters', DEFAULT_CHARACTERS));

  const [savedChats, setSavedChats] = useState<SavedChat[]>(() => loadStored('persona_saved_chats', []));
  
  const [activeCharacter, setActiveCharacter] = useState<Character | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [view, setView] = useState<'my' | 'discover' | 'archives'>('my');

  // Discover Filter & Sort State
  const [discoverSort, setDiscoverSort] = useState<'newest' | 'popular'>('popular');
  const [discoverFilter, setDiscoverFilter] = useState<Relationship | 'All'>('All');

  // TTS State — which message is being spoken, and the real pipeline stage it's in
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [ttsStage, setTtsStage] = useState<TtsStage | null>(null);

  // Response editing
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  // API Key State
  const [showKeyModal, setShowKeyModal] = useState(() => !hasApiKey());
  const [keyInput, setKeyInput] = useState('');

  // Model picker
  const [textModel, setTextModelState] = useState(getTextModel());
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [chatModels, setChatModels] = useState<ModelOption[]>([]);

  // Video Generation States
  const [isVideoGenerating, setIsVideoGenerating] = useState(false);
  const [videoProgress, setVideoProgress] = useState<VideoProgress | null>(null);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [showVideo, setShowVideo] = useState(false);

  // Camera State
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const chatRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    persist('persona_characters', characters);
  }, [characters]);

  useEffect(() => {
    persist('persona_saved_chats', savedChats);
  }, [savedChats]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  useEffect(() => {
    if (!showModelPicker || chatModels.length) return;
    let cancelled = false;
    listAvailableModels().then(models => {
      if (!cancelled) setChatModels(models.chat);
    });
    return () => { cancelled = true; };
  }, [showModelPicker, chatModels.length]);

  // Handle Camera Stream Cleanup
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

  // Release the camera when leaving the chat so the device's camera indicator turns off
  useEffect(() => {
    if (!activeCharacter && cameraStream) {
      setCameraStream(null);
      setIsCameraActive(false);
    }
  }, [activeCharacter]);

  // The preview <video> only mounts after the camera turns on, so attach the stream when it does
  const attachCameraPreview = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && cameraStream) {
      el.srcObject = cameraStream;
    }
  }, [cameraStream]);

  const handleToggleCamera = async () => {
    if (isCameraActive) {
      setCameraStream(null);
      setIsCameraActive(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
        setCameraStream(stream);
        setIsCameraActive(true);
      } catch (err) {
        console.error("Camera access denied:", err);
        alert("Camera access is required for this feature.");
      }
    }
  };

  const initChat = (char: Character, history?: Message[]) => {
    try {
      chatRef.current = startTextChat(char, history ? messagesToHistory(history) : undefined);
    } catch (error) {
      console.error("Could not start chat:", error);
      chatRef.current = null;
      setShowKeyModal(true);
    }
  };

  const handleSelectModel = (modelId: string) => {
    setTextModel(modelId);
    setTextModelState(modelId);
    setShowModelPicker(false);
    // Rebuild the live chat on the new model, keeping the conversation
    if (activeCharacter && chatRef.current) {
      initChat(activeCharacter, messages);
    }
  };

  const handleSaveApiKey = () => {
    const key = keyInput.trim();
    if (!key) return;
    saveApiKey(key);
    setKeyInput('');
    setShowKeyModal(false);
    // Re-initialize the active chat now that a key is available
    if (activeCharacter && !chatRef.current) {
      initChat(activeCharacter);
    }
  };

  const handleSelectCharacter = (char: Character) => {
    setActiveCharacter(char);
    setMessages([]);
    setGeneratedVideoUrl(null);
    initChat(char);

    setMessages([{
      id: 'init',
      role: 'model',
      text: char.initialGreeting || `Hello. It's good to see you. How are you feeling today?`,
      timestamp: Date.now()
    }]);
    setView('my');
  };

  const handleExportChat = () => {
    if (!activeCharacter || messages.length === 0) return;
    
    let content = `PERSONAX CHAT ARCHIVE\n`;
    content += `========================\n`;
    content += `Character: ${activeCharacter.name}\n`;
    content += `Bond Level: ${activeCharacter.bondLevel}% (${getBondDescription(activeCharacter.bondLevel, activeCharacter.bondStatus)})\n`;
    content += `Date: ${new Date().toLocaleString()}\n`;
    content += `========================\n\n`;

    messages.forEach(m => {
      const time = new Date(m.timestamp).toLocaleTimeString();
      const speaker = m.role === 'user' ? 'YOU' : m.role === 'system' ? 'SYSTEM' : activeCharacter.name.toUpperCase();
      content += `[${time}] ${speaker}: ${m.text}\n\n`;
    });

    const fileName = `PersonaX_${activeCharacter.name}_${Date.now()}.txt`;
    const file = new File([content], fileName, { type: 'text/plain' });

    // On phones, downloads from a home-screen web app are unreliable; use the share sheet ("Save to Files")
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
    if (isTouchDevice && navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file], title: `Chat with ${activeCharacter.name}` }).catch(err => {
        if (err?.name !== 'AbortError') console.error('Share failed:', err);
      });
      return;
    }

    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleViewSavedChat = (chat: SavedChat) => {
    setMessages(chat.messages);
    setActiveCharacter({
      id: 'history',
      name: chat.characterName,
      avatarUrl: chat.characterAvatar,
      bondStatus: chat.bondStatus,
      bondLevel: 100,
      spicyMode: false
    } as any);
    chatRef.current = null;
    setView('archives');
  };

  const handleDiscoverAdopt = (char: Character) => {
    const newChar = { ...char, id: Date.now().toString() };
    setCharacters(prev => [...prev, newChar]);
    setView('my');
    handleSelectCharacter(newChar);
  };

  const updateCharacterInList = (updatedChar: Character) => {
    setCharacters(prev => {
        const newList = prev.map(c => c.id === updatedChar.id ? updatedChar : c);
        return newList;
    });
  };

  const handleSendMessage = async (e?: React.FormEvent, customPrompt?: string) => {
    e?.preventDefault();
    const textToSend = customPrompt || inputText;
    if (!textToSend.trim() || !chatRef.current || isTyping || !activeCharacter) return;

    let baseMessages = messages;
    if (!customPrompt) {
        const userMessage: Message = {
          id: Date.now().toString(),
          role: 'user',
          text: textToSend,
          timestamp: Date.now()
        };
        baseMessages = [...messages, userMessage];
        setMessages(baseMessages);
    }

    setInputText('');
    await sendToModel(textToSend, baseMessages);
  };

  // baseMessages = the on-screen conversation at the moment of sending (the
  // user message included), so memory/bond analysis sees the full exchange.
  const sendToModel = async (textToSend: string, baseMessages: Message[]) => {
    if (!activeCharacter || !chatRef.current) return;
    setIsTyping(true);

    try {
      const response = await chatRef.current.sendMessage({ message: textToSend });
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: response.text || "I'm sorry, I couldn't process that.",
        timestamp: Date.now()
      };

      const updatedHistory = [...baseMessages, aiMessage];
      setMessages(prev => [...prev, aiMessage]);

      if (updatedHistory.length > 0 && updatedHistory.length % 6 === 0) {
        Promise.all([
          summarizeMemory(activeCharacter, updatedHistory),
          analyzeRelationship(activeCharacter, updatedHistory)
        ]).then(([newMemory, relData]) => {
          const updatedChar = {
            ...activeCharacter,
            memory: newMemory,
            bondLevel: relData.bondLevel,
            bondStatus: relData.bondStatus
          };
          setActiveCharacter(updatedChar);
          updateCharacterInList(updatedChar);
        });
      }
    } catch (error: any) {
      console.error("Chat Error:", error);
      const errText = humanizeError(error?.message || 'Something went wrong. Please try again.');
      setMessages(prev => [...prev, {
        id: (Date.now() + 2).toString(),
        role: 'system',
        text: errText,
        timestamp: Date.now()
      }]);
      if (/api key/i.test(errText)) {
        setShowKeyModal(true);
      }
    } finally {
      setIsTyping(false);
    }
  };

  // Regenerate the answer to the last user message: drop everything after it,
  // rebuild the chat from the history before it, and re-send the same text
  // (temperature 0.9 gives a different sample).
  const handleRetry = async () => {
    if (!activeCharacter || isTyping) return;
    const userIdx = messages.map(m => m.role).lastIndexOf('user');
    if (userIdx < 0) return;
    const baseMessages = messages.slice(0, userIdx + 1);
    setMessages(baseMessages);
    initChat(activeCharacter, baseMessages.slice(0, userIdx));
    if (!chatRef.current) return;
    await sendToModel(baseMessages[userIdx].text, baseMessages);
  };

  // The last model response (or a trailing error) can be retried, as long as a
  // user message precedes it — never the opening greeting.
  const lastMessage = messages[messages.length - 1];
  const canRetry = !isTyping
    && !!chatRef.current
    && !!lastMessage
    && (lastMessage.role === 'model' || lastMessage.role === 'system')
    && messages.some(m => m.role === 'user');

  const startEdit = (msg: Message) => {
    if (isTyping || speakingMsgId) return;
    setEditingMsgId(msg.id);
    setEditDraft(msg.text);
  };

  const cancelEdit = () => {
    setEditingMsgId(null);
    setEditDraft('');
  };

  const saveEdit = () => {
    const text = editDraft.trim();
    if (!editingMsgId || !text) return;
    const updated = messages.map(m => m.id === editingMsgId ? { ...m, text } : m);
    setMessages(updated);
    // Rebuild the session on the edited history so the model's memory of the
    // conversation matches what's on screen.
    if (activeCharacter && chatRef.current) {
      initChat(activeCharacter, updated);
    }
    cancelEdit();
  };

  const handleSpeakMessage = async (msgId: string, text: string) => {
    if (!activeCharacter || speakingMsgId) return;
    setSpeakingMsgId(msgId);
    setTtsStage('request');
    try {
      await speakText(text, activeCharacter, stage => setTtsStage(stage));
      setSpeakingMsgId(null);
      setTtsStage(null);
    } catch (error: any) {
      // Leave the error state visible briefly so the tap doesn't just "do nothing"
      setTtsStage('error');
      setTimeout(() => {
        setSpeakingMsgId(null);
        setTtsStage(null);
      }, 2500);
      if (/api key/i.test(error?.message || '')) setShowKeyModal(true);
    }
  };

  const handleGenerateVideoClick = async () => {
    if (!activeCharacter) return;

    // window.aistudio only exists when running inside the AI Studio frame
    const aistudio = (window as any).aistudio;
    if (aistudio?.hasSelectedApiKey) {
      const hasKey = await aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await aistudio.openSelectKey();
      }
    } else if (!hasApiKey()) {
      setShowKeyModal(true);
      return;
    }

    setIsVideoGenerating(true);
    setVideoProgress(null);

    let cameraFrame = null;
    if (isCameraActive && videoRef.current) {
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(videoRef.current, 0, 0);
            cameraFrame = canvas.toDataURL('image/jpeg');
        }
    }

    try {
      const videoUrl = await generateVideo(activeCharacter, messages.slice(-5), cameraFrame, p => setVideoProgress(p));
      if (videoUrl) {
        setGeneratedVideoUrl(videoUrl);
      }
    } catch (error: any) {
      console.error("Video Gen Error:", error);
      if (error.message?.toLowerCase().includes("not found") || error.status === 404) {
        alert("Video generation (Veo) requires an API key from a Google Cloud project with billing enabled — it is not available on the free tier. Please use a paid project key.");
        const aistudio = (window as any).aistudio;
        if (aistudio?.openSelectKey) {
          await aistudio.openSelectKey();
        } else {
          setShowKeyModal(true);
        }
      } else {
        alert(`Video generation failed: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setIsVideoGenerating(false);
      setVideoProgress(null);
    }
  };

  const handleVoiceSettingsChange = (newSettings: Character['voiceSettings']) => {
    if (!activeCharacter) return;
    const updatedChar = { ...activeCharacter, voiceSettings: newSettings };
    setActiveCharacter(updatedChar);
    updateCharacterInList(updatedChar);
  };

  const saveCharacter = (char: Character) => {
    setCharacters(prev => {
      const index = prev.findIndex(c => c.id === char.id);
      if (index >= 0) {
        const updated = [...prev];
        updated[index] = char;
        return updated;
      }
      return [...prev, char];
    });
    
    // If we're editing the currently active character, we must refresh the chat logic
    if (activeCharacter?.id === char.id) {
        setActiveCharacter(char);
        // Rebuild on the new persona, keeping the conversation so far
        initChat(char, messages);
        // We don't clear messages here so the conversation continues with the new logic
        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'system',
            text: 'Neural Pathways Updated.',
            timestamp: Date.now()
        }]);
    } else {
        handleSelectCharacter(char);
    }
    
    setIsCreating(false);
  };

  const filteredDiscoverCharacters = useMemo(() => {
    let list = [...DISCOVER_CHARACTERS];
    if (discoverFilter !== 'All') {
      list = list.filter(c => c.relationship === discoverFilter);
    }
    list.sort((a, b) => {
      if (discoverSort === 'newest') {
        return (b.createdAt || 0) - (a.createdAt || 0);
      } else {
        return (b.popularity || 0) - (a.popularity || 0);
      }
    });
    return list;
  }, [discoverFilter, discoverSort]);

  return (
    <div className="app-shell safe-area flex bg-[#030712] overflow-hidden">
      {/* Sidebar - Hidden on mobile */}
      <aside className="hidden md:flex w-80 flex-col border-r border-slate-800 glass-panel">
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <h1 className="text-2xl font-outfit font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-500">
            PersonaX
          </h1>
          <button
            onClick={() => setShowKeyModal(true)}
            title="Gemini API Key"
            className={`p-2 rounded-full transition-all ${hasApiKey() ? 'text-slate-500 hover:text-purple-400 hover:bg-slate-800' : 'text-amber-400 bg-amber-500/10 animate-pulse'}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
          </button>
        </div>
        
        <div className="p-4 space-y-2 border-b border-slate-800">
          <div className="flex bg-slate-900/50 p-1 rounded-xl">
             <button 
                onClick={() => { setView('my'); setActiveCharacter(null); }}
                className={`flex-1 py-2 text-[10px] font-bold rounded-lg transition-all ${view === 'my' ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
             >
                Companions
             </button>
             <button 
                onClick={() => { setView('discover'); setActiveCharacter(null); }}
                className={`flex-1 py-2 text-[10px] font-bold rounded-lg transition-all ${view === 'discover' ? 'bg-purple-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
             >
                Discover
             </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {view === 'my' && (
            <>
              <button
                onClick={() => { setActiveCharacter(null); setIsCreating(true); }}
                className="w-full py-3 px-4 rounded-xl border-2 border-dashed border-slate-700 text-slate-400 hover:text-white hover:border-purple-500 transition-all flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                New Companion
              </button>
              
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2">Active Bonds</h3>
                {characters.map(char => (
                  <button
                    key={char.id}
                    onClick={() => handleSelectCharacter(char)}
                    className={`group w-full p-3 flex items-center gap-3 rounded-xl transition-all ${activeCharacter?.id === char.id ? 'bg-purple-600/20 border border-purple-500/50' : 'hover:bg-slate-800 border border-transparent'}`}
                  >
                    <img src={char.avatarUrl || `https://picsum.photos/seed/${char.name}/100/100`} className="w-10 h-10 rounded-full object-cover border border-slate-700" alt={char.name} />
                    <div className="text-left flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{char.name}</div>
                      <div className="text-[10px] text-slate-400 truncate">{char.bondStatus || char.relationship}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {view === 'discover' && (
            <div className="space-y-4">
               <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2">Featured Creations</h3>
               {filteredDiscoverCharacters.map(char => (
                 <div key={char.id} className="p-4 rounded-2xl glass-panel border border-slate-800 hover:border-purple-500/50 transition-all group">
                    <div className="relative mb-3">
                        <img src={char.avatarUrl} className="w-full h-32 object-cover rounded-xl" alt={char.name} />
                    </div>
                    <h4 className="text-white font-bold">{char.name}</h4>
                    <button 
                       onClick={() => handleDiscoverAdopt(char)}
                       className="w-full py-2 bg-purple-600/20 hover:bg-purple-600 text-purple-400 hover:text-white text-[10px] font-bold rounded-lg transition-all border border-purple-500/30"
                    >
                       Adopt Character
                    </button>
                 </div>
               ))}
            </div>
          )}

          {view === 'archives' && (
            <div className="space-y-4">
               <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2">Saved Moments</h3>
               {savedChats.map(chat => (
                 <button
                   key={chat.id}
                   onClick={() => handleViewSavedChat(chat)}
                   className="group w-full p-4 glass-panel border border-slate-800 rounded-2xl hover:border-pink-500/30 transition-all text-left"
                 >
                   <div className="flex items-center gap-3 mb-2">
                      <img src={chat.characterAvatar || `https://picsum.photos/seed/${chat.characterName}/100/100`} className="w-8 h-8 rounded-full border border-slate-700" alt={chat.characterName} />
                      <div className="text-xs font-bold text-white truncate">{chat.characterName}</div>
                   </div>
                 </button>
               ))}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className={`flex-1 min-w-0 flex flex-col relative transition-all duration-300 ${!activeCharacter ? 'pb-24 md:pb-0' : ''}`}>
        {activeCharacter ? (
          <>
            {/* Chat Header */}
            <header className="h-16 md:h-20 flex items-center justify-between px-4 md:px-6 border-b border-slate-800 glass-panel z-10 sticky top-0">
              <div className="flex items-center gap-3 md:gap-4 overflow-hidden">
                <button onClick={() => { setActiveCharacter(null); chatRef.current = null; }} className="p-1 text-slate-400 hover:text-white md:hidden flex-shrink-0">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
                <div className="relative flex-shrink-0">
                  <img src={activeCharacter.avatarUrl || `https://picsum.photos/seed/${activeCharacter.name}/100/100`} className="w-9 h-9 md:w-10 md:h-10 rounded-full object-cover border border-purple-500" alt={activeCharacter.name} />
                  {isCameraActive && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 border-2 border-[#030712] animate-pulse"></div>
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="font-outfit font-bold text-sm md:text-base text-white leading-tight truncate">{activeCharacter.name}</h2>
                  <div className="flex items-center gap-1">
                    <span className="w-1 h-1 md:w-1.5 md:h-1.5 rounded-full bg-green-500"></span>
                    <span className="text-[8px] md:text-[9px] text-slate-400 uppercase tracking-widest truncate">
                      {getBondDescription(activeCharacter.bondLevel, activeCharacter.bondStatus)}
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
                {/* NEW EDIT BUTTON */}
                <button 
                  onClick={() => setIsCreating(true)} 
                  title="Customize Companion"
                  className="p-1.5 md:p-2 text-slate-500 hover:text-purple-400 hover:bg-slate-800 rounded-full transition-all"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>

                <button 
                  onClick={handleToggleCamera} 
                  title="Enable Camera for Video Gen"
                  className={`p-1.5 md:p-2 transition-all rounded-full ${isCameraActive ? 'bg-red-500/20 text-red-400' : 'text-slate-500 hover:text-white hover:bg-slate-800'}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                </button>
                <button onClick={handleExportChat} className="p-1.5 md:p-2 text-slate-500 hover:text-white transition-all rounded-full hover:bg-slate-800">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                </button>
                <button onClick={() => setShowVoice(true)} title="Voice chat" className="p-2 bg-purple-600 hover:bg-purple-500 text-white rounded-full transition-all shadow-lg">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-20a3 3 0 00-3 3v10a3 3 0 006 0V3a3 3 0 00-3-3z" /></svg>
                </button>
              </div>
            </header>

            {/* Chat Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6 bg-fixed opacity-90 relative">
              {isCameraActive && (
                <div className="fixed safe-camera-preview right-4 w-28 h-20 md:w-32 md:h-24 rounded-xl overflow-hidden border border-slate-700 shadow-2xl z-20 bg-black">
                  <video ref={attachCameraPreview} autoPlay playsInline muted className="w-full h-full object-cover" />
                </div>
              )}

              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : msg.role === 'system' ? 'justify-center' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
                  {msg.role === 'system' ? (
                      <div className="flex flex-col items-center gap-2 max-w-[90%]">
                        <div className="bg-purple-900/20 border border-purple-500/20 px-4 py-1.5 rounded-full text-[10px] font-bold text-purple-400 uppercase tracking-widest text-center">{msg.text}</div>
                        {canRetry && msg.id === lastMessage?.id && (
                          <button
                            onClick={handleRetry}
                            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full text-[10px] font-bold text-slate-300 uppercase tracking-widest flex items-center gap-1.5 transition-all"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            Retry
                          </button>
                        )}
                      </div>
                  ) : (
                    <div className={`max-w-[90%] md:max-w-[85%] rounded-2xl p-3.5 md:p-4 ${msg.role === 'user' ? 'bg-purple-600 text-white rounded-tr-none' : 'glass-panel text-slate-200 border-l-4 border-l-pink-500 rounded-tl-none shadow-xl'} ${editingMsgId === msg.id ? 'w-full' : ''}`}>
                        {editingMsgId === msg.id ? (
                          <div className="space-y-3">
                            <textarea
                              value={editDraft}
                              onChange={e => setEditDraft(e.target.value)}
                              autoFocus
                              className="w-full min-h-28 bg-slate-900/70 border border-slate-700 rounded-xl px-4 py-3 focus:ring-2 focus:ring-purple-500 outline-none resize-y text-base md:text-sm text-slate-200 leading-relaxed"
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={cancelEdit}
                                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={saveEdit}
                                disabled={!editDraft.trim()}
                                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all disabled:opacity-40"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                        <>
                        <p className="text-sm md:text-base leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                        <div className="flex items-center justify-between mt-2 gap-3">
                          <div className="text-[10px] opacity-40">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                          {msg.role === 'model' && (
                            speakingMsgId === msg.id && ttsStage ? (
                              /* Real TTS pipeline position, not a generic pulse */
                              <div className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest ${ttsStage === 'error' ? 'text-red-400' : 'text-pink-400'}`}>
                                {ttsStage === 'error' ? (
                                  <span>Audio failed</span>
                                ) : (
                                  <>
                                    {TTS_STAGES.map(s => (
                                      <span key={s.stage} className={`w-1.5 h-1.5 rounded-full transition-colors ${(TTS_STAGES.find(x => x.stage === ttsStage)?.step ?? 4) >= s.step ? 'bg-pink-500' : 'bg-slate-600'}`} />
                                    ))}
                                    <span className="ml-1">
                                      {ttsStage === 'done' ? 'Done' : `${TTS_STAGES.find(x => x.stage === ttsStage)?.step ?? 4}/4 · ${TTS_STAGES.find(x => x.stage === ttsStage)?.label ?? 'Playing'}`}
                                    </span>
                                  </>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                {canRetry && msg.id === lastMessage?.id && (
                                  <button onClick={handleRetry} title="Regenerate response" className="p-1 text-slate-500 hover:text-purple-400 transition-colors">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                  </button>
                                )}
                                <button onClick={() => startEdit(msg)} title="Edit response" className="p-1 text-slate-500 hover:text-purple-400 transition-colors">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                </button>
                                <button onClick={() => handleSpeakMessage(msg.id, msg.text)} title="Play audio" className="p-1 text-slate-500 hover:text-pink-400 transition-colors">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                                </button>
                              </div>
                            )
                          )}
                        </div>
                        </>
                        )}
                    </div>
                  )}
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="glass-panel rounded-2xl p-3 flex gap-1">
                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce"></span>
                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </div>
                </div>
              )}
            </div>

            {/* Chat Input */}
            <div className="p-3 md:p-4 border-t border-slate-800 glass-panel sticky bottom-0">
              <div className="flex gap-2 mb-2 overflow-x-auto no-scrollbar">
                 <button
                  type="button"
                  onClick={() => setShowModelPicker(true)}
                  title="Choose Gemini model"
                  className="whitespace-nowrap flex-none px-4 py-2 bg-slate-800/80 border border-slate-700 text-slate-300 text-[10px] font-bold rounded-xl flex items-center justify-center gap-2 hover:border-purple-500/50 hover:text-white transition-all"
                 >
                   <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                   {textModel.replace(/^gemini-/, '')}
                 </button>
                 <button
                  onClick={handleGenerateVideoClick}
                  disabled={isVideoGenerating}
                  className="whitespace-nowrap flex-none px-4 py-2 bg-gradient-to-r from-purple-600 to-rose-600 text-white text-[10px] font-bold rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
                 >
                   {isVideoGenerating ? (
                     /* Real pipeline position reported by generateVideo, not a canned message */
                     <>
                       <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
                       {videoProgress ? `${videoProgress.step}/${videoProgress.totalSteps} · ${videoProgress.label}` : 'Starting…'}
                     </>
                   ) : (
                     <>
                       <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                       {isCameraActive ? 'Gen with Camera' : 'Generate Video'}
                     </>
                   )}
                 </button>
                 {generatedVideoUrl && (
                   <button
                    type="button"
                    onClick={() => setShowVideo(true)}
                    className="whitespace-nowrap flex-none px-4 py-2 bg-slate-800 text-white text-[10px] font-bold rounded-xl flex items-center justify-center gap-2"
                   >
                     View Video
                   </button>
                 )}
              </div>
              <form onSubmit={handleSendMessage} className="flex items-center gap-2 bg-slate-900/80 border border-slate-700 rounded-2xl px-3 md:px-4 py-0.5 md:py-1 focus-within:ring-2 focus-within:ring-purple-500">
                <input
                  type="text"
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  placeholder={chatRef.current ? "Message..." : "View Only"}
                  disabled={!chatRef.current}
                  className="flex-1 bg-transparent text-white outline-none py-3 text-base md:text-sm placeholder:text-slate-600"
                />
                <button type="submit" disabled={!inputText.trim() || isTyping || !chatRef.current} className="p-2 text-purple-400 hover:text-white disabled:opacity-30">
                  <svg className="w-6 h-6 rotate-90" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>
                </button>
              </form>
            </div>
          </>
        ) : (
          /* Central Grid / Dashboard View */
          <div className="flex-1 flex flex-col items-center p-4 md:p-6 bg-gradient-to-b from-transparent to-purple-900/10 overflow-y-auto">
             <div className="mt-8 md:mt-12 mb-8 md:mb-12 relative flex flex-col items-center text-center">
                <h1 className="text-4xl md:text-6xl font-outfit font-black mb-3 md:mb-4 tracking-tighter text-white relative">
                  Persona<span className="text-purple-500">X</span>
                </h1>
                <p className="text-slate-400 max-w-md mx-auto text-xs md:text-sm mb-4 px-4">
                  {view === 'my' ? 'Private Bond Archives' : view === 'archives' ? 'Revisit Roleplay Moments' : 'Discover New Archetypes'}
                </p>

                <button
                  onClick={() => setShowKeyModal(true)}
                  className={`md:hidden mb-6 px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${hasApiKey() ? 'border-slate-700 text-slate-500' : 'border-amber-500/50 text-amber-400 animate-pulse'}`}
                >
                  {hasApiKey() ? 'API Key ✓' : 'Set API Key'}
                </button>
                
                <div className="hidden md:flex gap-4">
                  <button onClick={() => setView('my')} className={`px-6 py-2 rounded-full font-bold transition-all ${view === 'my' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}>Bonds</button>
                  <button onClick={() => setView('discover')} className={`px-6 py-2 rounded-full font-bold transition-all ${view === 'discover' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}>Discover</button>
                  <button onClick={() => setView('archives')} className={`px-6 py-2 rounded-full font-bold transition-all ${view === 'archives' ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}>Moments</button>
                </div>
             </div>

             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 w-full max-w-5xl px-2 pb-24">
                {(view === 'my' ? characters : view === 'archives' ? savedChats : filteredDiscoverCharacters).map(item => {
                  const isSavedChat = 'characterName' in item;
                  const char = isSavedChat ? null : (item as Character);
                  const chat = isSavedChat ? (item as SavedChat) : null;
                  
                  if (chat) return (
                    <div key={chat.id} onClick={() => handleViewSavedChat(chat)} className="group flex flex-col items-center p-5 md:p-6 glass-panel rounded-3xl border border-slate-800 hover:border-pink-500/50 hover:bg-pink-900/10 transition-all text-center cursor-pointer">
                      <img src={chat.characterAvatar || `https://picsum.photos/seed/${chat.characterName}/100/100`} className="w-16 h-16 md:w-20 md:h-20 rounded-full border-2 border-slate-700 mb-4" alt={chat.characterName} />
                      <h3 className="text-base md:text-lg font-bold text-white mb-1">{chat.characterName}</h3>
                      <p className="text-[9px] md:text-[10px] text-slate-500 uppercase tracking-widest">{new Date(chat.timestamp).toLocaleDateString()}</p>
                    </div>
                  );

                  return char && (
                    <div key={char.id} onClick={() => view === 'my' ? handleSelectCharacter(char) : handleDiscoverAdopt(char)} className="group flex flex-col items-center p-5 md:p-6 glass-panel rounded-3xl border border-slate-800 hover:border-purple-500/50 hover:bg-purple-900/10 transition-all text-center cursor-pointer">
                      <div className="relative w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden mb-4 border-2 border-slate-700 group-hover:border-purple-500">
                        <img src={char.avatarUrl || `https://picsum.photos/seed/${char.name}/200/200`} className="w-full h-full object-cover" alt={char.name} />
                      </div>
                      <h3 className="text-lg md:text-xl font-bold text-white mb-1">{char.name}</h3>
                      <p className="text-[10px] md:text-xs text-slate-500 mb-4 line-clamp-2">{char.personality}</p>
                      <div className="px-3 py-1 bg-slate-800 rounded-full text-[8px] md:text-[9px] text-slate-400 uppercase tracking-widest">{getBondDescription(char.bondLevel, char.bondStatus)}</div>
                    </div>
                  );
                })}
                
                {view === 'my' && (
                  <button onClick={() => { setActiveCharacter(null); setIsCreating(true); }} className="flex flex-col items-center justify-center p-6 glass-panel rounded-3xl border-2 border-dashed border-slate-800 hover:border-purple-500 hover:bg-purple-900/5 transition-all min-h-[180px] md:min-h-[250px]">
                    <svg className="w-8 h-8 text-slate-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    <h3 className="text-base font-bold text-slate-300">Create New</h3>
                  </button>
                )}
             </div>
          </div>
        )}

        {/* Mobile Bottom Navigation */}
        {!activeCharacter && (
          <nav className="fixed safe-bottom-nav left-1/2 -translate-x-1/2 w-[90%] max-w-sm h-16 glass-panel rounded-full border border-slate-700 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center justify-around px-2 z-40 md:hidden">
            <button onClick={() => setView('my')} className={`flex flex-col items-center gap-1 transition-all px-4 py-2 rounded-full ${view === 'my' ? 'bg-purple-600/20 text-purple-400' : 'text-slate-500'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197" /></svg>
              <span className="text-[8px] font-bold uppercase tracking-widest">Bonds</span>
            </button>
            <button onClick={() => setView('discover')} className={`flex flex-col items-center gap-1 transition-all px-4 py-2 rounded-full ${view === 'discover' ? 'bg-purple-600/20 text-purple-400' : 'text-slate-500'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <span className="text-[8px] font-bold uppercase tracking-widest">Discover</span>
            </button>
            <button onClick={() => setView('archives')} className={`flex flex-col items-center gap-1 transition-all px-4 py-2 rounded-full ${view === 'archives' ? 'bg-purple-600/20 text-purple-400' : 'text-slate-500'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span className="text-[8px] font-bold uppercase tracking-widest">Moments</span>
            </button>
          </nav>
        )}

        {showVoice && activeCharacter && (
          <VoiceInterface character={activeCharacter} onClose={() => setShowVoice(false)} onSettingsChange={handleVoiceSettingsChange} />
        )}
      </main>

      {/* Video Player — played inline because blob URLs can't open in a new tab from a home-screen app */}
      {showVideo && generatedVideoUrl && (
        <div className="fixed inset-0 z-[60] safe-area flex flex-col items-center justify-center gap-4 bg-black/95 p-4" onClick={() => setShowVideo(false)}>
          <video
            src={generatedVideoUrl}
            controls
            autoPlay
            playsInline
            className="w-full max-w-3xl max-h-[75vh] rounded-2xl bg-black"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setShowVideo(false)}
            className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs uppercase tracking-widest"
          >
            Close
          </button>
        </div>
      )}

      {/* Model Picker Modal */}
      {showModelPicker && (
        <div className="fixed inset-0 z-[60] safe-area flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowModelPicker(false)}>
          <div className="glass-panel w-full max-w-md rounded-3xl border border-purple-500/30 p-6 md:p-8 animate-in fade-in zoom-in duration-300 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-outfit font-bold text-white mb-2">Chat Model</h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-5">
              Models your API key can use, fetched live from Google. Switching keeps the current conversation.
            </p>
            <div className="flex-1 overflow-y-auto space-y-2 -mx-1 px-1">
              {chatModels.length === 0 && (
                <div className="flex items-center gap-3 text-slate-400 text-xs py-4">
                  <div className="animate-spin h-4 w-4 border-2 border-purple-500 border-t-transparent rounded-full" />
                  Fetching available models…
                </div>
              )}
              {!chatModels.some(m => m.id === textModel) && chatModels.length > 0 && (
                <button
                  onClick={() => handleSelectModel(textModel)}
                  className="w-full text-left p-4 rounded-2xl border bg-purple-600/20 border-purple-500/50 transition-all"
                >
                  <div className="text-sm font-bold text-white">{textModel}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">current selection</div>
                </button>
              )}
              {chatModels.map(m => (
                <button
                  key={m.id}
                  onClick={() => handleSelectModel(m.id)}
                  className={`w-full text-left p-4 rounded-2xl border transition-all ${m.id === textModel ? 'bg-purple-600/20 border-purple-500/50' : 'bg-slate-900/50 border-slate-800 hover:border-slate-600'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-bold text-white truncate">{m.label}</div>
                    {m.id === textModel && (
                      <svg className="w-4 h-4 text-purple-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5 font-mono truncate">{m.id}</div>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowModelPicker(false)}
              className="mt-5 w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl transition-all text-xs uppercase tracking-widest"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* API Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="glass-panel w-full max-w-md rounded-3xl border border-purple-500/30 p-6 md:p-8 animate-in fade-in zoom-in duration-300">
            <h3 className="text-xl font-outfit font-bold text-white mb-2">Connect Gemini API Key</h3>
            <p className="text-xs text-slate-400 leading-relaxed mb-5">
              PersonaX runs on the Gemini API free tier. Get a free key at{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-purple-400 underline hover:text-purple-300">
                aistudio.google.com/apikey
              </a>{' '}
              and paste it below. It is stored only in this browser. Video generation (Veo) additionally requires a key from a billing-enabled project.
            </p>
            <input
              type="password"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveApiKey(); }}
              placeholder={hasApiKey() ? 'Key already set — paste to replace' : 'AIza...'}
              className="w-full bg-slate-900/70 border border-slate-700 rounded-2xl px-5 py-4 mb-4 focus:ring-2 focus:ring-purple-500 outline-none transition-all text-white placeholder:text-slate-600 text-base md:text-sm font-mono"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setKeyInput(''); setShowKeyModal(false); }}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl transition-all text-xs uppercase tracking-widest"
              >
                {hasApiKey() ? 'Close' : 'Later'}
              </button>
              <button
                onClick={handleSaveApiKey}
                disabled={!keyInput.trim()}
                className="flex-1 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 text-white font-bold rounded-xl transition-all disabled:opacity-40 text-xs uppercase tracking-widest"
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Creation/Edit Modal */}
      {isCreating && (
        <div className="fixed inset-0 z-50 safe-area flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-hidden">
          <CharacterCreator 
            onSave={saveCharacter} 
            onCancel={() => setIsCreating(false)} 
            initialCharacter={activeCharacter || undefined} 
            conversationHistory={messages}
          />
        </div>
      )}
    </div>
  );
};

export default App;
