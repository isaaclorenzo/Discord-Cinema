import React, { useState, useRef, useEffect } from 'react';
import {
  Hash, Settings, Mic, Headphones, Plus, Compass, Tv, Users,
  Bell, Pin, HelpCircle, Play, Pause, Volume2, Maximize,
  Send, Film
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Simulación de los datos del bot de cine
interface CinemaState {
  isActive: boolean;
  movieUrl: string;
  movieTitle: string;
  currentTime: number;
  isPlaying: boolean;
}

const App: React.FC = () => {
  const [activeChannel, setActiveChannel] = useState('cine-general');
  const [cinema, setCinema] = useState<CinemaState>({
    isActive: false,
    movieUrl: '',
    movieTitle: '',
    currentTime: 0,
    isPlaying: false
  });
  const [messages, setMessages] = useState([
    { id: 1, user: 'CinemaBot', content: '🎬 ¡Hola! Pega un link de Cuevana o PelisPlus para empezar la función.', time: '12:00' }
  ]);
  const [inputText, setInputText] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  // Función para "El Bot" que simula detectar un link de película
  const handleSendMessage = () => {
    if (!inputText.trim()) return;

    const newMsg = { id: Date.now(), user: 'Isaac_Guest', content: inputText, time: 'Ahora' };
    setMessages(prev => [...prev, newMsg]);

    // Lógica del Bot: Detectar links de cine
    if (inputText.includes('cuevana') || inputText.includes('pelisplus') || inputText.includes('.mp4')) {
      setTimeout(() => {
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          user: 'CinemaBot',
          content: '🔍 Extrayendo película... ¡Preparando la sala!',
          time: 'Ahora'
        }]);

        // Simulación: Iniciar modo cine
        setTimeout(() => {
          setCinema({
            isActive: true,
            movieUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', // Ejemplo real
            movieTitle: 'Película en Streaming (Co-watching)',
            currentTime: 0,
            isPlaying: true
          });
          setActiveChannel('Sala de Cine 🍿');
        }, 2000);
      }, 500);
    }
    setInputText('');
  };

  // Sincronizar estado de reproducción con el elemento de video
  useEffect(() => {
    if (videoRef.current) {
      if (cinema.isPlaying) {
        videoRef.current.play().catch(e => console.log('Autoplay prevented:', e));
      } else {
        videoRef.current.pause();
      }
    }
  }, [cinema.isPlaying, cinema.isActive]);

  return (
    <div className="flex h-screen w-screen overflow-hidden text-gray-300 font-sans bg-[#313338]">

      {/* 1. Server List */}
      <nav className="w-[72px] bg-[#1e1f22] flex flex-col items-center py-3 space-y-2 border-r border-black/20">
        <ServerIcon icon={<Tv size={28} />} active />
        <div className="w-8 h-[2px] bg-[#35363c] rounded-full mx-auto" />
        <ServerIcon icon={<Plus size={24} color="#23a559" />} />
        <ServerIcon icon={<Compass size={24} color="#23a559" />} />
      </nav>

      {/* 2. Channel Sidebar */}
      <aside className="w-60 bg-[#2b2d31] flex flex-col">
        <header className="h-12 px-4 flex items-center shadow-sm border-b border-[#1e1f22] hover:bg-[#35373c] cursor-pointer transition-colors">
          <h1 className="font-bold text-white text-[15px] truncate">Discord 2.0 Cinema</h1>
        </header>

        <div className="flex-1 overflow-y-auto pt-3 px-2 custom-scrollbar">
          <ChannelCategory label="CANALES DE TEXTO" />
          <ChannelLink label="cine-general" active={activeChannel === 'cine-general'} onClick={() => setActiveChannel('cine-general')} />
          <ChannelLink label="estrenos-hoy" />

          <div className="mt-4">
            <ChannelCategory label="CANALES DE VOZ" />
            <VoiceChannelLink
              label="Sala de Cine 🍿"
              active={activeChannel === 'Sala de Cine 🍿'}
              onClick={() => setActiveChannel('Sala de Cine 🍿')}
              isStreaming={cinema.isActive}
            />
          </div>
        </div>

        {/* User Profile */}
        <div className="h-[52px] bg-[#232428] px-2 flex items-center space-x-2">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500" />
            <div className="absolute bottom-0 right-0 w-3 h-3 bg-[#23a559] border-2 border-[#232428] rounded-full" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-bold truncate">Isaac_Dev</p>
            <p className="text-[10px] text-[#949ba4]">#0001</p>
          </div>
          <div className="flex space-x-1">
            <IconButton icon={<Mic size={16} />} />
            <IconButton icon={<Headphones size={16} />} />
            <IconButton icon={<Settings size={16} />} />
          </div>
        </div>
      </aside>

      {/* 3. Main Content Content Container */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 px-4 shadow-sm border-b border-[#1e1f22] flex items-center justify-between bg-[#313338]">
          <div className="flex items-center space-x-2">
            <Hash size={24} className="text-[#80848e]" />
            <span className="font-bold text-white">{activeChannel}</span>
          </div>
          <div className="flex items-center space-x-4 text-[#b5bac1]">
            <Bell size={20} className="hover:text-white cursor-pointer" />
            <Pin size={20} className="hover:text-white cursor-pointer" />
            <Users size={20} className="hover:text-white cursor-pointer" />
            <HelpCircle size={20} className="hover:text-white cursor-pointer" />
          </div>
        </header>

        <div className="flex-1 flex flex-col min-h-0 bg-[#313338]">

          {/* MODO CINE ACTIVO */}
          <AnimatePresence>
            {cinema.isActive && activeChannel === 'Sala de Cine 🍿' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="bg-black flex flex-col items-center justify-center relative group"
              >
                <div className="w-full aspect-video max-h-[70vh] relative">
                  <video
                    ref={videoRef}
                    src={cinema.movieUrl}
                    className="w-full h-full object-contain"
                    autoPlay
                    controls={false} // Custom controls
                  />
                  {/* Overlay Controls */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                    <div className="flex items-center space-x-4 text-white">
                      <button onClick={() => setCinema({ ...cinema, isPlaying: !cinema.isPlaying })}>
                        {cinema.isPlaying ? <Pause /> : <Play />}
                      </button>
                      <div className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
                        <div className="h-full bg-[#5865f2]" style={{ width: '45%' }} />
                      </div>
                      <Volume2 size={20} />
                      <Maximize size={20} />
                    </div>
                    <p className="text-white text-sm font-bold mt-2">🔴 TRANSMITIENDO: {cinema.movieTitle}</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col space-y-4 custom-scrollbar">
            {!cinema.isActive && <WelcomeMessage channel={activeChannel} />}
            {messages.map((m) => (
              <div key={m.id} className="flex space-x-4 group hover:bg-[#2e3035] -mx-4 px-4 py-1 transition-colors">
                <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center ${m.user === 'CinemaBot' ? 'bg-[#5865f2]' : 'bg-gray-600'}`}>
                  {m.user === 'CinemaBot' ? <Film size={20} color="white" /> : m.user[0]}
                </div>
                <div>
                  <div className="flex items-center space-x-2 text-sm">
                    <span className={`font-bold ${m.user === 'CinemaBot' ? 'text-[#5865f2]' : 'text-white'}`}>{m.user}</span>
                    <span className="text-[10px] text-[#949ba4]">{m.time}</span>
                  </div>
                  <p className="text-[15px] leading-relaxed text-[#dbdee1]">{m.content}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Input Bar */}
          <div className="px-4 pb-6 mt-auto">
            <div className="bg-[#383a40] rounded-lg p-3 flex items-center space-x-4">
              <div className="bg-[#b5bac1] rounded-full p-0.5 cursor-pointer hover:bg-white transition-colors">
                <Plus size={20} className="text-[#383a40]" />
              </div>
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={`Enviar mensaje a #${activeChannel}`}
                className="bg-transparent flex-1 outline-none text-gray-200 placeholder-[#6d6f78]"
              />
              <button onClick={handleSendMessage} className="text-[#b5bac1] hover:text-white transition-colors">
                <Send size={20} />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* User Sidebar (Right) */}
      <aside className="w-60 bg-[#2b2d31] border-l border-black/20 p-4 hidden xl:block">
        <h3 className="text-[11px] font-bold text-[#b5bac1] mb-2 uppercase tracking-wider">Bot Maestro — 1</h3>
        <div className="flex items-center space-x-2 py-1 px-2 rounded hover:bg-[#35373c] cursor-pointer group">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-[#5865f2] flex items-center justify-center">
              <Film size={18} color="white" />
            </div>
            <div className="absolute bottom-0 right-0 w-3 h-3 bg-[#23a559] border-2 border-[#2b2d31] rounded-full" />
          </div>
          <span className="text-[#949ba4] font-medium group-hover:text-white">CinemaBot</span>
        </div>
      </aside>
    </div>
  );
};

// Sub-components
const ServerIcon = ({ icon, active = false }: { icon: React.ReactNode, active?: boolean }) => (
  <div className="relative group cursor-pointer">
    {active && <div className="absolute left-[-12px] top-1/2 -translate-y-1/2 w-2 h-10 bg-white rounded-r-md" />}
    <div className={`w-12 h-12 rounded-[24px] group-hover:rounded-[16px] transition-all flex items-center justify-center ${active ? 'bg-[#5865f2] text-white' : 'bg-[#313338] text-[#23a559] group-hover:bg-[#23a559] group-hover:text-white'}`}>
      {icon}
    </div>
  </div>
);

const ChannelCategory = ({ label }: { label: string }) => (
  <div className="mt-4 px-2 mb-1">
    <span className="text-[11px] font-bold text-[#949ba4] hover:text-[#dbdee1] uppercase tracking-wider">{label}</span>
  </div>
);

const ChannelLink = ({ label, active = false, onClick }: { label: string, active?: boolean, onClick?: () => void }) => (
  <div onClick={onClick} className={`group px-2 py-1.5 rounded-md flex items-center space-x-2 cursor-pointer mb-0.5 ${active ? 'bg-[#3f4147] text-white' : 'hover:bg-[#35373c] text-[#80848e] hover:text-[#dbdee1]'}`}>
    <Hash size={18} className="text-[#80848e]" />
    <span className="font-medium text-[15px]">{label}</span>
  </div>
);

const VoiceChannelLink = ({ label, active = false, onClick, isStreaming = false }: { label: string, active?: boolean, onClick?: () => void, isStreaming?: boolean }) => (
  <div onClick={onClick} className={`group px-2 py-1.5 rounded-md flex items-center justify-between cursor-pointer mb-0.5 ${active ? 'bg-[#3f4147] text-white' : 'hover:bg-[#35373c] text-[#80848e] hover:text-[#dbdee1]'}`}>
    <div className="flex items-center space-x-2">
      <Mic size={18} />
      <span className="font-medium text-[15px]">{label}</span>
      {isStreaming && <span className="bg-[#f23f43] text-white text-[10px] px-1 rounded-sm font-bold uppercase tracking-tighter">En Vivo</span>}
    </div>
    <Settings size={14} className="opacity-0 group-hover:opacity-100" />
  </div>
);

const IconButton = ({ icon }: { icon: React.ReactNode }) => (
  <div className="p-1.5 rounded-md hover:bg-[#3f4147] cursor-pointer transition-colors text-[#b5bac1] hover:text-white">
    {icon}
  </div>
);

const WelcomeMessage = ({ channel }: { channel: string }) => (
  <div className="flex flex-col items-start px-2 py-8">
    <div className="bg-[#41434a] p-4 rounded-full mb-4 shadow-lg">
      <Hash size={48} className="text-white" />
    </div>
    <h2 className="text-3xl font-bold text-white mb-2">¡Bienvenido a #{channel}!</h2>
    <p className="text-[#b5bac1] text-lg">Este es el comienzo oficial de la sala de cine Discord 2.0.</p>
  </div>
);

export default App;
