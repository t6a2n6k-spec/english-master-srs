import React, { useState, useEffect, useRef } from 'react';
import { supabase, subscribeToPush } from './supabaseClient';
import confetti from 'canvas-confetti';
import { 
  Volume2, CheckCircle2, XCircle, Sparkles, PlusCircle, 
  RefreshCw, Bell, LogOut, MessageSquareText, Send, BookmarkPlus,
  Upload, Wand2, Database, Search, Trash2, Flame
} from 'lucide-react';

export default function App() {
  const [user, setUser] = useState(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'
  const [loading, setLoading] = useState(false);

  // 分頁狀態：'review' | 'coach' | 'library' | 'add'
  const [activeTab, setActiveTab] = useState('review'); 
  const [reviewMode, setReviewMode] = useState('due'); // 'due' (SRS到期) | 'today' (今日加固)
  const [cards, setCards] = useState([]);
  const [currentCard, setCurrentCard] = useState(null);
  const [clozeSentence, setClozeSentence] = useState('');
  const [userInput, setUserInput] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [isCheckingCloze, setIsCheckingCloze] = useState(false);

  // 翻譯教練狀態
  const [coachScenario, setCoachScenario] = useState('');
  const [coachTargetWord, setCoachTargetWord] = useState('');
  const [coachTargetMeaning, setCoachTargetMeaning] = useState('');
  const [coachUserInput, setCoachUserInput] = useState('');
  const [coachFeedback, setCoachFeedback] = useState('');
  const [isGeneratingCoach, setIsGeneratingCoach] = useState(false);
  const [isEvaluatingCoach, setIsEvaluatingCoach] = useState(false);

  // 字卡庫總覽狀態
  const [searchQuery, setSearchQuery] = useState('');
  const [filterBox, setFilterBox] = useState('all'); // 'all' | 1 | 2 | 3 | 4 | 5

  // 新增字卡表單狀態
  const [newWord, setNewWord] = useState('');
  const [newMeaning, setNewMeaning] = useState('');
  const [newSentence, setNewSentence] = useState('');
  const [newPronun, setNewPronun] = useState('');
  const [isAutoFilling, setIsAutoFilling] = useState(false);

  const fileInputRef = useRef(null);
  const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

  // 取得本地時區的 YYYY-MM-DD (徹底解決跨午夜時區延遲 Bug)
  const getTodayStr = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // 1. 監聽登入狀態
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // 2. 登入後抓取字卡
  useEffect(() => {
    if (user) {
      fetchCards();
    }
  }, [user]);

  // 循環分頁抓取全部資料
  const fetchCards = async () => {
    setLoading(true);
    let allCards = [];
    let from = 0;
    const step = 1000;
    let hasMore = true;

    try {
      while (hasMore) {
        const { data, error } = await supabase
          .from('flashcards')
          .select('*')
          .order('created_at', { ascending: false })
          .range(from, from + step - 1);

        if (error) throw error;

        if (data && data.length > 0) {
          allCards = [...allCards, ...data];
          if (data.length < step) {
            hasMore = false;
          } else {
            from += step;
          }
        } else {
          hasMore = false;
        }
      }

      setCards(allCards);

      // 只有在目前完全沒有選題時才抽題
      setCurrentCard((prevCard) => {
        if (!prevCard && allCards.length > 0) {
          pickNextCard(allCards, reviewMode);
        }
        return prevCard;
      });

    } catch (err) {
      console.error("載入字卡失敗:", err);
    } finally {
      setLoading(false);
    }
  };

  // 3. 挑選下一張字卡 (重點功能：按錯誤次數降序排列，錯越多次越優先出現！)
  const pickNextCard = (cardList, mode = reviewMode) => {
    const list = cardList || cards;
    if (!list || list.length === 0) {
      setCurrentCard(null);
      setClozeSentence('');
      return;
    }

    const todayStr = getTodayStr();
    let targetList = [];

    if (mode === 'today') {
      targetList = list.filter(card => card.last_review_date === todayStr);
    } else {
      targetList = list.filter(card => {
        if (!card.last_review_date) return true;
        const diffDays = Math.floor((new Date(todayStr) - new Date(card.last_review_date)) / (1000 * 3600 * 24));
        const intervals = { 1: 1, 2: 3, 3: 7, 4: 30, 5: 90 };
        return diffDays >= (intervals[card.box] || 1);
      });
    }

    if (targetList.length === 0) {
      setCurrentCard(null);
      setClozeSentence(mode === 'today' ? '🎉 今日尚未有已複習的字卡！' : '🎉 所有到期字卡皆已複習完畢！');
      return;
    }

    // 🎯 核心優先度排序：錯誤次數越多 (error_count 越大) 排越前面！
    const sortedList = [...targetList].sort((a, b) => (b.error_count || 0) - (a.error_count || 0));

    // 取出錯誤次數最高的一批卡片（若有多張同分，從中隨機選一張增加隨機感）
    const maxErrors = sortedList[0].error_count || 0;
    const topCandidates = sortedList.filter(c => (c.error_count || 0) === maxErrors);
    const selectedCard = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    
    setCurrentCard(selectedCard);
    setUserInput('');
    setFeedback(null);

    // 句子挖空處理
    if (selectedCard.sentence && selectedCard.word) {
      const regex = new RegExp(`\\b${selectedCard.word}\\b`, 'gi');
      const blanked = selectedCard.sentence.replace(regex, '_______');
      setClozeSentence(blanked !== selectedCard.sentence ? blanked : `${selectedCard.sentence} (請填入: _______)`);
    } else {
      setClozeSentence('_______');
    }
  };

  // 切換複習模式
  const handleModeChange = (newMode) => {
    setReviewMode(newMode);
    pickNextCard(cards, newMode);
  };

  // 4. 呼叫 Gemini REST API
  const callGemini = async (prompt) => {
    if (!GEMINI_API_KEY) {
      throw new Error("請在 .env 檔案中設定 VITE_GEMINI_API_KEY！");
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Gemini 呼叫失敗");
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  };

  const cleanMarkdownSymbols = (text) => {
    return text.replace(/[#*`]/g, '').replace(/\n\s*\n/g, '\n\n').trim();
  };

  // 5. 【間隔複習】作答檢查 (包含錯題計數加減與模式隔離)
  const handleCheckAnswer = async () => {
    if (!userInput.trim() || !currentCard || isCheckingCloze) return;

    setIsCheckingCloze(true);
    const cleanStr = (s) => (s || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
    const inputClean = cleanStr(userInput);
    const targetClean = cleanStr(currentCard.word);
    const todayStr = getTodayStr();
    const isTodayMode = reviewMode === 'today';
    const currentBox = currentCard.box || 1;
    const currentErrors = currentCard.error_count || 0;

    // 1. 本地完全匹配成功
    if (inputClean === targetClean) {
      confetti({ particleCount: 60, spread: 60, origin: { y: 0.8 } });

      if (isTodayMode) {
        setFeedback({ 
          isCorrect: true, 
          msg: `🎉 完全正確！(今日加固確認，維持在 Box ${currentBox})`,
          explanation: '回答精準，語塊印象再次加深！'
        });
      } else {
        const nextBox = Math.min(currentBox + 1, 5);
        const newErrorCount = Math.max(0, currentErrors - 1); // 答對時錯題權重 -1
        setFeedback({ 
          isCorrect: true, 
          msg: `🎉 完全正確！成功升級至 Box ${nextBox}`,
          explanation: newErrorCount === 0 && currentErrors > 0 ? '恭喜攻克易錯語塊！已解除優先標記。' : '回答精準，語塊使用非常道地！'
        });

        await supabase.from('flashcards').update({ 
          box: nextBox, 
          last_review_date: todayStr,
          error_count: newErrorCount 
        }).eq('id', currentCard.id);

        setCards(cards.map(c => c.id === currentCard.id ? { ...c, box: nextBox, last_review_date: todayStr, error_count: newErrorCount } : c));
      }

      setIsCheckingCloze(false);
      return;
    }

    // 2. 本地不一致 -> 呼叫 AI 判定
    try {
      const prompt = `
      你是一位專業且具同理心的美語教練，請診斷學生的填空作答：
      - 完整原句: "${currentCard.sentence}"
      - 原定目標語塊: "${currentCard.word}" (${currentCard.meaning})
      - 學生填入的語彙: "${userInput.trim()}"

      請判斷學生填入的語彙是否在該句子中完全通順且道地？如果不行，請詳細指出「為什麼這個語境不能這樣用」。
      
      請直接回傳嚴格的 JSON 格式（不要使用 Markdown 標籤，不要有 # 或 * 符號）：
      {
        "is_acceptable": true 或 false,
        "explanation": "繁體中文簡明解析"
      }
      `;

      const rawText = await callGemini(prompt);
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const result = JSON.parse(cleaned);

      if (result.is_acceptable) {
        confetti({ particleCount: 50, spread: 50, origin: { y: 0.8 } });
        if (isTodayMode) {
          setFeedback({ 
            isCorrect: true, 
            msg: `✨ 很好！這也是一種可接受的道地說法！(今日加固確認，維持在 Box ${currentBox})`,
            explanation: cleanMarkdownSymbols(result.explanation)
          });
        } else {
          const nextBox = Math.min(currentBox + 1, 5);
          const newErrorCount = Math.max(0, currentErrors - 1);
          setFeedback({ 
            isCorrect: true, 
            msg: `✨ 很好！這也是一種可接受的道地說法！(升至 Box ${nextBox})`,
            explanation: cleanMarkdownSymbols(result.explanation)
          });
          await supabase.from('flashcards').update({ 
            box: nextBox, 
            last_review_date: todayStr,
            error_count: newErrorCount 
          }).eq('id', currentCard.id);
          setCards(cards.map(c => c.id === currentCard.id ? { ...c, box: nextBox, last_review_date: todayStr, error_count: newErrorCount } : c));
        }
      } else {
        if (isTodayMode) {
          setFeedback({ 
            isCorrect: false, 
            msg: `❌ 目標答案是: "${currentCard.word}" (今日加固確認，維持在 Box ${currentBox})`,
            explanation: cleanMarkdownSymbols(result.explanation)
          });
        } else {
          const nextBox = currentBox > 3 ? 3 : 1;
          const newErrorCount = currentErrors + 1; // 答錯時錯題次數 +1 (大幅提升未來優先度)
          setFeedback({ 
            isCorrect: false, 
            msg: `❌ 目標答案是: "${currentCard.word}" (退回 Box ${nextBox}，已加入易錯優先清單)`,
            explanation: cleanMarkdownSymbols(result.explanation)
          });
          await supabase.from('flashcards').update({ 
            box: nextBox, 
            last_review_date: todayStr,
            error_count: newErrorCount 
          }).eq('id', currentCard.id);
          setCards(cards.map(c => c.id === currentCard.id ? { ...c, box: nextBox, last_review_date: todayStr, error_count: newErrorCount } : c));
        }
      }
    } catch (err) {
      if (isTodayMode) {
        setFeedback({ 
          isCorrect: false, 
          msg: `❌ 目標答案是: "${currentCard.word}" (今日加固確認，維持在 Box ${currentBox})`,
          explanation: '拼寫與目標設定不一致。'
        });
      } else {
        const nextBox = currentBox > 3 ? 3 : 1;
        const newErrorCount = currentErrors + 1;
        setFeedback({ 
          isCorrect: false, 
          msg: `❌ 目標答案是: "${currentCard.word}" (退回 Box ${nextBox}，已加入易錯優先清單)`,
          explanation: '拼寫與目標設定不一致。（系統已採用本機標準判定）'
        });
        await supabase.from('flashcards').update({ 
          box: nextBox, 
          last_review_date: todayStr,
          error_count: newErrorCount 
        }).eq('id', currentCard.id);
        setCards(cards.map(c => c.id === currentCard.id ? { ...c, box: nextBox, last_review_date: todayStr, error_count: newErrorCount } : c));
      }
    } finally {
      setIsCheckingCloze(false);
    }
  };

  // 6. 語音朗讀發音
  const playSpeech = (text) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  };

  // 7. 【收錄單字】AI 智能補全
  const handleAutoFillWord = async () => {
    if (!newWord.trim()) {
      alert('請先輸入「單字 / 語塊」名稱，AI 才能為你自動補齊例句與釋義！');
      return;
    }
    setIsAutoFilling(true);
    try {
      const prompt = `
      請為英語單字/語塊 "${newWord.trim()}" 生成學習字卡所需資訊：
      1. 繁體中文常用釋義
      2. 一個道地、生活化且長度適中的英文例句 (必須包含該單字/語塊)
      3. 美式連讀發音備註或音標

      請直接回傳嚴格 JSON 格式（不要使用 Markdown 標籤）：
      {
        "meaning": "中文釋義",
        "sentence": "英文例句",
        "pronunciation": "發音備註"
      }
      `;
      const rawText = await callGemini(prompt);
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const json = JSON.parse(cleaned);

      if (!newMeaning) setNewMeaning(json.meaning || '');
      if (!newSentence) setNewSentence(json.sentence || '');
      if (!newPronun) setNewPronun(json.pronunciation || '');
    } catch (err) {
      alert(`AI 補齊失敗: ${err.message}`);
    } finally {
      setIsAutoFilling(false);
    }
  };

  // 8. 【翻譯教練】隨機生成情境題目
  const handleGenerateScenario = async () => {
    setIsGeneratingCoach(true);
    setCoachFeedback('');
    setCoachUserInput('');
    try {
      const prompt = `
      請隨機生成一個日常生活、職場或社交對話中，母語人士常用的中文情境句子（難度中等），要求學習者將其翻譯成道地英文。
      請直接輸出嚴格的 JSON 格式（不要使用 Markdown 標籤）：
      {
        "scenario": "中文情境與句子（例如：當你想禮貌地詢問主管能否延後會議時間，你會怎麼說？）",
        "target_word": "推薦使用的核心單字或語塊（例如：push back）",
        "target_meaning": "該單字/語塊的中文解釋（例如：延後、推遲）"
      }
      `;
      const rawText = await callGemini(prompt);
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const json = JSON.parse(cleaned);

      setCoachScenario(json.scenario);
      setCoachTargetWord(json.target_word || '');
      setCoachTargetMeaning(json.target_meaning || '');
    } catch (err) {
      alert(`出題失敗: ${err.message}`);
    } finally {
      setIsGeneratingCoach(false);
    }
  };

  // 9. 【翻譯教練】批改
  const handleEvaluateTranslation = async () => {
    if (!coachUserInput.trim() || isEvaluatingCoach) return;
    setIsEvaluatingCoach(true);
    try {
      const prompt = `
      你是一位頂級、幽默且專業的美籍口語英語教練。
      題目情境: "${coachScenario}"
      核心推薦語塊: "${coachTargetWord}" (${coachTargetMeaning})
      學生的翻譯: "${coachUserInput}"

      請用繁體中文給予簡潔、有建設性的評析。
      【重要格式規範】：請絕對不要使用任何 Markdown 的 '#' 井字號標題符號，也不要使用 '*' 星號粗體符號。請一律使用純文字搭配 Emoji 條列排版！
      
      請依序提供：
      🎯 【道地度評分】(0-100 分)
      🗣️ 【母語人士更自然的說法】(提供 1~2 種道地例句)
      💡 【重點語塊與連讀解析】(指出發音或用詞關鍵)
      `;
      const result = await callGemini(prompt);
      setCoachFeedback(cleanMarkdownSymbols(result));
    } catch (err) {
      alert(`批改失敗: ${err.message}`);
    } finally {
      setIsEvaluatingCoach(false);
    }
  };

  // 10. 【翻譯教練】一鍵收錄字卡
  const handleSaveCoachWordToSRS = async () => {
    if (!coachTargetWord || !user) {
      alert('無法取得語塊或尚未登入！');
      return;
    }
    try {
      const { data, error } = await supabase.from('flashcards').insert([{
        user_id: user.id,
        word: coachTargetWord.trim(),
        meaning: coachTargetMeaning || '情境實戰精選語塊',
        sentence: coachScenario ? `情境: ${coachScenario}` : `Example of ${coachTargetWord}`,
        pronunciation: '',
        box: 1,
        last_review_date: null,
        error_count: 0
      }]).select();

      if (error) throw error;

      if (data && data.length > 0) {
        setCards([data[0], ...cards]);
        alert(`✅ 成功將「${coachTargetWord}」收錄至 Box 1 字卡庫！`);
      }
    } catch (err) {
      alert(`收錄失敗: ${err.message}`);
    }
  };

  // 11. 【外部資料】分批安全匯入 chunks.json
  const handleImportJsonFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target.result);
        const cardArray = Array.isArray(json) ? json : (json.flashcards || json.cards || []);

        if (cardArray.length === 0) {
          alert('⚠️ JSON 檔案內找不到有效的字卡清單！');
          return;
        }

        const formatted = cardArray.map(item => ({
          user_id: user.id,
          word: item.word || item.target_word || 'Unknown',
          meaning: item.meaning || item.definition || '',
          sentence: item.sentence || item.example || '',
          pronunciation: item.pronunciation || item.phonetic || '',
          box: item.box || 1,
          last_review_date: item.last_review_date || null,
          error_count: item.error_count || 0
        }));

        setLoading(true);
        const chunkSize = 500;
        for (let i = 0; i < formatted.length; i += chunkSize) {
          const chunk = formatted.slice(i, i + chunkSize);
          const { error } = await supabase.from('flashcards').insert(chunk);
          if (error) throw error;
        }

        alert(`🎉 成功匯入 ${formatted.length} 張字卡至雲端資料庫！`);
        await fetchCards();
      } catch (err) {
        alert(`JSON 解析或匯入失敗: ${err.message}`);
      } finally {
        setLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  // 12. 刪除單一字卡
  const handleDeleteCard = async (cardId, wordText) => {
    if (!window.confirm(`確定要從資料庫刪除「${wordText}」嗎？`)) return;
    const { error } = await supabase.from('flashcards').delete().eq('id', cardId);
    if (!error) {
      setCards(cards.filter(c => c.id !== cardId));
    } else {
      alert(`刪除失敗: ${error.message}`);
    }
  };

  // 13. 手動新增字卡
  const handleAddCard = async (e) => {
    e.preventDefault();
    if (!newWord || !newMeaning) return;

    const { data, error } = await supabase
      .from('flashcards')
      .insert([{
        user_id: user.id,
        word: newWord.trim(),
        meaning: newMeaning.trim(),
        sentence: newSentence.trim() || `This is an example of ${newWord.trim()}.`,
        pronunciation: newPronun.trim(),
        box: 1,
        last_review_date: null,
        error_count: 0
      }])
      .select();

    if (!error && data) {
      setCards([data[0], ...cards]);
      setNewWord('');
      setNewMeaning('');
      setNewSentence('');
      setNewPronun('');
      alert('✅ 單字新增成功！');
      setActiveTab('library');
    } else {
      alert(`新增失敗: ${error?.message}`);
    }
  };

  // 14. 開啟推播通知
  const handleEnablePush = async () => {
    try {
      await subscribeToPush(user.id);
      alert('🔔 推播通知已成功開啟！每日將定時提醒複習。');
    } catch (err) {
      alert(`⚠️ 開啟推播失敗: ${err.message}`);
    }
  };

  // 統計與篩選計算 (使用本地時間)
  const todayStr = getTodayStr();
  const stats = {
    total: cards.length,
    boxCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    todayCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  };

  cards.forEach(c => {
    const b = c.box || 1;
    stats.boxCounts[b] = (stats.boxCounts[b] || 0) + 1;
    if (c.last_review_date === todayStr) {
      stats.todayCounts[b] = (stats.todayCounts[b] || 0) + 1;
    }
  });
  const todayReviewedTotal = Object.values(stats.todayCounts).reduce((a, b) => a + b, 0);

  // 總覽搜尋邏輯
  const filteredCards = cards.filter(c => {
    const matchBox = filterBox === 'all' || (c.box || 1) === parseInt(filterBox);
    const q = searchQuery.trim().toLowerCase();
    const matchQuery = !q || 
      c.word?.toLowerCase().includes(q) || 
      c.meaning?.toLowerCase().includes(q) || 
      c.sentence?.toLowerCase().includes(q);
    return matchBox && matchQuery;
  });

  // ---------------- 未登入畫面 ----------------
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-extrabold text-indigo-400">英文大師 SRS</h1>
            <p className="text-slate-400 text-sm mt-1">KGB 5-Box 間隔複習 & 語塊資料庫</p>
          </div>

          <form onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true);
            const action = authMode === 'login' 
              ? supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
              : supabase.auth.signUp({ email: authEmail, password: authPassword });
            const { error } = await action;
            if (error) alert(error.message);
            setLoading(false);
          }} className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 font-semibold">電子信箱</label>
              <input 
                type="email" 
                required 
                value={authEmail} 
                onChange={e => setAuthEmail(e.target.value)}
                className="w-full mt-1 p-3 bg-slate-800 border border-slate-700 rounded-xl focus:border-indigo-500 outline-none"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 font-semibold">密碼</label>
              <input 
                type="password" 
                required 
                value={authPassword} 
                onChange={e => setAuthPassword(e.target.value)}
                className="w-full mt-1 p-3 bg-slate-800 border border-slate-700 rounded-xl focus:border-indigo-500 outline-none"
                placeholder="••••••••"
              />
            </div>

            <button 
              type="submit" 
              disabled={loading}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 font-bold rounded-xl shadow-lg transition duration-200"
            >
              {loading ? '處理中...' : (authMode === 'login' ? '登入' : '註冊帳號')}
            </button>
          </form>

          <div className="text-center mt-4">
            <button 
              onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
              className="text-xs text-indigo-400 hover:underline"
            >
              {authMode === 'login' ? '還沒有帳號？點此註冊' : '已有帳號？點此登入'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- 主應用畫面 ----------------
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col max-w-lg mx-auto border-x border-slate-800/50 shadow-2xl">
      {/* 頂部導覽列 */}
      <header className="p-4 bg-slate-900/80 backdrop-blur border-b border-slate-800 flex justify-between items-center sticky top-0 z-10">
        <div>
          <h1 className="text-xl font-black text-indigo-400">英文大師 SRS</h1>
          <p className="text-[11px] text-slate-400">總字庫: <span className="text-indigo-400 font-bold">{stats.total}</span> 張 | 今日已複習: <span className="text-emerald-400 font-bold">{todayReviewedTotal}</span></p>
        </div>
        <div className="flex items-center gap-2">
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImportJsonFile} 
            accept=".json" 
            className="hidden" 
          />
          <button 
            onClick={() => fileInputRef.current?.click()} 
            className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-indigo-300 flex items-center gap-1 text-xs font-semibold"
            title="匯入 chunks.json"
          >
            <Upload size={16} /> 匯入
          </button>
          <button onClick={handleEnablePush} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-amber-400" title="開啟通知">
            <Bell size={16} />
          </button>
          <button onClick={() => supabase.auth.signOut()} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400" title="登出">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* 統計看板 */}
      <section className="p-4 bg-slate-900/40 border-b border-slate-800/60">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-bold text-slate-400">KGB 5-Box 分佈 ({stats.total} 張)</span>
          {loading && <span className="text-[10px] text-indigo-400 animate-pulse">雲端同步中...</span>}
        </div>
        <div className="grid grid-cols-5 gap-1.5 text-center">
          {[1, 2, 3, 4, 5].map(b => (
            <div key={b} className={`p-2 rounded-xl border ${currentCard?.box === b && activeTab === 'review' ? 'border-indigo-500 bg-indigo-950/40' : 'border-slate-800 bg-slate-900/60'}`}>
              <div className="text-[10px] text-slate-400">Box {b}</div>
              <div className="text-sm font-bold">{stats.boxCounts[b]}</div>
              <div className="text-[9px] text-emerald-400">今: {stats.todayCounts[b]}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 主內容區 */}
      <main className="flex-1 p-4 overflow-y-auto pb-24">
        {/* 分頁 1: 間隔複習 */}
        {activeTab === 'review' && (
          <div>
            {/* 複習模式切換按鈕 */}
            <div className="flex justify-center gap-2 mb-4">
              <button
                type="button"
                onClick={() => handleModeChange('due')}
                className={`px-4 py-1.5 rounded-full font-bold text-xs transition-all ${
                  reviewMode === 'due'
                    ? 'bg-indigo-600 text-white shadow-lg'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                ⏰ 到期複習 (SRS)
              </button>
              <button
                type="button"
                onClick={() => handleModeChange('today')}
                className={`px-4 py-1.5 rounded-full font-bold text-xs transition-all ${
                  reviewMode === 'today'
                    ? 'bg-emerald-600 text-white shadow-lg'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                📅 今日已刷 ({todayReviewedTotal})
              </button>
            </div>

            {currentCard ? (
              <div className="space-y-4">
                <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3 relative overflow-hidden">
                  <div className="flex justify-between items-center text-xs text-slate-400">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-indigo-950 text-indigo-400 border border-indigo-800/50 rounded-md font-bold">
                        Box {currentCard.box || 1}
                      </span>
                      {/* 🔥 錯題次數提示標籤 */}
                      {(currentCard.error_count || 0) > 0 && (
                        <span className="px-2 py-0.5 bg-rose-950 text-rose-400 border border-rose-800/50 rounded-md font-bold flex items-center gap-0.5 text-[11px]">
                          <Flame size={12} /> 易錯加強 (錯 {currentCard.error_count} 次)
                        </span>
                      )}
                    </div>
                    <span>{currentCard.pronunciation || ''}</span>
                  </div>

                  <div className="text-lg text-slate-200 leading-relaxed font-medium">
                    {clozeSentence}
                  </div>

                  <div className="text-sm text-amber-300/90 font-medium">
                    💡 提示: {currentCard.meaning}
                  </div>
                </div>

                <div className="space-y-3">
                  <input 
                    type="text"
                    value={userInput}
                    onChange={e => setUserInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCheckAnswer()}
                    placeholder="輸入缺空處的單字或語塊..."
                    className="w-full p-4 bg-slate-900 border border-slate-700 rounded-2xl text-lg font-semibold focus:border-indigo-500 outline-none"
                    autoFocus
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={handleCheckAnswer}
                      disabled={isCheckingCloze || !userInput.trim()}
                      className="py-3.5 bg-indigo-600 hover:bg-indigo-500 font-bold rounded-xl shadow-lg transition"
                    >
                      {isCheckingCloze ? 'AI 診斷中...' : '驗證答案'}
                    </button>
                    <button 
                      onClick={() => pickNextCard(cards, reviewMode)}
                      className="py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl transition"
                    >
                      跳過此題
                    </button>
                  </div>
                </div>

                {/* 批改反饋面板 */}
                {feedback && (
                  <div className={`p-5 rounded-2xl border space-y-3 ${feedback.isCorrect ? 'bg-emerald-950/30 border-emerald-800 text-emerald-300' : 'bg-rose-950/30 border-rose-800 text-rose-300'}`}>
                    <div className="flex items-center gap-2 font-bold text-base">
                      {feedback.isCorrect ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                      {feedback.msg}
                    </div>

                    {feedback.explanation && (
                      <div className="text-xs text-slate-300 bg-slate-900/60 p-3 rounded-xl border border-slate-800 leading-relaxed">
                        <span className="font-bold text-indigo-400">💡 教練解析：</span> {feedback.explanation}
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <button 
                        onClick={() => playSpeech(currentCard.sentence || currentCard.word)}
                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-xl text-indigo-300 flex items-center gap-1.5 transition"
                      >
                        <Volume2 size={16} /> 朗讀正確原句
                      </button>
                      <button 
                        onClick={() => pickNextCard(cards, reviewMode)} 
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow transition ml-auto"
                      >
                        下一題 ➔
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12 text-slate-500 space-y-3">
                <Sparkles size={40} className="mx-auto text-indigo-400/50" />
                <p>{reviewMode === 'today' ? '今天還沒有複習過的字卡喔！先切換到「⏰ 到期複習」開始刷題吧。' : '太棒了！目前沒有到期的字卡需要複習。'}</p>
                <button 
                  onClick={() => reviewMode === 'today' ? handleModeChange('due') : setActiveTab('add')}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow"
                >
                  {reviewMode === 'today' ? '前往到期複習' : '前往新增單字'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 分頁 2: 情境翻譯教練 */}
        {activeTab === 'coach' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2">
                <MessageSquareText size={20} className="text-indigo-400" />
                AI 情境翻譯教練
              </h2>
              <button 
                onClick={handleGenerateScenario}
                disabled={isGeneratingCoach}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-bold rounded-xl shadow transition"
              >
                {isGeneratingCoach ? '出題中...' : '🎲 生成新題目'}
              </button>
            </div>

            {coachScenario ? (
              <div className="space-y-4">
                <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-2">
                  <div className="text-xs text-indigo-400 font-bold">📝 請將以下情境翻譯為英文：</div>
                  <div className="text-base text-slate-100 font-medium leading-relaxed">
                    {coachScenario}
                  </div>
                  {coachTargetWord && (
                    <div className="text-xs text-amber-300/90 pt-1">
                      💡 推薦使用語塊: <span className="font-bold underline">{coachTargetWord}</span> ({coachTargetMeaning})
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <textarea 
                    rows={3}
                    value={coachUserInput}
                    onChange={e => setCoachUserInput(e.target.value)}
                    placeholder="在此輸入你的英文翻譯..."
                    className="w-full p-3.5 bg-slate-900 border border-slate-700 rounded-xl outline-none focus:border-indigo-500 font-medium"
                  />
                  <button 
                    onClick={handleEvaluateTranslation}
                    disabled={isEvaluatingCoach || !coachUserInput.trim()}
                    className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-bold rounded-xl shadow-lg flex items-center justify-center gap-2 transition"
                  >
                    <Send size={16} />
                    {isEvaluatingCoach ? '教練批改中...' : '送出批改'}
                  </button>
                </div>

                {coachFeedback && (
                  <div className="p-5 bg-slate-900 border border-indigo-900/60 rounded-2xl space-y-3">
                    <div className="text-sm text-slate-200 whitespace-pre-line leading-relaxed font-sans">
                      {coachFeedback}
                    </div>
                    {coachTargetWord && (
                      <button 
                        onClick={handleSaveCoachWordToSRS}
                        className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold rounded-xl border border-amber-500/30 flex items-center justify-center gap-1.5 transition"
                      >
                        <BookmarkPlus size={16} />
                        一鍵將「{coachTargetWord}」加入字卡庫 (Box 1)
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-16 text-slate-500 space-y-3">
                <Sparkles size={40} className="mx-auto text-indigo-400/50" />
                <p>點擊上方「🎲 生成新題目」開始你的口語翻譯實戰訓練！</p>
              </div>
            )}
          </div>
        )}

        {/* 分頁 3: 字卡庫總覽 */}
        {activeTab === 'library' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2">
                <Database size={20} className="text-indigo-400" />
                字卡資料庫 ({filteredCards.length} / {cards.length})
              </h2>
            </div>

            {/* 搜尋與篩選列 */}
            <div className="space-y-2">
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-3.5 text-slate-500" />
                <input 
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜尋單字、釋義或例句..."
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex gap-1 overflow-x-auto pb-1 text-xs">
                {['all', 1, 2, 3, 4, 5].map(b => (
                  <button
                    key={b}
                    onClick={() => setFilterBox(b)}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition shrink-0 ${filterBox === b ? 'bg-indigo-600 text-white' : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'}`}
                  >
                    {b === 'all' ? '全部' : `Box ${b}`}
                  </button>
                ))}
              </div>
            </div>

            {/* 字卡清單 */}
            <div className="space-y-2.5">
              {filteredCards.length > 0 ? (
                filteredCards.map(card => (
                  <div key={card.id} className="p-4 bg-slate-900 border border-slate-800/80 rounded-xl space-y-1.5 relative group">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-indigo-300">{card.word}</span>
                        {card.pronunciation && (
                          <span className="text-[11px] text-slate-400 font-mono">{card.pronunciation}</span>
                        )}
                        {/* 總覽中顯示易錯標記 */}
                        {(card.error_count || 0) > 0 && (
                          <span className="px-1.5 py-0.5 bg-rose-950 text-rose-400 border border-rose-800/50 rounded text-[10px] font-bold flex items-center gap-0.5">
                            <Flame size={10} /> 錯 {card.error_count} 次
                          </span>
                        )}
                      </div>
                      <span className="px-2 py-0.5 bg-indigo-950 text-indigo-400 border border-indigo-800/40 rounded text-[10px] font-bold">
                        Box {card.box || 1}
                      </span>
                    </div>

                    <div className="text-xs text-amber-300/90 font-medium">
                      {card.meaning}
                    </div>

                    {card.sentence && (
                      <div className="text-xs text-slate-400 leading-relaxed font-sans pt-0.5">
                        {card.sentence}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/50 mt-2">
                      <button 
                        onClick={() => playSpeech(card.sentence || card.word)}
                        className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                      >
                        <Volume2 size={14} /> 朗讀
                      </button>
                      <button 
                        onClick={() => handleDeleteCard(card.id, card.word)}
                        className="text-xs text-rose-400/80 hover:text-rose-400 flex items-center gap-1"
                      >
                        <Trash2 size={14} /> 刪除
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-slate-500 text-xs">
                  找不到符合條件的字卡。
                </div>
              )}
            </div>
          </div>
        )}

        {/* 分頁 4: 新增單字 */}
        {activeTab === 'add' && (
          <form onSubmit={handleAddCard} className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-200">➕ 新增語彙卡片</h2>
              <button
                type="button"
                onClick={handleAutoFillWord}
                disabled={isAutoFilling || !newWord.trim()}
                className="px-3 py-1.5 bg-indigo-600/80 hover:bg-indigo-500 disabled:opacity-40 text-xs font-bold rounded-xl text-indigo-100 flex items-center gap-1.5 transition"
              >
                <Wand2 size={14} />
                {isAutoFilling ? 'AI 補齊中...' : '✨ AI 智能補齊'}
              </button>
            </div>

            <div>
              <label className="text-xs text-slate-400 font-bold">單字 / 語塊 (Word / Chunk)</label>
              <input 
                type="text" 
                required 
                value={newWord}
                onChange={e => setNewWord(e.target.value)}
                placeholder="例如: get over" 
                className="w-full mt-1 p-3 bg-slate-900 border border-slate-800 rounded-xl outline-none focus:border-indigo-500 font-semibold"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 font-bold">中文釋義 (Meaning)</label>
              <input 
                type="text" 
                required 
                value={newMeaning}
                onChange={e => setNewMeaning(e.target.value)}
                placeholder="例如: 克服、從...中恢復過來" 
                className="w-full mt-1 p-3 bg-slate-900 border border-slate-800 rounded-xl outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 font-bold">例句 (Sentence - 包含目標語塊)</label>
              <textarea 
                rows={3}
                value={newSentence}
                onChange={e => setNewSentence(e.target.value)}
                placeholder="例如: It took him a long time to get over the flu." 
                className="w-full mt-1 p-3 bg-slate-900 border border-slate-800 rounded-xl outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 font-bold">美式連讀 / 發音備註 (選填)</label>
              <input 
                type="text" 
                value={newPronun}
                onChange={e => setNewPronun(e.target.value)}
                placeholder="例如: /ɡɛt ˈoʊvər/ (連讀成 ge-dover)" 
                className="w-full mt-1 p-3 bg-slate-900 border border-slate-800 rounded-xl outline-none focus:border-indigo-500"
              />
            </div>

            <button 
              type="submit"
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 font-bold rounded-xl shadow-lg transition"
            >
              確認收錄至 Box 1
            </button>
          </form>
        )}
      </main>

      {/* 底部四大導覽分頁 */}
      <footer className="bg-slate-900/90 backdrop-blur border-t border-slate-800 grid grid-cols-4 p-2 fixed bottom-0 max-w-lg w-full z-10">
        <button 
          onClick={() => setActiveTab('review')}
          className={`py-2 flex flex-col items-center gap-1 rounded-xl text-xs font-semibold ${activeTab === 'review' ? 'text-indigo-400 bg-slate-800/60' : 'text-slate-400'}`}
        >
          <RefreshCw size={16} />
          複習
        </button>
        <button 
          onClick={() => setActiveTab('coach')}
          className={`py-2 flex flex-col items-center gap-1 rounded-xl text-xs font-semibold ${activeTab === 'coach' ? 'text-indigo-400 bg-slate-800/60' : 'text-slate-400'}`}
        >
          <MessageSquareText size={16} />
          教練
        </button>
        <button 
          onClick={() => setActiveTab('library')}
          className={`py-2 flex flex-col items-center gap-1 rounded-xl text-xs font-semibold ${activeTab === 'library' ? 'text-indigo-400 bg-slate-800/60' : 'text-slate-400'}`}
        >
          <Database size={16} />
          總覽
        </button>
        <button 
          onClick={() => setActiveTab('add')}
          className={`py-2 flex flex-col items-center gap-1 rounded-xl text-xs font-semibold ${activeTab === 'add' ? 'text-indigo-400 bg-slate-800/60' : 'text-slate-400'}`}
        >
          <PlusCircle size={16} />
          收錄
        </button>
      </footer>
    </div>
  );
}
