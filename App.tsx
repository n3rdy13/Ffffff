
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Character, Message, Relationship } from './types';
import { DEFAULT_CHARACTERS, DISCOVER_CHARACTERS, getBondDescription, REASSURING_VIDEO_MESSAGES } from './constants';
import CharacterCreator from './components/CharacterCreator';
import VoiceInterface from './components/VoiceInterface';
import { startTextChat, summarizeMemory, analyzeRelationship, generateVideo, speakText } from './services/geminiService';

interface SavedChat {
  id: string;
  characterName: string;
  characterAvatar?: string;
  messages: Message[];
  timestamp: number;
  bondStatus: string;
}

const App: React.FC = () => {
  const [characters, setCharacters] = useState<Character[]>(() => {
    const saved = localStorage.getItem('persona_characters');
    return saved ? JSON.parse(saved) : DEFAULT_CHARACTERS;
  });

  const [savedChats, setSavedChats] = useState<SavedChat[]>(() => {
    const saved = localStorage.getItem('persona_saved_chats');
    return saved ? JSON.parse(saved) : [];
  });
  
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

  // TTS State
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);

  // Video Generation States
  const [isVideoGenerating, setIsVideoGenerating] = useState(false);
  const [videoMessageIndex, setVideoMessageIndex] = useState(0);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);

  // Camera State
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const chatRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('persona_characters', JSON.stringify(characters));
  }, [characters]);

  useEffect(() => {
    localStorage.setItem('persona_saved_chats', JSON.stringify(savedChats));
  }, [savedChats]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  useEffect(() => {
    let interval: any;
    if (isVideoGenerating) {
      interval = setInterval(() => {
        setVideoMessageIndex(prev => (prev + 1) % REASSURING_VIDEO_MESSAGES.length);
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [isVideoGenerating]);

  // Handle Camera Stream Cleanup
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

  const handleToggleCamera = async () => {
    if (isCameraActive) {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
      setCameraStream(null);
      setIsCameraActive(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        setCameraStream(stream);
        setIsCameraActive(true);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Camera access denied:", err);
        alert("Camera access is required for this feature.");
      }
    }
  };

  const handleSelectCharacter = (char: Character) => {
    setActiveCharacter(char);
    setMessages([]);
    setGeneratedVideoUrl(null);
    chatRef.current = startTextChat(char);
    
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

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `PersonaX_${activeCharacter.name}_${Date.now()}.txt`;
    link.click();
    URL.revokeObjectURL(url);
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

    if (!customPrompt) {
        const userMessage: Message = {
          id: Date.now().toString(),
          role: 'user',
          text: textToSend,
          timestamp: Date.now()
        };
        setMessages(prev => [...prev, userMessage]);
    }
    
    setInputText('');
    setIsTyping(true);

    try {
      const response = await chatRef.current.sendMessage({ message: textToSend });
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: response.text || "I'm sorry, I couldn't process that.",
        timestamp: Date.now()
      };
      
      const updatedHistory = [...messages, aiMessage];
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
    } catch (error) {
      console.error("Chat Error:", error);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSpeakMessage = async (msgId: string, text: string) => {
    if (!activeCharacter || speakingMsgId) return;
    setSpeakingMsgId(msgId);
    await speakText(text, activeCharacter);
    setSpeakingMsgId(null);
  };

  const handleGenerateVideoClick = async () => {
    if (!activeCharacter) return;

    const hasKey = await (window as any).aistudio.hasSelectedApiKey();
    if (!hasKey) {
      await (window as any).aistudio.openSelectKey();
    }

    setIsVideoGenerating(true);
    setVideoMessageIndex(0);

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
      const videoUrl = await generateVideo(activeCharacter, messages.slice(-5), cameraFrame);
      if (videoUrl) {
        setGeneratedVideoUrl(videoUrl);
      }
    } catch (error: any) {
      console.error("Video Gen Error:", error);
      if (error.message?.toLowerCase().includes("not found") || error.status === 404) {
        alert("The selected project might not have access to the Veo model or the API key is invalid for this model. Please select a valid paid project key.");
        await (window as any).aistudio.openSelectKey();
      }
    } finally {
      setIsVideoGenerating(false);
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
        chatRef.current = startTextChat(char);
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
    <div className="flex h-screen bg-[#030712] overflow-hidden">
      {/* Sidebar - Hidden on mobile */}
      <aside className="hidden md:flex w-80 flex-col border-r border-slate-800 glass-panel">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-2xl font-outfit font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-500">
            PersonaX
          </h1>
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
      <main className={`flex-1 flex flex-col relative transition-all duration-300 ${!activeCharacter ? 'pb-24 md:pb-0' : ''}`}>
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
                <button onClick={() => setShowVoice(true)} className="p-2 bg-purple-600 hover:bg-purple-500 text-white rounded-full transition-all shadow-lg">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-20a3 3 0 00-3 3v10a3 3 0 006 0V3a3 3 0 00-3-3z" /></svg>
                </button>
              </div>
            </header>

            {/* Chat Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6 bg-fixed opacity-90 relative">
              {isCameraActive && (
                <div className="fixed top-20 right-4 w-28 h-20 md:w-32 md:h-24 rounded-xl overflow-hidden border border-slate-700 shadow-2xl z-20 bg-black">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                </div>
              )}

              {messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : msg.role === 'system' ? 'justify-center' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
                  {msg.role === 'system' ? (
                      <div className="bg-purple-900/20 border border-purple-500/20 px-4 py-1.5 rounded-full text-[10px] font-bold text-purple-400 uppercase tracking-widest">{msg.text}</div>
                  ) : (
                    <div className={`max-w-[90%] md:max-w-[85%] rounded-2xl p-3.5 md:p-4 ${msg.role === 'user' ? 'bg-purple-600 text-white rounded-tr-none' : 'glass-panel text-slate-200 border-l-4 border-l-pink-500 rounded-tl-none shadow-xl'}`}>
                        <p className="text-sm md:text-base leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                        <div className="flex items-center justify-between mt-2">
                          <div className="text-[10px] opacity-40">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                          {msg.role === 'model' && (
                            <button onClick={() => handleSpeakMessage(msg.id, msg.text)} className={`p-1 transition-colors ${speakingMsgId === msg.id ? 'text-pink-500 animate-pulse' : 'text-slate-500 hover:text-pink-400'}`}>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                            </button>
                          )}
                        </div>
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
                  onClick={handleGenerateVideoClick}
                  disabled={isVideoGenerating}
                  className="whitespace-nowrap flex-none px-4 py-2 bg-gradient-to-r from-purple-600 to-rose-600 text-white text-[10px] font-bold rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
                 >
                   {isVideoGenerating ? (
                     <>
                       <div className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full" />
                       {REASSURING_VIDEO_MESSAGES[videoMessageIndex]}
                     </>
                   ) : (
                     <>
                       <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                       {isCameraActive ? 'Gen with Camera' : 'Generate Video'}
                     </>
                   )}
                 </button>
                 {generatedVideoUrl && (
                   <a 
                    href={generatedVideoUrl} 
                    target="_blank" 
                    rel="noreferrer"
                    className="whitespace-nowrap flex-none px-4 py-2 bg-slate-800 text-white text-[10px] font-bold rounded-xl flex items-center justify-center gap-2"
                   >
                     View Video
                   </a>
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
                <p className="text-slate-400 max-w-md mx-auto text-xs md:text-sm mb-6 md:mb-8 px-4">
                  {view === 'my' ? 'Private Bond Archives' : view === 'archives' ? 'Revisit Roleplay Moments' : 'Discover New Archetypes'}
                </p>
                
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
          <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-sm h-16 glass-panel rounded-full border border-slate-700 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center justify-around px-2 z-40 md:hidden">
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

      {/* Creation/Edit Modal */}
      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-hidden">
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
