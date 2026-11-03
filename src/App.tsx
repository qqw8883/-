import React, { useState, useEffect, useRef } from 'react';
import { auth, db, appId, setupError, runtimeConfig, roomAction } from './services.js';
import { mergeRoomView } from './room-view.mjs';
import { WORD_LIBRARY, AVATARS } from '../functions/lib/words.mjs';
import { 
  signInAnonymously, 
  signInWithCustomToken, 
  onAuthStateChanged 
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { 
  Users, Sparkles, Eye, EyeOff, Mic, CheckCircle2, AlertTriangle, 
  Volume2, VolumeX, Crown, Skull, Play, RotateCcw, Plus, UserPlus, 
  ShieldAlert, HelpCircle, Share2, Award, Zap, MessageSquare, Clock,
  Bot, Settings, LogOut, Flame, RefreshCw, Fingerprint, ChevronRight
} from 'lucide-react';

export default function App() {
  // 用户与鉴权状态
  const [user, setUser] = useState(null);
  const [nickname, setNickname] = useState(() => `玩家${Math.floor(100 + Math.random() * 900)}`);
  const [avatar, setAvatar] = useState(() => AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  
  // 房间与联机状态
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [activeRoomCode, setActiveRoomCode] = useState('');
  const [publicRoom, setPublicRoom] = useState(null);
  const [privateHand, setPrivateHand] = useState(null);
  const roomData = mergeRoomView(publicRoom, privateHand);
  const [errorMsg, setErrorMsg] = useState(setupError || '');
  const [isLoading, setIsLoading] = useState(false);

  // 本地交互状态 (防窥看牌、模拟玩家视角切换、语音开关等)
  const [isPeekingCard, setIsPeekingCard] = useState(false);
  const [activeControlId, setActiveControlId] = useState(null); // 允许房主在测试时切换操控模拟玩家
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [aiThinking, setAiThinking] = useState(false);
  const [customThemeInput, setCustomThemeInput] = useState('');
  const [speakerKeyword, setSpeakerKeyword] = useState('');
  const [timeLeft, setTimeLeft] = useState(30);
  const [showRulesModal, setShowRulesModal] = useState(false);

  const lastSpokenMessageRef = useRef('');
  useEffect(() => {
    const hide = () => setIsPeekingCard(false);
    const visibility = () => { if (document.hidden) hide(); };
    window.addEventListener('pointerup',hide);
    window.addEventListener('pointercancel',hide);
    window.addEventListener('blur',hide);
    document.addEventListener('visibilitychange',visibility);
    return () => {
      window.removeEventListener('pointerup',hide);
      window.removeEventListener('pointercancel',hide);
      window.removeEventListener('blur',hide);
      document.removeEventListener('visibilitychange',visibility);
    };
  }, []);
  useEffect(() => { setIsPeekingCard(false); }, [activeControlId, activeRoomCode, roomData?.round, roomData?.status]);

  const reportError = err => setErrorMsg(err.message || '操作失败，请重试。');
  const perform = async (type, payload = {}) => {
    if (!user) throw new Error(setupError || '正在连接联机服务，请稍后重试。');
    return roomAction({ type, roomCode: activeRoomCode, phaseId: roomData?.phaseId, ...payload });
  };

  // ------------------------------------------
  // 初始化 Firebase Auth
  // ------------------------------------------
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (runtimeConfig.initialAuthToken) {
          await signInWithCustomToken(auth, runtimeConfig.initialAuthToken);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error('Auth error:', err);
        setErrorMsg('登录联机服务失败，请确认已开启匿名登录并重试。');
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u && !activeControlId) setActiveControlId(u.uid);
    });
    return () => unsubscribe();
  }, []);

  // ------------------------------------------
  // 监听当前房间 Firestore 数据实时同步
  // ------------------------------------------
  useEffect(() => {
    if (!user || !db || !activeRoomCode) return;

    setPublicRoom(null); setPrivateHand(null);
    const roomRef = doc(db, 'games', appId, 'rooms', activeRoomCode);
    const onError = err => {
      if (err.code === 'permission-denied') {
        setActiveRoomCode(''); setPublicRoom(null); setPrivateHand(null);
        setErrorMsg('你已离开房间，或房间已解散。');
      } else setErrorMsg('同步房间状态失败，请检查网络。');
    };
    const stopRoom = onSnapshot(roomRef, snapshot => {
      if (snapshot.exists()) setPublicRoom(snapshot.data());
      else { setActiveRoomCode(''); setPublicRoom(null); setPrivateHand(null); setErrorMsg('房间已解散或不存在。'); }
    }, onError);
    const stopHand = onSnapshot(doc(roomRef, 'hands', user.uid), snapshot => {
      setPrivateHand(snapshot.exists() ? snapshot.data() : null);
    }, onError);
    return () => { stopRoom(); stopHand(); };
  }, [user, activeRoomCode]);

  // ------------------------------------------
  // AI 裁判语音自动播报 (Web Speech API)
  // ------------------------------------------
  const speakText = (text) => {
    if (!ttsEnabled || !('speechSynthesis' in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 1.08;
      utterance.pitch = 1.05;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('TTS play failed:', e);
    }
  };

  useEffect(() => {
    if (roomData?.aiReferee?.message && roomData.aiReferee.message !== lastSpokenMessageRef.current) {
      lastSpokenMessageRef.current = roomData.aiReferee.message;
      speakText(roomData.aiReferee.message);
    }
  }, [roomData?.aiReferee?.message, ttsEnabled]);

  // ------------------------------------------
  // 发言阶段倒计时器
  // ------------------------------------------
  useEffect(() => {
    if (roomData?.status !== 'SPEAKING') return;
    const duration = roomData.pkPlayers?.length ? 20 : roomData?.settings?.speakTime || 30;
    const end = (roomData.turnStartedAt || Date.now()) + duration * 1000;
    const update = () => setTimeLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [roomData?.status, roomData?.currentSpeakerId, roomData?.round, roomData?.turnStartedAt]);

  // 当前操控的玩家身份（默认是自己，房主可切换操控同屏测试机器人）
  const effectivePlayerId = activeControlId || user?.uid;
  const myPlayer = roomData?.players?.find(p => p.id === effectivePlayerId) 
    || roomData?.players?.find(p => p.id === user?.uid);
  const isHost = roomData?.hostId === user?.uid;

  // ------------------------------------------
  // 创建房间与加入房间逻辑
  // ------------------------------------------
  const enterRoom = async (join) => {
    if (!nickname.trim()) { setErrorMsg('请先输入您的聚会昵称'); return; }
    if (join && !/^\d{4}$/.test(roomCodeInput.trim())) { setErrorMsg('请输入正确的 4 位数字房间号'); return; }
    setIsLoading(true); setErrorMsg('');
    try {
      const result = await perform(join ? 'JOIN' : 'CREATE', { roomCode: join ? roomCodeInput.trim() : '', name: nickname.trim(), avatar });
      setActiveControlId(user.uid); setActiveRoomCode(result.roomCode);
    } catch (err) { reportError(err); }
    finally { setIsLoading(false); }
  };
  const handleCreateRoom = () => enterRoom(false);
  const handleJoinRoom = () => enterRoom(true);
  const handleAddLocalPlayer = async () => {
    try { await perform('ADD_LOCAL'); } catch (err) { reportError(err); }
  };
  const handleRemovePlayer = async playerId => {
    try {
      await perform('REMOVE_PLAYER', { playerId });
      if (activeControlId === playerId) setActiveControlId(user.uid);
    } catch (err) { reportError(err); }
  };
  const handleUpdateSetting = async (key, value) => {
    try { await perform('SETTING', { key, value }); } catch (err) { reportError(err); }
  };
  const handleStartGame = async (useAI = false) => {
    if (aiThinking) return;
    setAiThinking(true); setErrorMsg('');
    try {
      await perform('START', { useAI, theme: customThemeInput.trim() });
      setActiveControlId(user.uid); setIsPeekingCard(false);
    } catch (err) { reportError(err); }
    finally { setAiThinking(false); }
  };
  const handleConfirmSeenCard = async () => {
    try {
      if (!myPlayer?.word) throw new Error('底牌正在同步，请稍后确认。');
      await perform('READY', { playerId: myPlayer.id }); setIsPeekingCard(false);
    } catch (err) { reportError(err); }
  };
  const startSpeakingRound = async () => {
    try { await perform('SPEAK'); } catch (err) { reportError(err); }
  };
  const handleFinishSpeaking = async () => {
    try {
      await perform('FINISH', { speakerId: roomData?.currentSpeakerId, keyword: speakerKeyword });
      setSpeakerKeyword('');
    } catch (err) { reportError(err); }
  };
  const handleCastVote = async targetId => {
    try { await perform('VOTE', { playerId: myPlayer?.id, targetId }); } catch (err) { reportError(err); }
  };
  const handleAutoVoteForSimulated = async () => {
    try { await perform('AUTO_VOTE'); } catch (err) { reportError(err); }
  };
  const tallyVotesAndResolve = async () => {
    try { await perform('TALLY'); } catch (err) { reportError(err); }
  };
  const handleAskAIRefereeComment = async () => {
    if (aiThinking) return;
    setAiThinking(true); setErrorMsg('');
    try { await perform('COMMENT'); } catch (err) { reportError(err); }
    finally { setAiThinking(false); }
  };
  const handleBackToLobby = async () => {
    try { await perform('LOBBY'); setIsPeekingCard(false); } catch (err) { reportError(err); }
  };

  // ==========================================
  // 界面渲染：未进入房间时的聚会大厅页
  // ==========================================
  if (!activeRoomCode || !roomData) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6 relative overflow-hidden select-none">
        {/* 霓虹聚会背景光晕 */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-32 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl" />
          <div className="absolute top-1/3 -right-32 w-96 h-96 bg-amber-500/15 rounded-full blur-3xl" />
          <div className="absolute -bottom-32 left-1/4 w-96 h-96 bg-rose-600/15 rounded-full blur-3xl" />
        </div>

        {/* 顶部栏 */}
        <header className="relative z-10 flex items-center justify-between max-w-lg mx-auto w-full pt-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 via-rose-500 to-violet-600 flex items-center justify-center shadow-lg shadow-rose-500/20">
              <Fingerprint className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-wider bg-gradient-to-r from-amber-200 via-white to-violet-200 bg-clip-text text-transparent">
                谁是卧底 · 聚会联机版
              </h1>
              <p className="text-xs text-slate-400">手机防窥发牌 & 投票器 + AI 语音裁判</p>
            </div>
          </div>
          <button
            onClick={() => setShowRulesModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/90 border border-slate-800 text-xs text-slate-300 hover:border-amber-500/50 transition"
          >
            <HelpCircle className="w-4 h-4 text-amber-400" />
            规则说明
          </button>
        </header>

        {/* 主体卡片 */}
        <main className="relative z-10 max-w-lg mx-auto w-full my-auto py-6 space-y-5">
          {/* AI 裁判迎宾横幅 */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-violet-950/80 via-slate-900/90 to-slate-900/80 border border-violet-500/30 shadow-xl flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shrink-0 shadow-md shadow-violet-500/30">
              <Bot className="w-7 h-7 text-white animate-pulse" />
            </div>
            <div className="text-xs sm:text-sm space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-violet-300">AI 金牌裁判</span>
                <span className="px-2 py-0.5 text-[10px] rounded-full bg-violet-500/20 text-violet-200 border border-violet-400/30">
                  解放房主 · 全员参战
                </span>
              </div>
              <p className="text-slate-300 leading-relaxed">
                “聚会再也不用牺牲一个人当法官啦！大家面对面坐好，用各自手机输入同一个 4 位房间号，我来负责发牌、计时、毒舌控场和计票！”
              </p>
            </div>
          </div>

          {/* 玩家个人形象设置 */}
          <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-5 shadow-2xl space-y-4">
            <h2 className="text-sm font-bold text-slate-300 flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-400" />
              第一步：定制你的聚会代号与头像
            </h2>

            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-800 border-2 border-amber-400/60 flex items-center justify-center text-3xl shrink-0 shadow-inner">
                {avatar}
              </div>
              <div className="flex-1">
                <label className="text-xs text-slate-400 block mb-1">你的聚会昵称</label>
                <input
                  type="text"
                  maxLength={10}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="输入昵称，如：微醺小王"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white font-medium focus:outline-none focus:border-amber-400 transition"
                />
              </div>
            </div>

            {/* 头像快速选择 */}
            <div className="grid grid-cols-6 gap-2 pt-1">
              {AVATARS.map((emo) => (
                <button
                  key={emo}
                  onClick={() => setAvatar(emo)}
                  className={`py-2 rounded-xl text-xl flex items-center justify-center transition ${
                    avatar === emo
                      ? 'bg-amber-500/20 border-2 border-amber-400 scale-105'
                      : 'bg-slate-950/60 border border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  {emo}
                </button>
              ))}
            </div>
          </div>

          {/* 创建或加入房间 */}
          <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-5 shadow-2xl space-y-4">
            <h2 className="text-sm font-bold text-slate-300 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400" />
              第二步：创建新局 或 加入好友房间
            </h2>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              onClick={handleCreateRoom}
              disabled={isLoading || !user}
              className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 text-slate-950 font-black text-base shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition active:scale-[0.99] disabled:opacity-50"
            >
              <Crown className="w-5 h-5" />
              {isLoading ? '正在布置聚会桌...' : '我是组织者 · 创建聚会房间'}
            </button>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-slate-800"></div>
              <span className="flex-shrink mx-3 text-xs text-slate-500">或者输入桌上的 4 位房间号</span>
              <div className="flex-grow border-t border-slate-800"></div>
            </div>

            <div className="flex gap-2.5">
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.replace(/\D/g, ''))}
                placeholder="输入4位房间号"
                className="flex-1 px-4 py-3 rounded-2xl bg-slate-950 border border-slate-700 text-center text-lg font-mono tracking-widest text-amber-300 placeholder:text-slate-600 placeholder:text-sm placeholder:tracking-normal focus:outline-none focus:border-violet-400"
              />
              <button
                onClick={() => handleJoinRoom()}
                disabled={isLoading || !user || roomCodeInput.length !== 4}
                className="px-6 py-3 rounded-2xl bg-violet-600 hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-sm transition flex items-center gap-1.5 shrink-0"
              >
                加入房间
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </main>

        {/* 底部说明 */}
        <footer className="relative z-10 text-center text-xs text-slate-500 pb-2">
          支持多手机实时联机 · 支持单手机同屏传阅与快速测试
        </footer>

        {/* 规则说明弹窗 */}
        {showRulesModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 space-y-4 text-sm text-slate-300 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Award className="w-5 h-5 text-amber-400" />
                  线下聚会《谁是卧底》玩法指南
                </h3>
                <button onClick={() => setShowRulesModal(false)} className="text-slate-400 hover:text-white">✕</button>
              </div>
              <div className="space-y-3 leading-relaxed text-xs sm:text-sm">
                <p><strong className="text-amber-300">1. 秘密看牌：</strong>全员入座后，手机会收到一张防窥底牌。大多数人拿到相同的<span className="text-emerald-400">【平民词】</span>，1~2人拿到相似的<span className="text-rose-400">【卧底词】</span>（拿到牌时你不知道自己是平民还是卧底！）。</p>
                <p><strong className="text-amber-300">2. 面对面轮流发言：</strong>按照 AI 裁判点名的座位顺序，大家<strong>直接在线下开口</strong>用一句话描述自己的词。既要让队友听懂，又不能太直白让卧底猜出，更<strong>禁止直接报出词里的字</strong>！</p>
                <p><strong className="text-amber-300">3. 手机秘密投票：</strong>每轮发言结束，所有人用自己手机点击最可疑的玩家头像投票。得票最高者出局并由 AI 裁判揭晓身份。</p>
                <p><strong className="text-amber-300">4. 胜负条件：</strong>把所有卧底投出局则<strong>平民获胜</strong>；若卧底存活到场上只剩 2~3 人（或平民人数 ≤ 卧底人数），则<strong>卧底逆袭获胜</strong>！</p>
              </div>
              <button
                onClick={() => setShowRulesModal(false)}
                className="w-full py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold"
              >
                明白啦，开始组局！
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // 界面渲染：房间内主界面 (含 AI 裁判舞台 + 5大阶段流转)
  // ==========================================
  const aliveCount = roomData.players.filter(p => p.isAlive).length;
  const aliveUndercoverCount = roomData.aliveUndercoverCount || 0;
  const currentSpeaker = roomData.players.find(p => p.id === roomData.currentSpeakerId);
  const hasSimulatedPlayers = roomData.players.some(p => p.isSimulated);
  const controllablePlayers = roomData.players.filter(p=>p.id===user?.uid || isHost && p.isSimulated);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between pb-6 select-none">
      {/* 顶部房间导航与状态条 */}
      <header className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-4 py-2.5">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="px-3 py-1 rounded-xl bg-amber-500/15 border border-amber-400/40 flex items-center gap-1.5">
              <span className="text-[11px] text-amber-300/80">房号</span>
              <span className="font-mono font-black text-base text-amber-300 tracking-wider">
                {roomData.roomCode}
              </span>
            </div>
            {roomData.status !== 'LOBBY' && (
              <div className="hidden sm:flex items-center gap-2 text-xs px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-400">第 <strong className="text-white">{roomData.round}</strong> 轮</span>
                <span className="text-slate-700">|</span>
                <span className="text-emerald-400">存活 {aliveCount} 人</span>
                <span className="text-slate-700">|</span>
                <span className="text-rose-400">潜伏者 {aliveUndercoverCount} 人</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* 语音播报开关 */}
            <button
              onClick={() => setTtsEnabled(!ttsEnabled)}
              className={`px-2.5 py-1.5 rounded-xl border text-xs flex items-center gap-1 transition ${
                ttsEnabled
                  ? 'bg-violet-500/20 border-violet-400/40 text-violet-200'
                  : 'bg-slate-900 border-slate-800 text-slate-500'
              }`}
              title="切换 AI 裁判语音外放"
            >
              {ttsEnabled ? <Volume2 className="w-4 h-4 text-violet-400" /> : <VolumeX className="w-4 h-4" />}
              <span className="hidden sm:inline">{ttsEnabled ? 'AI语音开启' : '静音'}</span>
            </button>

            <button
              onClick={() => setShowRulesModal(true)}
              className="p-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            <button
              onClick={() => {
                setActiveRoomCode('');
                setPublicRoom(null); setPrivateHand(null);
              }}
              className="p-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-400"
              title="离开房间"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 同屏玩家视角切换栏（当房间内添加了同屏模拟玩家时显示，极度方便单机测试与传阅手机） */}
        {hasSimulatedPlayers && isHost && (
          <div className="max-w-2xl mx-auto mt-2 pt-2 border-t border-slate-800/80 flex items-center gap-2 overflow-x-auto no-scrollbar">
            <span className="text-[11px] text-amber-400 shrink-0 font-semibold flex items-center gap-1">
              <Zap className="w-3.5 h-3.5" />
              当前手机操控视角:
            </span>
            {controllablePlayers.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setActiveControlId(p.id);
                  setIsPeekingCard(false);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 flex items-center gap-1 transition ${
                  myPlayer?.id === p.id
                    ? 'bg-amber-400 text-slate-950 font-bold shadow'
                    : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
                }`}
              >
                <span>{p.avatar}</span>
                <span>{p.seat}号 {p.name}</span>
                {!p.isAlive && <span className="text-[10px] text-rose-500">(出局)</span>}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* 主内容容器 */}
      <main className="max-w-2xl mx-auto w-full px-4 pt-4 space-y-4 flex-1">
        {/* ==========================================
            模块 A: AI 裁判中央控场舞台 (常驻)
           ========================================== */}
        <section className="relative rounded-3xl bg-gradient-to-br from-violet-950/90 via-slate-900 to-slate-900 border border-violet-500/40 p-4 shadow-xl overflow-hidden">
          <div className="flex items-start gap-3.5">
            <div className="relative shrink-0">
              <div className="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-amber-500 p-0.5 shadow-lg shadow-violet-500/30">
                <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
                  <Bot className={`w-7 h-7 text-violet-300 ${aiThinking ? 'animate-spin' : 'animate-bounce'}`} />
                </div>
              </div>
              <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 text-[9px] font-bold bg-amber-400 text-slate-950 rounded-md">
                AI 裁判
              </span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-violet-300">
                    本场 AI 控场主持 ({roomData.settings?.aiStyle || '幽默毒舌'})
                  </span>
                  {roomData.wordPair?.source && roomData.status !== 'LOBBY' && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                      {roomData.wordPair.source}
                    </span>
                  )}
                </div>

                {roomData.status !== 'LOBBY' && (
                  <button
                    onClick={handleAskAIRefereeComment}
                    disabled={aiThinking}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/40 text-violet-200 flex items-center gap-1 shrink-0 transition"
                  >
                    <Sparkles className="w-3 h-3 text-amber-300" />
                    {aiThinking ? 'AI思考中...' : '求线索/毒舌点评'}
                  </button>
                )}
              </div>

              <p className="text-sm sm:text-base text-white font-medium leading-snug">
                “{roomData.aiReferee?.message || '欢迎来到谁是卧底聚会现场！'}”
              </p>
            </div>
          </div>
        </section>

        {/* 错误提示横幅 */}
        {errorMsg && (
          <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg('')} className="text-rose-300 hover:text-white">✕</button>
          </div>
        )}

        {/* ==========================================
            模块 B: 房间外围座位环形网格 (实时反映状态)
           ========================================== */}
        <section className="bg-slate-900/80 border border-slate-800 rounded-3xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-amber-400" />
              聚会圆桌座位 ({roomData.players.length}人)
            </h3>

            {roomData.status === 'LOBBY' && isHost && (
              <button
                onClick={handleAddLocalPlayer}
                className="px-3 py-1 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-1 transition"
              >
                <UserPlus className="w-3.5 h-3.5" />
                + 添加同屏玩家/测试补位
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
            {roomData.players.map((p) => {
              const isMe = p.id === myPlayer?.id;
              const isCurrentSpeaker = roomData.status === 'SPEAKING' && roomData.currentSpeakerId === p.id;
              const hasVoted = roomData.status === 'VOTING' && roomData.votes?.[p.id] !== undefined;
              const isPKCandidate = roomData.pkPlayers?.includes(p.id);
              const myVoteTarget = roomData.votes?.[myPlayer?.id];

              // 计算在投票阶段是否可点击该玩家进行投票
              const canVoteThisPlayer =
                roomData.status === 'VOTING' &&
                myPlayer?.isAlive &&
                p.isAlive &&
                p.id !== myPlayer.id &&
                (roomData.pkPlayers?.length === 0 || isPKCandidate);

              return (
                <div
                  key={p.id}
                  onClick={() => {
                    if (canVoteThisPlayer) handleCastVote(p.id);
                  }}
                  className={`relative rounded-2xl p-3 border transition flex flex-col items-center text-center ${
                    !p.isAlive
                      ? 'bg-slate-950/60 border-slate-800/60 opacity-50 grayscale'
                      : isCurrentSpeaker
                      ? 'bg-amber-500/15 border-2 border-amber-400 shadow-lg shadow-amber-500/20 scale-[1.02]'
                      : myVoteTarget === p.id && roomData.status === 'VOTING'
                      ? 'bg-rose-500/20 border-2 border-rose-500 shadow-lg shadow-rose-500/20'
                      : canVoteThisPlayer
                      ? 'bg-slate-950/90 border-slate-700 hover:border-rose-400 cursor-pointer active:scale-95'
                      : 'bg-slate-950/80 border-slate-800'
                  }`}
                >
                  {/* 座位号角标 */}
                  <span className={`absolute top-2 left-2 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold ${
                    isCurrentSpeaker ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300'
                  }`}>
                    {p.seat}号
                  </span>

                  {/* 房主删除按钮 (仅大厅阶段) */}
                  {roomData.status === 'LOBBY' && isHost && p.id !== user.uid && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemovePlayer(p.id);
                      }}
                      className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-slate-800 text-slate-400 hover:text-rose-400 text-xs flex items-center justify-center"
                      title="移出座位"
                    >
                      ✕
                    </button>
                  )}

                  {/* 状态小徽章 */}
                  {roomData.status === 'DEALING' && (
                    <span className={`absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded ${
                      p.hasReadySeenCard ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                    }`}>
                      {p.hasReadySeenCard ? '已看牌' : '看牌中'}
                    </span>
                  )}

                  {roomData.status === 'VOTING' && p.isAlive && (
                    <span className={`absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded ${
                      hasVoted ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'
                    }`}>
                      {hasVoted ? '已投' : '思考中'}
                    </span>
                  )}

                  {/* 头像 */}
                  <div className="text-3xl my-1 relative">
                    {p.avatar}
                    {isCurrentSpeaker && (
                      <span className="absolute -bottom-1 -right-2 w-5 h-5 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center shadow">
                        <Mic className="w-3 h-3 animate-pulse" />
                      </span>
                    )}
                    {!p.isAlive && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <Skull className="w-7 h-7 text-rose-500 drop-shadow" />
                      </span>
                    )}
                  </div>

                  {/* 昵称与自我标识 */}
                  <div className="text-xs font-bold text-slate-200 truncate w-full mt-0.5">
                    {p.name}
                  </div>
                  <div className="flex items-center justify-center gap-1 mt-0.5">
                    {isMe && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-400/20 text-amber-300 font-semibold">
                        当前视角
                      </span>
                    )}
                    {isPKCandidate && roomData.status !== 'LOBBY' && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-500/30 text-rose-300 font-bold">
                        PK台
                      </span>
                    )}
                  </div>

                  {/* 历史发言备忘标签（如果有） */}
                  {p.notes?.length > 0 && (
                    <div className="mt-1.5 w-full text-[10px] text-slate-400 bg-slate-900 px-1.5 py-1 rounded truncate">
                      “{p.notes[p.notes.length - 1]}”
                    </div>
                  )}

                  {/* 投票阶段点击提示 */}
                  {canVoteThisPlayer && (
                    <div className="mt-2 w-full py-1 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[11px] font-bold">
                      {myVoteTarget === p.id ? '✓ 已锁定投TA' : '投TA出局'}
                    </div>
                  )}

                  {/* 游戏结束或出局后公开身份 */}
                  {(!p.isAlive || roomData.status === 'GAME_OVER') && p.role && (
                    <div className={`mt-1.5 px-2 py-0.5 rounded text-[10px] font-bold ${
                      p.role === 'CIVILIAN'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : p.role === 'UNDERCOVER'
                        ? 'bg-rose-500/30 text-rose-300'
                        : 'bg-violet-500/30 text-violet-200'
                    }`}>
                      {p.role === 'CIVILIAN' ? '平民' : p.role === 'UNDERCOVER' ? '卧底' : '白板'}
                      {roomData.status === 'GAME_OVER' && p.role !== 'BLANK' && ` · ${p.word}`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ==========================================
            模块 C: 阶段专属核心控制台
           ========================================== */}

        {/* 1. LOBBY 大厅准备与房主配置阶段 */}
        {roomData.status === 'LOBBY' && (
          <section className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Settings className="w-4 h-4 text-amber-400" />
                  聚会本局规则与词库配置
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  请把房间号 <strong className="text-amber-300 font-mono">{roomData.roomCode}</strong> 告诉身边的朋友，或者直接点击上方“+ 添加同屏玩家”立刻开玩
                </p>
              </div>
            </div>

            {/* 配置项列表 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              {/* 词库分类选择 */}
              <div className="space-y-1.5">
                <label className="text-slate-400 font-semibold">精选词库主题</label>
                <div className="grid grid-cols-1 gap-2">
                  {Object.entries(WORD_LIBRARY).map(([key, cat]) => (
                    <button
                      key={key}
                      disabled={!isHost}
                      onClick={() => handleUpdateSetting('category', key)}
                      className={`px-3 py-2.5 rounded-xl border text-left font-medium flex items-center justify-between transition ${
                        roomData.settings?.category === key
                          ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      <span>{cat.name}</span>
                      {roomData.settings?.category === key && <CheckCircle2 className="w-4 h-4 text-amber-400" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* 卧底数量、白板与AI裁判风格 */}
              <div className="space-y-3">
                <div>
                  <label className="text-slate-400 font-semibold block mb-1.5">卧底人数配置</label>
                  <div className="flex gap-2">
                    {[1, 2, 3].map((num) => (
                      <button
                        key={num}
                        disabled={!isHost}
                        onClick={() => handleUpdateSetting('undercoverCount', num)}
                        className={`flex-1 py-2 rounded-xl border font-bold ${
                          roomData.settings?.undercoverCount === num
                            ? 'bg-rose-500/20 border-rose-400 text-rose-300'
                            : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}
                      >
                        {num} 名卧底
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-slate-400 font-semibold block mb-1.5">刺激玩法：混入“白板”角色 (5人以上生效)</label>
                  <button
                    disabled={!isHost}
                    onClick={() => handleUpdateSetting('hasBlank', !roomData.settings?.hasBlank)}
                    className={`w-full py-2 px-3 rounded-xl border flex items-center justify-between ${
                      roomData.settings?.hasBlank
                        ? 'bg-violet-500/20 border-violet-400 text-violet-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <span>白板玩家拿到空白牌，全凭听别人发言盲猜词义</span>
                    <span className="font-bold">{roomData.settings?.hasBlank ? '已开启' : '关闭'}</span>
                  </button>
                </div>

                <div>
                  <label className="text-slate-400 font-semibold block mb-1.5">AI 裁判主持性格</label>
                  <div className="flex gap-2">
                    {['幽默毒舌', '悬疑推理', '欢乐气氛组'].map((st) => (
                      <button
                        key={st}
                        disabled={!isHost}
                        onClick={() => handleUpdateSetting('aiStyle', st)}
                        className={`flex-1 py-2 rounded-xl border font-medium ${
                          roomData.settings?.aiStyle === st
                            ? 'bg-violet-500/20 border-violet-400 text-violet-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* AI 实时命题输入框 */}
            {isHost && (
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-violet-500/30 space-y-2">
                <label className="text-xs font-bold text-violet-300 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  不想玩固定词库？让 AI 裁判根据你们的圈子现场出题：
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customThemeInput}
                    onChange={(e) => setCustomThemeInput(e.target.value)}
                    placeholder="可选输入出题方向，如：互联网大厂、周杰伦、广东美食..."
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-violet-400"
                  />
                  <button
                    onClick={() => handleStartGame(true)}
                    disabled={aiThinking || roomData.players.length < 4}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 disabled:opacity-40 text-white text-xs font-bold shrink-0 flex items-center gap-1.5 shadow-lg shadow-violet-600/20"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {aiThinking ? 'AI出题发牌中...' : 'AI 现场命题开局'}
                  </button>
                </div>
              </div>
            )}

            {/* 开局主按钮 */}
            {isHost ? (
              <button
                onClick={() => handleStartGame(false)}
                disabled={aiThinking || roomData.players.length < 4}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500 hover:from-amber-300 hover:to-rose-400 disabled:opacity-40 text-slate-950 font-black text-base shadow-xl shadow-amber-500/20 flex items-center justify-center gap-2 transition"
              >
                <Play className="w-5 h-5 fill-current" />
                {roomData.players.length < 4
                  ? `还差 ${4 - roomData.players.length} 人开局 (可点上方“+ 添加同屏玩家”)`
                  : `立即发牌开局 (${roomData.players.length}人局)`}
              </button>
            ) : (
              <div className="text-center py-3 rounded-2xl bg-slate-950 border border-slate-800 text-sm text-amber-300 animate-pulse">
                等待房主配置词库并点击开始发牌...
              </div>
            )}
          </section>
        )}

        {/* 2. DEALING 防窥发牌与看牌阶段 */}
        {roomData.status === 'DEALING' && myPlayer && (
          <section className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 text-center space-y-5 shadow-2xl">
            <div className="space-y-1">
              <span className="px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 text-xs font-bold">
                秘密发牌阶段 · 注意四周防窥屏
              </span>
              <h2 className="text-lg font-black text-white pt-1">
                当前拿牌人：{myPlayer.seat}号 【{myPlayer.name}】
              </h2>
              <p className="text-xs text-slate-400">
                为防止卧底过早紧张，底牌只显示你的词语，不标注你是平民还是卧底
              </p>
            </div>

            {/* 防窥翻转底牌 */}
            <div
              onPointerDown={e => {e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);setIsPeekingCard(true)}}
              onPointerUp={() => setIsPeekingCard(false)}
              onPointerCancel={() => setIsPeekingCard(false)}
              onContextMenu={e=>e.preventDefault()}
              style={{touchAction:'none'}}
              className={`max-w-xs mx-auto h-48 rounded-3xl border-2 transition-all duration-200 cursor-pointer flex flex-col items-center justify-center p-6 select-none shadow-2xl ${
                isPeekingCard
                  ? 'bg-gradient-to-br from-amber-500/20 via-slate-900 to-rose-500/20 border-amber-400 scale-[1.02]'
                  : 'bg-gradient-to-br from-slate-800 to-slate-950 border-slate-700 hover:border-amber-400/50'
              }`}
            >
              {isPeekingCard ? (
                <div className="space-y-2 animate-fadeIn">
                  <Eye className="w-7 h-7 text-amber-400 mx-auto" />
                  <div className="text-xs text-slate-400">你的本局秘密底牌是：</div>
                  <div className="text-3xl font-black tracking-widest text-amber-300 py-1">
                    {myPlayer.word || '正在同步底牌…'}
                  </div>
                  <div className="text-[11px] text-slate-400">松开立即隐藏</div>
                </div>
              ) : (
                <div className="space-y-2">
                  <EyeOff className="w-9 h-9 text-slate-400 mx-auto" />
                  <div className="text-base font-bold text-slate-200">按住偷看底牌</div>
                  <div className="text-xs text-slate-500">请捂好手机屏幕，谨防旁边偷瞄</div>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-md mx-auto">
              <button
                onClick={handleConfirmSeenCard}
                disabled={myPlayer.hasReadySeenCard}
                className="flex-1 py-3.5 px-6 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-slate-950 font-black text-sm shadow-lg transition"
              >
                {myPlayer.hasReadySeenCard ? '✓ 已记住词语，等待其他人...' : '我已记住词语，准备发言！'}
              </button>

              {isHost && (
                <button
                  onClick={() => startSpeakingRound(roomData.players, 1, [])}
                  className="py-3.5 px-5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold border border-amber-500/30"
                >
                  房主直接开启第1轮发言 →
                </button>
              )}
            </div>
          </section>
        )}

        {/* 3. SPEAKING 线下轮流发言与 AI 计时控场阶段 */}
        {roomData.status === 'SPEAKING' && (
          <section className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 text-xs font-bold flex items-center gap-1">
                  <Mic className="w-3.5 h-3.5 animate-pulse" />
                  {roomData.pkPlayers?.length > 0 ? '平票 PK 加赛发言' : `第 ${roomData.round} 轮 · 线下口头描述`}
                </span>
              </div>

              {/* 倒计时器 */}
              <div className={`px-3 py-1 rounded-full font-mono text-sm font-black flex items-center gap-1.5 ${
                timeLeft <= 8 ? 'bg-rose-500/20 text-rose-400 animate-pulse' : 'bg-slate-950 text-amber-300'
              }`}>
                <Clock className="w-4 h-4" />
                {timeLeft}s
              </div>
            </div>

            {/* 当前发言人聚光灯卡片 */}
            {currentSpeaker && (
              <div className="p-5 rounded-2xl bg-gradient-to-r from-amber-500/10 via-slate-950 to-amber-500/10 border border-amber-500/40 text-center space-y-2">
                <div className="text-4xl">{currentSpeaker.avatar}</div>
                <div className="text-lg font-black text-white">
                  请 <span className="text-amber-300">{currentSpeaker.seat}号【{currentSpeaker.name}】</span> 线下开口描述
                </div>
                <p className="text-xs text-slate-400">
                  禁忌：不能直接说出手中词语包含的单字，不能直接照抄上一位玩家的原话
                </p>
              </div>
            )}

            {/* 可选关键词备忘 & 发言完毕按钮 */}
            {(myPlayer?.id === roomData.currentSpeakerId || isHost) ? (
              <div className="space-y-3 pt-1">
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={25}
                    value={speakerKeyword}
                    onChange={(e) => setSpeakerKeyword(e.target.value)}
                    placeholder="可选：记录TA刚说的关键词（方便大家投票复盘 & 供AI裁判点评）"
                    className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-amber-400"
                  />
                </div>
                <button
                  onClick={handleFinishSpeaking}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 font-black text-sm shadow-lg flex items-center justify-center gap-2 transition"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  {currentSpeaker?.seat}号【{currentSpeaker?.name}】线下发言完毕，下一位！
                </button>
              </div>
            ) : (
              <div className="text-center py-3 rounded-2xl bg-slate-950 border border-slate-800 text-xs text-slate-400">
                请认真倾听 <strong className="text-amber-300">{currentSpeaker?.seat}号 {currentSpeaker?.name}</strong> 的线下发言...
              </div>
            )}
          </section>
        )}

        {/* 4. VOTING 手机秘密投票器阶段 */}
        {roomData.status === 'VOTING' && (
          <section className="bg-slate-900/90 border border-rose-500/40 rounded-3xl p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <h3 className="text-base font-black text-rose-300 flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-rose-400" />
                  全民手机秘密投票阶段
                </h3>
                <p className="text-xs text-slate-400">
                  请直接点击上方【聚会圆桌座位】中你最怀疑的玩家头像进行投票！
                </p>
              </div>

              <span className="px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 text-xs font-bold">
                已投 {Object.keys(roomData.votes || {}).length} / {aliveCount}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
              {myPlayer?.isAlive ? (
                <button
                  onClick={() => handleCastVote('ABSTAIN')}
                  className={`px-4 py-2.5 rounded-xl border text-xs font-bold transition ${
                    roomData.votes?.[myPlayer.id] === 'ABSTAIN'
                      ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                      : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {roomData.votes?.[myPlayer.id] === 'ABSTAIN' ? '✓ 已选择弃权不投' : '实在听不出 · 本轮弃票'}
                </button>
              ) : (
                <span className="text-xs text-slate-500">你已出局，正在上帝视角围观大家投票...</span>
              )}

              <div className="flex items-center gap-2">
                {isHost && hasSimulatedPlayers && (
                  <button
                    onClick={handleAutoVoteForSimulated}
                    className="px-3.5 py-2.5 rounded-xl bg-violet-600/30 hover:bg-violet-600/50 border border-violet-400/40 text-violet-200 text-xs font-bold"
                  >
                    🤖 替同屏测试玩家自动投票
                  </button>
                )}

                {isHost && Object.keys(roomData.votes || {}).length > 0 && (
                  <button
                    onClick={() => tallyVotesAndResolve(roomData.votes || {})}
                    className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
                  >
                    立即截止并开票 →
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {/* 5. RESULT 单轮处决结果公布阶段 */}
        {roomData.status === 'RESULT' && (
          <section className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 text-center space-y-4 shadow-xl">
            {roomData.lastEliminated?.type === 'ELIMINATED' ? (
              <>
                <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-4xl mx-auto">
                  {roomData.lastEliminated.player.avatar}
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-rose-400 font-bold uppercase">
                    本轮最高票（{roomData.lastEliminated.votesCount} 票）出局
                  </div>
                  <h3 className="text-xl font-black text-white">
                    {roomData.lastEliminated.player.seat}号 【{roomData.lastEliminated.player.name}】
                  </h3>
                  <p className="text-sm text-slate-300 pt-1">
                    经 AI 裁判核实，TA 的真实身份是 ——{' '}
                    <span className={`px-2.5 py-0.5 rounded-lg font-black ${
                      roomData.lastEliminated.roleLabel === '平民'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/30 text-rose-300'
                    }`}>
                      【{roomData.lastEliminated.roleLabel}】
                    </span>
                  </p>
                </div>
              </>
            ) : (
              <div className="space-y-2 py-2">
                <div className="text-lg font-black text-amber-300">
                  {roomData.lastEliminated?.reason || '本轮无人出局'}
                </div>
              </div>
            )}

            {isHost ? (
              <button
                onClick={() => startSpeakingRound(roomData.players, (roomData.round || 1) + 1, [])}
                className="w-full max-w-sm mx-auto py-3.5 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-sm shadow-lg flex items-center justify-center gap-2"
              >
                进入第 {(roomData.round || 1) + 1} 轮线下发言 →
              </button>
            ) : (
              <div className="text-xs text-slate-400">等待房主开启下一轮发言...</div>
            )}
          </section>
        )}

        {/* 6. GAME_OVER 真相大白与底牌揭晓结算阶段 */}
        {roomData.status === 'GAME_OVER' && (
          <section className="bg-gradient-to-br from-slate-900 via-slate-900 to-violet-950/80 border-2 border-amber-400/60 rounded-3xl p-6 text-center space-y-5 shadow-2xl">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-400/20 border border-amber-400/40 text-amber-300 text-xs font-black">
              <Crown className="w-4 h-4" />
              本局真相大白
            </div>

            <h2 className="text-2xl sm:text-3xl font-black text-white">
              {roomData.winner === 'CIVILIAN' ? '🎉 平民阵营 获胜！' : '🕵️‍♂️ 卧底阵营 逆袭获胜！'}
            </h2>

            {/* 双方词语揭秘卡 */}
            <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
              <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30">
                <div className="text-xs text-emerald-400 font-bold">平民词</div>
                <div className="text-xl font-black text-white mt-1">{roomData.wordPair?.civilian}</div>
              </div>
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30">
                <div className="text-xs text-rose-400 font-bold">卧底词</div>
                <div className="text-xl font-black text-white mt-1">{roomData.wordPair?.undercover}</div>
              </div>
            </div>

            {isHost ? (
              <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                <button
                  onClick={() => handleStartGame(false)}
                  className="flex-1 py-3.5 px-5 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-sm shadow-lg flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  再来一局（换新词直接发牌）
                </button>
                <button
                  onClick={handleBackToLobby}
                  className="py-3.5 px-5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs"
                >
                  返回房间调整设置
                </button>
              </div>
            ) : (
              <div className="text-xs text-amber-300">等待房主开启下一局...</div>
            )}
          </section>
        )}

        {/* ==========================================
            模块 D: 底部随身防窥底牌抽屉 (游戏进行中常驻)
           ========================================== */}
        {roomData.status !== 'LOBBY' && roomData.status !== 'DEALING' && myPlayer && (
          <section className="pt-1">
            <div className="rounded-2xl bg-slate-900/95 border border-slate-800 p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">{myPlayer.avatar}</span>
                <div>
                  <div className="text-xs font-bold text-slate-200">
                    {myPlayer.seat}号 {myPlayer.name} {myPlayer.isAlive ? '' : '(已出局)'}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    忘了自己的词？长按右侧按钮偷看底牌
                  </div>
                </div>
              </div>

              <button
                onPointerDown={e => {e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);setIsPeekingCard(true)}}
                onPointerUp={() => setIsPeekingCard(false)}
                onPointerCancel={() => setIsPeekingCard(false)}
                onContextMenu={e=>e.preventDefault()}
                style={{touchAction:'none'}}
                className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition shrink-0 ${
                  isPeekingCard
                    ? 'bg-amber-400 text-slate-950 shadow-lg shadow-amber-400/20'
                    : 'bg-slate-800 text-amber-300 border border-amber-500/30'
                }`}
              >
                {isPeekingCard ? (
                  <>
                    <Eye className="w-4 h-4" />
                    <span>底牌：{myPlayer.word || '正在同步底牌…'}</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="w-4 h-4" />
                    <span>按住偷看底牌</span>
                  </>
                )}
              </button>
            </div>
          </section>
        )}
      </main>

      {/* 规则弹窗复用 */}
      {showRulesModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 space-y-4 text-sm text-slate-300 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-400" />
                线下聚会《谁是卧底》玩法指南
              </h3>
              <button onClick={() => setShowRulesModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="space-y-3 leading-relaxed text-xs sm:text-sm">
              <p><strong className="text-amber-300">1. 秘密看牌：</strong>全员入座后，手机会收到一张防窥底牌。大多数人拿到相同的<span className="text-emerald-400">【平民词】</span>，1~2人拿到相似的<span className="text-rose-400">【卧底词】</span>。</p>
              <p><strong className="text-amber-300">2. 面对面轮流发言：</strong>按照 AI 裁判点名的座位顺序，大家<strong>直接在线下开口</strong>用一句话描述自己的词。禁止直接报出词里的单字！</p>
              <p><strong className="text-amber-300">3. 手机秘密投票：</strong>每轮发言结束，所有人用自己手机点击最可疑的玩家头像投票。得票最高者出局并由 AI 裁判揭晓身份。</p>
              <p><strong className="text-amber-300">4. 单机/同屏传阅技巧：</strong>如果有人没带手机或您想单人测试，房主可点击“+ 添加同屏玩家”，并通过顶部的【当前手机操控视角】随时切换不同座位看牌与投票！</p>
            </div>
            <button
              onClick={() => setShowRulesModal(false)}
              className="w-full py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
