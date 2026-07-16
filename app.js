// -------------------------------------------------------------
    // goshikiStorage Security Fallback (for file:// protocol)
    // -------------------------------------------------------------
    let safegoshikiStorage = null;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const testKey = '__goshiki_test_storage__';
        window.localStorage.setItem(testKey, 'test');
        window.localStorage.removeItem(testKey);
        safegoshikiStorage = window.localStorage;
      }
    } catch (e) {
      console.warn("goshikiStorage is blocked or unavailable. Using safe in-memory fallback.");
    }

    if (!safegoshikiStorage) {
      const memoryDb = {};
      safegoshikiStorage = {
        getItem: function(key) {
          return key in memoryDb ? memoryDb[key] : null;
        },
        setItem: function(key, value) {
          memoryDb[key] = String(value);
          this.length = Object.keys(memoryDb).length;
        },
        removeItem: function(key) {
          delete memoryDb[key];
          this.length = Object.keys(memoryDb).length;
        },
        clear: function() {
          for (const k in memoryDb) delete memoryDb[k];
          this.length = 0;
        },
        key: function(index) {
          return Object.keys(memoryDb)[index] || null;
        },
        length: 0
      };
      try {
        Object.defineProperty(window, 'goshikiStorage', {
          value: safegoshikiStorage,
          writable: true,
          configurable: true
        });
      } catch (err) {}
    }
    const baseGoshikiStorage = safegoshikiStorage;
    const goshikiStorage = {
      getItem: function(key) {
        return baseGoshikiStorage.getItem(key);
      },
      setItem: function(key, value) {
        baseGoshikiStorage.setItem(key, value);
        if (typeof window.syncItemToFirebase === 'function') {
          window.syncItemToFirebase(key, value);
        }
      },
      removeItem: function(key) {
        baseGoshikiStorage.removeItem(key);
        if (typeof window.syncRemoveFromFirebase === 'function') {
          window.syncRemoveFromFirebase(key);
        }
      },
      clear: function() {
        baseGoshikiStorage.clear();
        if (typeof window.syncClearFirebase === 'function') {
          window.syncClearFirebase();
        }
      },
      key: function(index) {
        return baseGoshikiStorage.key(index);
      },
      get length() {
        return baseGoshikiStorage.length;
      }
    };
    try {
      Object.defineProperty(window, 'goshikiStorage', {
        value: goshikiStorage,
        writable: true,
        configurable: true
      });
    } catch(e) {}

    // -------------------------------------------------------------
    // Application State Variables
    // -------------------------------------------------------------
    let selectedColors = ['blue'];
    let selectedColor = 'blue';
    let playMode = 'traditional'; // 'traditional' (Kami -> Shimo) or 'beginner' (Shimo -> Shimo)
    let showText = true;
    let speechSpeed = 1.0;
    let missLimit = 0; // 0 means unlimited
    let debugModeEnabled = goshikiStorage.getItem('goshiki_debug_mode_enabled') === 'true';
    window.debugModeEnabled = debugModeEnabled;
    
    // Game Session Variables
    let gameActive = false;
    let currentSet = []; // Currently active 20 poems
    let targetIndex = 0; // Index of the poem currently being read in shuffled list
    let shuffledOrder = []; // Shuffled array indices of the current set
    let missesCount = 0;
    let startTime = null;
    let timerInterval = null;
    let lastGameElapsed = 0;
    let currentReadingPoemNo = null;
    let hasResetOccurred = false;
    
    // Anti-spam and Penalty variables
    let isInputLocked = false;
    let consecutiveMisses = 0;
    let hasTriggeredPenalty = false;
    let pauseStartTime = null;
    
    // Review Session Variables
    let gameHistory = []; // Array of { poem, correctOnFirstTry }
    let hasMissedCurrentCard = false;
    
    // Best records stored in goshikiStorage
    const bestRecords = {
      blue: null,
      pink: null,
      yellow: null,
      green: null,
      orange: null,
      chaos: null
    };

    const bestMisses = {
      blue: null,
      pink: null,
      yellow: null,
      green: null,
      orange: null,
      chaos: null
    };

    // Level & XP State Variables
    let playerLevel = 1;
    let playerXP = 0;

    // Load initial data and records on load
    window.addEventListener('DOMContentLoaded', () => {
      loadRecords();
      loadLevelData();
      updateTotalAcquiredCount();
      updateSelectedColorTheme();
      
      // Load gold theme state if unlocked
      let specialAchievements = [];
      try {
        const oldSpecial = JSON.parse(goshikiStorage.getItem('goshiki_special_achievements') || '[]');
        const newSpecial = JSON.parse(goshikiStorage.getItem('goshiki_special_achievements_v2') || '[]');
        specialAchievements = [...new Set([...oldSpecial, ...newSpecial])];
      } catch(e) {}
      
      let goldThemeEnabled = goshikiStorage.getItem('goshiki_gold_theme_enabled_v2');
      if (goldThemeEnabled === null) {
        goldThemeEnabled = goshikiStorage.getItem('goshiki_gold_theme_enabled');
      }
      
      if (specialAchievements.includes('ultimate_song_saint') && goldThemeEnabled === 'true') {
        document.body.classList.add('gold-theme-active');
      }

      // Load saved username
      const savedName = goshikiStorage.getItem('goshiki_ranking_username') || '';
      const nameInput = document.getElementById('ranking-name-input');
      if (nameInput) nameInput.value = savedName;

      // Trigger voice list load in browser
      if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices();
      }

      // Increment boot count for Traveler achievement
      let bootCount = parseInt(goshikiStorage.getItem('goshiki_boot_count') || '0');
      bootCount++;
      goshikiStorage.setItem('goshiki_boot_count', bootCount);
      if (bootCount >= 100) {
        setTimeout(() => {
          checkBadgeUnlock('traveler');
        }, 1500);
      }

      // Update AI Coach suggestions
      updateCoachAdvice();
      
      // Refresh color buttons lock states on load
      refreshColorButtonsLockState();
    });

    // 称号データ（50レベル刻み）
    const TITLES = [
        { threshold: 1, name: "見習い歌詠み" },
        { threshold: 51, name: "初歩の歌詠み" },
        { threshold: 101, name: "千早の使い手" },
        { threshold: 151, name: "五色の風使い" },
        { threshold: 201, name: "競技の匠" },
        { threshold: 251, name: "決まり字の支配者" },
        { threshold: 301, name: "百人一首の守護者" },
        { threshold: 351, name: "五色の賢者" },
        { threshold: 401, name: "極めし歌詠み" },
        { threshold: 451, name: "五色百人一首の仙人" },
        { threshold: 500, name: "五色百人一首の王（キング）" }
    ];

    // XPからレベルを算出する関数（段階的な必要XP増に対応）
    function getLevel(xp) {
      if (xp < 9900) {
        return Math.floor(xp / 100) + 1;
      }
      if (xp < 24750) {
        return 100 + Math.floor((xp - 9900) / 150) + 1;
      }
      return 200 + Math.floor((xp - 24750) / 200) + 1;
    }

    // 現在の称号を取得する関数
    function getCurrentTitle(level) {
        let title = TITLES[0].name;
        for (const t of TITLES) {
            if (level >= t.threshold) title = t.name;
        }
        return title;
    }

    // 次のレベルに必要なXPを取得する関数
    function getXpNeededForNextLevel(level) {
      if (level < 100) return 100;
      if (level < 200) return 150;
      return 200;
    }

    // 現在のレベル内に滞留しているXPを取得する関数
    function getXpInCurrentLevel(xp, level) {
      if (level <= 100) {
        return xp - (level - 1) * 100;
      } else if (level <= 200) {
        return xp - (9900 + (level - 101) * 150);
      } else {
        return xp - (24750 + (level - 201) * 200);
      }
    }

    // レベルに応じたカードのスタイル（CSSクラス）を取得
    function getCardStyle(level) {
        if (level >= 400) return 'border-rainbow'; // 虹色
        if (level >= 300) return 'border-gold';    // 金
        if (level >= 200) return 'border-silver';  // 銀
        return 'border-copper';                    // 銅
    }

    // 次の称号情報とそこまでのレベル差を取得する
    function getRankInfo(level) {
      const titleName = getCurrentTitle(level);
      
      const descriptions = {
        "見習い歌詠み": "百人一首の世界へ第一歩を踏み出した、未来の歌詠みの卵！",
        "初歩の歌詠み": "基本の歌を覚え、少しずつ対戦の楽しさが分かってきた修業者！",
        "千早の使い手": "「ちはやふる」の歌をはじめ、得意な歌を素早く取れる実力者！",
        "五色の風使い": "五色の風のように軽やかに、様々な色の札をさばく達人！",
        "競技の匠": "競技かるたのルールと戦術を身に付けた、対戦相手を圧倒する匠！",
        "決まり字の支配者": "上の句の最初の数文字を聞くだけで札を特定できる、一瞬の支配者！",
        "百人一首の守護者": "すべての百首を網羅し、かるたの歴史と伝統を守り抜く守護者！",
        "五色の賢者": "五色のすべてに精通し、状況に応じた最適な対応ができる賢者！",
        "極めし歌詠み": "無駄のない研ぎ澄まされた動作で、一瞬のうちに札を取る極限の歌詠み！",
        "五色百人一首の仙人": "もはや音を聞く前に歌の気配を感じ取ることができるという、伝説の仙人！",
        "五色百人一首の王（キング）": "すべてのかるた使いの頂点に君臨する、百人一首の絶対王者（キング）！"
      };
      
      const desc = descriptions[titleName] || "百人一首の道を極めし達人！";
      
      let nextTitle = null;
      for (const t of TITLES) {
        if (t.threshold > level) {
          nextTitle = t;
          break;
        }
      }
      
      if (!nextTitle) {
        return { name: titleName, desc: desc, nextName: "（極めし境地）", levelsToNext: 0 };
      } else {
        return { name: titleName, desc: desc, nextName: nextTitle.name, levelsToNext: nextTitle.threshold - level };
      }
    }

    // Celebratory level-up messages
    const CELEBRATION_MESSAGES = [
      "素晴らしい！歌の心が伝わってきたぞ！",
      "見事なり！その調子でどんどん覚えよう！",
      "頭脳明晰！君の記憶力は本物だね！",
      "かるたの響きが、君の指先を導いているぞ！",
      "お見事！歌の美しさに磨きがかかってきた！",
      "素晴らしい成長だ！かるたも君に応えているよ！"
    ];

    // -------------------------------------------------------------
    // Level & XP Systems (Saved to goshikiStorage)
    // -------------------------------------------------------------
    function loadLevelData() {
      playerXP = parseInt(goshikiStorage.getItem('goshiki_player_xp') || '0');
      playerLevel = getLevel(playerXP);
      updateXPUI();
      if (typeof checkSkinUnlocks === 'function') {
        checkSkinUnlocks();
      }
    }

    function saveLevelData() {
      goshikiStorage.setItem('goshiki_player_level', playerLevel);
      goshikiStorage.setItem('goshiki_player_xp', playerXP);
    }

    function addXP(amount) {
      playerXP += amount;
      
      const newLevel = getLevel(playerXP);
      if (newLevel > playerLevel) {
        const oldRankName = getCurrentTitle(playerLevel);
        const newRankName = getCurrentTitle(newLevel);
        const isRankUp = oldRankName !== newRankName;
        
        if (isRankUp) {
          document.getElementById('popup-new-title-name').textContent = newRankName;
          const rankUpOverlay = document.getElementById('rank-up-banner');
          if (rankUpOverlay) rankUpOverlay.style.display = 'flex';
          setTimeout(() => { if (rankUpOverlay) rankUpOverlay.style.display = 'none'; }, 4000);
          showConfetti();
        } else {
          showLevelUpOverlay(playerLevel, newLevel, false, '');
        }
        
        playerLevel = newLevel;
        playLevelUpSound();
        if (typeof checkSkinUnlocks === 'function') {
          checkSkinUnlocks();
        }
      }
      
      saveLevelData();
      updateXPUI();
    }

    function updateXPUI() {
      const neededXP = getXpNeededForNextLevel(playerLevel);
      const currentLevelXP = getXpInCurrentLevel(playerXP, playerLevel);
      const rank = getRankInfo(playerLevel);
      const percent = Math.min(100, Math.floor((currentLevelXP / neededXP) * 100));

      // 1. Header widget updates
      document.getElementById('header-level').textContent = playerLevel;
      document.getElementById('header-rank').textContent = rank.name;
      document.getElementById('header-current-xp').textContent = currentLevelXP;
      document.getElementById('header-needed-xp').textContent = neededXP;
      document.getElementById('header-xp-bar').style.width = `${percent}%`;

      // 2. Start screen progression panel updates
      const pRankName = document.getElementById('progression-rank-name');
      const pLevelVal = document.getElementById('progression-level-val');
      const pRankDesc = document.getElementById('progression-rank-desc');
      const pNextArea = document.getElementById('progression-next-area');

      if (pRankName) pRankName.textContent = rank.name;
      if (pLevelVal) pLevelVal.textContent = playerLevel;
      if (pRankDesc) pRankDesc.textContent = rank.desc;

      if (pNextArea) {
        if (playerLevel >= 500) {
          pNextArea.innerHTML = `<span>おめでとう！最高ランクの「五色百人一首の王（キング）」に到達しました！</span>`;
        } else {
          pNextArea.innerHTML = `
            <span>次の称号：<strong id="progression-next-name">${rank.nextName}</strong> まで</span>
            <span>あと <strong id="progression-levels-left" style="color: var(--color-orange);">${rank.levelsToNext}</strong> レベル</span>
          `;
        }
      }

      // 3. New prominent Start screen progression progress bar updates
      const progXpNum = document.getElementById('progression-xp-num');
      const progNeededXpNum = document.getElementById('progression-needed-xp-num');
      const progXpBarInner = document.getElementById('progression-xp-bar-inner');
      const progToNextDesc = document.getElementById('progression-to-next-level-desc');

      if (progXpNum) progXpNum.textContent = currentLevelXP;
      if (progNeededXpNum) progNeededXpNum.textContent = neededXP;
      if (progXpBarInner) progXpBarInner.style.width = `${percent}%`;
      if (progToNextDesc) {
        progToNextDesc.textContent = `次のレベルまで あと ${neededXP - currentLevelXP} XP`;
      }
    }

    function showLevelUpOverlay(oldLv, newLv, isRankUp, newRankName) {
      document.getElementById('popup-old-level').textContent = oldLv;
      document.getElementById('popup-new-level').textContent = newLv;
      
      const randomMsg = CELEBRATION_MESSAGES[Math.floor(Math.random() * CELEBRATION_MESSAGES.length)];
      document.getElementById('popup-celebration-message').textContent = randomMsg;

      const rankChangeArea = document.getElementById('popup-rank-change-area');
      if (isRankUp) {
        document.getElementById('popup-new-rank').textContent = newRankName;
        rankChangeArea.style.display = 'block';
      } else {
        rankChangeArea.style.display = 'none';
      }
      
      const overlay = document.getElementById('level-up-banner');
      overlay.style.display = 'flex';
      
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 3000);
    }

    // -------------------------------------------------------------
    // Audio Synthesis Engine (Synthesized SFX)
    // -------------------------------------------------------------
    function playLevelUpSound() {
      if (!window.AudioContext && !window.webkitAudioContext) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        const playNote = (freq, startTime, duration) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, startTime);
          
          gain.gain.setValueAtTime(0, startTime);
          gain.gain.linearRampToValueAtTime(0.15, startTime + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
          
          osc.start(startTime);
          osc.stop(startTime + duration);
        };
        
        const now = ctx.currentTime;
        playNote(523.25, now, 0.4);       // C5
        playNote(659.25, now + 0.12, 0.4); // E5
        playNote(783.99, now + 0.24, 0.4); // G5
        playNote(1046.50, now + 0.36, 0.6); // C6
      } catch (e) {
        console.error("Audio error", e);
      }
    }

    function playCorrectSound() {
      if (!window.AudioContext && !window.webkitAudioContext) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
        osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.1); // E6
        
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      } catch (e) {
        console.error("Audio error", e);
      }
    }

    function playIncorrectSound() {
      if (!window.AudioContext && !window.webkitAudioContext) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } catch (e) {
        console.error("Audio error", e);
      }
    }

    function playGameOverSound() {
      if (!window.AudioContext && !window.webkitAudioContext) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        const playNote = (freq, startTime, duration) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, startTime);
          
          gain.gain.setValueAtTime(0, startTime);
          gain.gain.linearRampToValueAtTime(0.12, startTime + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
          
          osc.start(startTime);
          osc.stop(startTime + duration);
        };
        
        const now = ctx.currentTime;
        playNote(220, now, 0.4);       // A3
        playNote(196, now + 0.25, 0.4); // G3
        playNote(165, now + 0.5, 0.8);  // E3
      } catch (e) {
        console.error("Audio error", e);
      }
    }

    function playThunderSound() {
      if (!window.AudioContext && !window.webkitAudioContext) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        const bufferSize = ctx.sampleRate * 2.0; // 2 seconds
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(300, ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(10, ctx.currentTime + 1.8);
        
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.8);
        
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        
        noise.start();
        noise.stop(ctx.currentTime + 2.0);
      } catch (e) {}
    }

    // -------------------------------------------------------------
    // Setup and Screen Transitions
    // -------------------------------------------------------------
    function showScreen(screenId) {
      if (screenId === 'start' && gameActive) {
        hasResetOccurred = true;
      }
      document.querySelectorAll('.view-screen').forEach(screen => {
        screen.classList.remove('active');
      });
      document.getElementById(`screen-${screenId}`).classList.add('active');
    }

    function selectColor(color) {
      if (gameActive) return; // Prevent color changes mid-game
      
      const goshikiColors = ['blue', 'pink', 'yellow', 'green', 'orange'];
      
      if (color === 'chaos') {
        if (selectedColors.length === 5) {
          selectedColors = ['blue'];
        } else {
          selectedColors = [...goshikiColors];
        }
      } else {
        const index = selectedColors.indexOf(color);
        if (index > -1) {
          if (selectedColors.length > 1) {
            selectedColors.splice(index, 1);
          } else {
            alert("少なくとも1つの色を選択してください。");
            return;
          }
        } else {
          selectedColors.push(color);
        }
      }
      
      // Update selectedColor string for backward compatibility
      if (selectedColors.length === 5) {
        selectedColor = 'chaos';
      } else if (selectedColors.length === 1) {
        selectedColor = selectedColors[0];
      } else {
        selectedColor = 'mix';
      }
      
      // Update sidebar buttons active states
      goshikiColors.forEach(col => {
        const btn = document.getElementById(`color-${col}`);
        if (btn) {
          if (selectedColors.includes(col)) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        }
      });
      
      const chaosBtn = document.getElementById('color-chaos');
      if (chaosBtn) {
        if (selectedColors.length === 5) {
          chaosBtn.classList.add('active');
        } else {
          chaosBtn.classList.remove('active');
        }
      }
      
      updateSelectedColorTheme();
      refreshColorButtonsLockState();
      if (typeof window.listenToRankings === 'function') {
        window.listenToRankings();
      }
    }

    function updateSelectedColorTheme() {
      const root = document.documentElement;
      let hexColor = '#2B5F8C';
      let rgbaColor = 'rgba(43, 95, 140, 0.1)';
      let jpName = '青色';

      if (selectedColor === 'mix') {
        hexColor = '#4f46e5';
        rgbaColor = 'rgba(79, 70, 229, 0.15)';
      } else {
        switch (selectedColor) {
          case 'blue':
            hexColor = 'var(--color-blue)';
            rgbaColor = 'rgba(43, 95, 140, 0.15)';
            jpName = '青色';
            break;
          case 'pink':
            hexColor = 'var(--color-pink)';
            rgbaColor = 'rgba(209, 91, 118, 0.15)';
            jpName = 'ピンク色';
            break;
          case 'yellow':
            hexColor = 'var(--color-yellow)';
            rgbaColor = 'rgba(217, 160, 54, 0.15)';
            jpName = '黄色';
            break;
          case 'green':
            hexColor = 'var(--color-green)';
            rgbaColor = 'rgba(62, 142, 98, 0.15)';
            jpName = '緑色';
            break;
          case 'orange':
            hexColor = 'var(--color-orange)';
            rgbaColor = 'rgba(217, 98, 54, 0.15)';
            jpName = 'オレンジ色';
            break;
          case 'chaos':
            hexColor = '#7c3aed';
            rgbaColor = 'rgba(124, 58, 237, 0.15)';
            jpName = 'カオスモード';
            break;
        }
      }

      root.style.setProperty('--theme-color', hexColor);
      root.style.setProperty('--theme-color-rgba', rgbaColor);
      
      const banner = document.getElementById('current-color-banner');
      if (banner) {
        if (selectedColor === 'chaos') {
          banner.textContent = '💥 カオスモード（全100枚）がセットされています 💥';
          banner.style.background = 'linear-gradient(to right, #4f46e5, #db2777)';
        } else if (selectedColor === 'mix') {
          const nameMap = { blue: '青', pink: '桃', yellow: '黄', green: '緑', orange: '橙' };
          const chosenJp = selectedColors.map(c => nameMap[c]).join('・');
          banner.textContent = `🎨 ミックスモード（${chosenJp} / 計${selectedColors.length * 20}枚）がセットされています`;
          banner.style.background = 'linear-gradient(to right, #4f46e5, #7c3aed)';
        } else {
          banner.textContent = `${jpName}の札（20枚）がセットされています`;
          banner.style.background = 'var(--theme-color)';
        }
      }
    }



    function setTextDisplay(bool) {
      showText = bool;
      document.getElementById('text-show').classList.toggle('active', bool);
      document.getElementById('text-hide').classList.toggle('active', !bool);
    }

    function updateSpeedLabel(val) {
      speechSpeed = parseFloat(val);
      document.getElementById('speed-label').textContent = val;
    }

    function setMissLimit(limit) {
      missLimit = limit;
      // Toggle active states on limit buttons
      const limits = [0, 1, 3, 5, 10];
      limits.forEach(l => {
        const btn = document.getElementById(`limit-${l}`);
        if (btn) {
          btn.classList.toggle('active', l === limit);
        }
      });
    }

    // -------------------------------------------------------------
    // goshikiStorage Records Management
    // -------------------------------------------------------------
    function loadRecords() {
      const storedTimes = goshikiStorage.getItem('goshiki_best_records');
      const storedMisses = goshikiStorage.getItem('goshiki_best_misses');
      
      if (storedTimes) {
        try {
          const parsed = JSON.parse(storedTimes);
          Object.keys(bestRecords).forEach(color => {
            bestRecords[color] = parsed[color] !== undefined ? parsed[color] : null;
          });
        } catch (e) {
          console.error("Failed to load records times", e);
        }
      }
      
      if (storedMisses) {
        try {
          const parsed = JSON.parse(storedMisses);
          Object.keys(bestMisses).forEach(color => {
            bestMisses[color] = parsed[color] !== undefined ? parsed[color] : null;
          });
        } catch (e) {
          console.error("Failed to load records misses", e);
        }
      }

      // Update sidebar DOM displays
      Object.keys(bestRecords).forEach(color => {
        const timeEl = document.getElementById(`best-${color}`);
        if (timeEl) {
          const t = bestRecords[color];
          const m = bestMisses[color];
          if (t !== null) {
            const mStr = m !== null ? `${m}回` : '--回';
            timeEl.textContent = `${formatTime(t)} (お手つき: ${mStr})`;
          } else {
            timeEl.textContent = '--:--.- (お手つき: --)';
          }
        }
      });
    }

    function saveRecord(color, timeMs, misses) {
      const currentBest = bestRecords[color];
      
      if (currentBest === null || timeMs < currentBest) {
        bestRecords[color] = timeMs;
        bestMisses[color] = misses;
        
        goshikiStorage.setItem('goshiki_best_records', JSON.stringify(bestRecords));
        goshikiStorage.setItem('goshiki_best_misses', JSON.stringify(bestMisses));
        
        const timeEl = document.getElementById(`best-${color}`);
        if (timeEl) {
          timeEl.textContent = `${formatTime(timeMs)} (お手つき: ${misses}回)`;
        }

        // Trigger "殿堂入り歌詠み" (Hall of Fame) if it's a strict update
        if (currentBest !== null) {
          let hofCount = parseInt(goshikiStorage.getItem('goshiki_title_count_hall_of_fame') || '0');
          hofCount++;
          goshikiStorage.setItem('goshiki_title_count_hall_of_fame', hofCount);
          if (typeof unlockSkin === 'function') {
            unlockSkin('hof');
          }
          window.lastGameCelebratedTitle = '殿堂入り歌詠み';
        }

        // Trigger "昨日を超える者" if sum of 5 colors improved
        const colors = ['blue', 'pink', 'yellow', 'green', 'orange'];
        const allCompleted = colors.every(col => bestRecords[col] !== null);
        if (allCompleted) {
          const currentSum = colors.reduce((acc, col) => acc + bestRecords[col], 0);
          const previousSum = parseFloat(goshikiStorage.getItem('goshiki_best_records_sum') || '999999999');
          if (currentSum < previousSum) {
            goshikiStorage.setItem('goshiki_best_records_sum', currentSum);
            let yesterdayCount = parseInt(goshikiStorage.getItem('goshiki_title_count_yesterday') || '0');
            yesterdayCount++;
            goshikiStorage.setItem('goshiki_title_count_yesterday', yesterdayCount);
            if (typeof unlockSkin === 'function') {
              unlockSkin('yesterday');
            }
            window.lastGameCelebratedTitle = '昨日を超える者';
          }
        }
        
        return true; // New record
      }
      return false;
    }

    function updateTotalAcquiredCount() {
      const count = goshikiStorage.getItem('goshiki_total_acquired') || 0;
      document.getElementById('total-acquired-cards').textContent = count;
    }

    function incrementTotalAcquiredCount(amount) {
      const current = parseInt(goshikiStorage.getItem('goshiki_total_acquired') || 0);
      const updated = current + amount;
      goshikiStorage.setItem('goshiki_total_acquired', updated);
      updateTotalAcquiredCount();
    }

    // Utility to format ms into mm:ss.d
    function formatTime(ms) {
      const totalSeconds = ms / 1000;
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = Math.floor(totalSeconds % 60);
      const deciseconds = Math.floor((ms % 1000) / 100);
      
      const minStr = String(minutes).padStart(2, '0');
      const secStr = String(seconds).padStart(2, '0');
      return `${minStr}:${secStr}.${deciseconds}`;
    }

    // Shuffle Array Utility
    function shuffleArray(array) {
      const arr = [...array];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    // -------------------------------------------------------------
    // Speech Synthesis Engine
    // -------------------------------------------------------------
    let speechUtterance = null;

    function speakText(text, onEndCallback) {
      if (!('speechSynthesis' in window)) {
        if (onEndCallback) onEndCallback();
        return;
      }

      window.speechSynthesis.cancel(); // Stop current playing speech
      
      speechUtterance = new SpeechSynthesisUtterance(text);
      speechUtterance.lang = "ja-JP";
      speechUtterance.rate = speechSpeed;

      const voices = window.speechSynthesis.getVoices();
      const jaVoice = voices.find(v => v.lang.includes("ja"));
      if (jaVoice) {
        speechUtterance.voice = jaVoice;
      }

      const wave = document.getElementById('reader-wave');
      wave.classList.add('speaking');

      speechUtterance.onend = () => {
        wave.classList.remove('speaking');
        
        // Track listened poem
        if (currentReadingPoemNo !== null) {
          let listened = [];
          try {
            listened = JSON.parse(goshikiStorage.getItem('goshiki_listened_poems_v2') || '[]');
          } catch(e) {}
          if (!listened.includes(currentReadingPoemNo)) {
            listened.push(currentReadingPoemNo);
            goshikiStorage.setItem('goshiki_listened_poems_v2', JSON.stringify(listened));
          }
          if (listened.length === 100) {
            checkBadgeUnlock('sommelier');
          }
        }

        if (onEndCallback) onEndCallback();
      };

      speechUtterance.onerror = (event) => {
        console.error("Speech error", event);
        wave.classList.remove('speaking');
        if (onEndCallback) onEndCallback();
      };

      window.speechSynthesis.speak(speechUtterance);
    }

    function retireGame() {
      if (!confirm("本当にあきらめますか？\nゲームをリタイアしてメニューに戻ります。")) return;
      
      clearInterval(timerInterval);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      
      gameActive = false;
      showScreen('start');
    }
    window.retireGame = retireGame;

    // -------------------------------------------------------------
    // Game Loop Logic
    // -------------------------------------------------------------
    function startGame() {
      // 1. Get Goshiki subset
      if (selectedColor === 'chaos') {
        currentSet = POEMS_DATA;
      } else if (selectedColor === 'mix') {
        currentSet = POEMS_DATA.filter(p => selectedColors.includes(p.color));
      } else {
        currentSet = POEMS_DATA.filter(p => p.color === selectedColor);
      }
      
      if (currentSet.length === 0) {
        alert("歌データがロードされていません。");
        return;
      }

      if (gameActive) {
        hasResetOccurred = true;
      } else {
        hasResetOccurred = false;
      }

      gameActive = true;
      missesCount = 0;
      targetIndex = 0;
      gameHistory = [];
      cardAttempts = {};
      sessionMisses = {};
      hasMissedCurrentCard = false;
      isInputLocked = false;
      consecutiveMisses = 0;
      hasTriggeredPenalty = false;
      pauseStartTime = null;
      window.lastGameCelebratedTitle = null;
      
      const celPanel = document.getElementById('result-title-celebration');
      if (celPanel) celPanel.style.display = 'none';
      
      document.getElementById('play-misses').textContent = '0';
      document.getElementById('cards-remaining').textContent = String(currentSet.length);
      document.getElementById('play-timer').classList.remove('timer-red-flash');

      // 2. Set reading order
      const indices = Array.from({length: currentSet.length}, (_, i) => i);
      shuffledOrder = shuffleArray(indices);

      // 3. Render cards in random layout on field
      renderBoard();

      // 4. Reset timer
      startTime = Date.now();
      document.getElementById('play-timer').textContent = "00:00.0";
      clearInterval(timerInterval);
      timerInterval = setInterval(updateTimer, 100);

      // 5. Change screen to play view
      showScreen('play');

      // 6. Trigger first poem read
      setTimeout(readNextPoem, 800);
    }

    function renderBoard() {
      const board = document.getElementById('playboard');
      board.innerHTML = '';
      
      // Shuffle the display cards as well
      const displayPoems = shuffleArray(currentSet);
      
      displayPoems.forEach(poem => {
        const card = document.createElement('div');
        let cardClass = "card-apprentice";
        if (playerLevel >= 21) {
          cardClass = "card-saint";
        } else if (playerLevel >= 16) {
          cardClass = "card-prodigy";
        } else if (playerLevel >= 11) {
          cardClass = "card-master";
        } else if (playerLevel >= 6) {
          cardClass = "card-intermediate";
        }
        const borderStyle = getCardStyle(playerLevel);
        const selectedSkin = goshikiStorage.getItem('goshiki_selected_skin') || 'default';
        card.className = `karuta-card ${cardClass} ${borderStyle} skin-${selectedSkin}`;
        card.id = `card-${poem.no}`;
        card.onclick = () => handleCardTap(poem.no);

        // Split text for standard multi-column representation on cards
        const parts = poem.simo_kana.split(' ');
        const textContainer = document.createElement('div');
        textContainer.className = 'karuta-card-text';
        
        parts.forEach(part => {
          const lineSpan = document.createElement('span');
          lineSpan.className = 'karuta-card-line';
          lineSpan.textContent = part;
          textContainer.appendChild(lineSpan);
        });

        card.appendChild(textContainer);
        board.appendChild(card);
      });
    }

    function updateTimer() {
      const elapsed = Date.now() - startTime;
      document.getElementById('play-timer').textContent = formatTime(elapsed);
    }

    function readNextPoem() {
      if (targetIndex >= currentSet.length) {
        endGame();
        return;
      }

      // Resume timer if paused
      if (pauseStartTime !== null) {
        const pauseDuration = Date.now() - pauseStartTime;
        startTime += pauseDuration;
        pauseStartTime = null;
        if (!timerInterval) {
          timerInterval = setInterval(updateTimer, 100);
        }
      }

      hasMissedCurrentCard = false;
      const poemIndex = shuffledOrder[targetIndex];
      const targetPoem = currentSet[poemIndex];
      currentReadingPoemNo = targetPoem.no;
      cardAttempts[targetPoem.no] = { firstTryOk: true, misses: 0, startTime: Date.now() };

      // Determine text display and voice read text based on mode
      let labelText = '';
      let displayPhrase = '';
      let speechPhrase = '';

      if (playMode === 'traditional') {
        labelText = '上の句を読み上げています...';
        displayPhrase = showText ? targetPoem.kami : '（上の句を音声で聞いてください）';
        speechPhrase = targetPoem.kami_kana;
      } else {
        labelText = '下の句を読み上げています...';
        displayPhrase = showText ? targetPoem.simo : '（下の句を音声で聞いてください）';
        speechPhrase = targetPoem.simo_kana;
      }

      document.getElementById('current-reading-phase').textContent = labelText;
      document.getElementById('reading-text-display').textContent = displayPhrase;

      // Speak
      speakText(speechPhrase);
    }

    function replayAudio() {
      if (!gameActive) return;
      const poemIndex = shuffledOrder[targetIndex];
      const targetPoem = currentSet[poemIndex];
      const speechPhrase = playMode === 'traditional' ? targetPoem.kami_kana : targetPoem.simo_kana;
      speakText(speechPhrase);
    }

    function handleCardTap(cardNo) {
      if (!gameActive || isInputLocked) return;

      const activePoemIndex = shuffledOrder[targetIndex];
      const currentTargetPoem = currentSet[activePoemIndex];

      const tappedCard = document.getElementById(`card-${cardNo}`);
      
      if (cardNo === currentTargetPoem.no) {
        // Correct answer!
        isInputLocked = true;
        consecutiveMisses = 0; // Reset consecutive misses on correct hit
        
        // Pause game timer immediately
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
        pauseStartTime = Date.now();

        tappedCard.classList.add('correct');
        playCorrectSound();
        addXP(10);
        
        // Record accuracy and reaction stats to goshikiStorage
        if (cardAttempts[cardNo]) {
          const reactionTime = Date.now() - cardAttempts[cardNo].startTime;
          let stats = {};
          try {
            stats = JSON.parse(goshikiStorage.getItem('goshiki_card_stats_v2') || '{}');
          } catch(e) {}
          if (!stats[cardNo]) {
            stats[cardNo] = { taps: 0, correct: 0, totalTime: 0, misses: 0 };
          }
          stats[cardNo].taps++;
          stats[cardNo].correct++;
          stats[cardNo].totalTime += reactionTime;
          goshikiStorage.setItem('goshiki_card_stats_v2', JSON.stringify(stats));
        }
        
        // Track card taken for hidden achievement
        let takenCards = [];
        try {
          takenCards = JSON.parse(goshikiStorage.getItem('goshiki_taken_cards_v2') || '[]');
        } catch(e) {}
        if (!takenCards.includes(cardNo)) {
          takenCards.push(cardNo);
          goshikiStorage.setItem('goshiki_taken_cards_v2', JSON.stringify(takenCards));
          refreshColorButtonsLockState();
        }
        
        // Record review stat
        gameHistory.push({
          poem: currentTargetPoem,
          ok: !hasMissedCurrentCard
        });

        targetIndex++;
        document.getElementById('cards-remaining').textContent = String(currentSet.length - targetIndex);

        // Cancel current sound and read next
        window.speechSynthesis.cancel();
        
        if (targetIndex < currentSet.length) {
          setTimeout(() => {
            readNextPoem();
            isInputLocked = false;
          }, 800); // 0.8s input lock and timer pause transition
        } else {
          setTimeout(() => {
            endGame();
            isInputLocked = false;
          }, 800);
        }
      } else {
        // Incorrect answer (Oteつき)
        if (!tappedCard.classList.contains('correct')) {
          consecutiveMisses++;
          
          tappedCard.classList.add('incorrect');
          playIncorrectSound();
          setTimeout(() => {
            tappedCard.classList.remove('incorrect');
          }, 400);

          hasMissedCurrentCard = true;
          missesCount++;
          document.getElementById('play-misses').textContent = String(missesCount);

          // Record incorrect stats to goshikiStorage and session misses
          const currentNo = currentTargetPoem.no;
          if (cardAttempts[currentNo]) {
            cardAttempts[currentNo].firstTryOk = false;
            cardAttempts[currentNo].misses++;
          }
          sessionMisses[currentNo] = (sessionMisses[currentNo] || 0) + 1;

          let stats = {};
          try {
            stats = JSON.parse(goshikiStorage.getItem('goshiki_card_stats_v2') || '{}');
          } catch(e) {}
          if (!stats[currentNo]) {
            stats[currentNo] = { taps: 0, correct: 0, totalTime: 0, misses: 0 };
          }
          stats[currentNo].taps++;
          stats[currentNo].misses++;
          goshikiStorage.setItem('goshiki_card_stats_v2', JSON.stringify(stats));
          
          // Check consecutive misses penalty
          if (consecutiveMisses >= 3) {
            triggerConsecutiveMissesPenalty();
            return;
          }

          // Check miss limit
          if (missLimit > 0 && missesCount >= missLimit) {
            setTimeout(triggerGameOver, 500);
            return;
          }
          
          // Add 3-second penalty visually to the timer by adjusting startTime back
          startTime -= 3000;
        }
      }
    }

    function triggerConsecutiveMissesPenalty() {
      isInputLocked = true;
      hasTriggeredPenalty = true;
      consecutiveMisses = 0;
      
      // Pause timer during penalty
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      const penaltyStartTime = Date.now();
      
      const overlay = document.getElementById('penalty-overlay');
      const timerText = document.getElementById('penalty-overlay-timer');
      if (overlay && timerText) {
        overlay.style.display = 'flex';
        timerText.textContent = '3';
        
        let secondsLeft = 3;
        const interval = setInterval(() => {
          secondsLeft--;
          if (secondsLeft <= 0) {
            clearInterval(interval);
            overlay.style.display = 'none';
            isInputLocked = false;
            
            // Adjust startTime for the time spent in penalty
            const pauseDuration = Date.now() - penaltyStartTime;
            startTime += pauseDuration;
            
            if (gameActive) {
              timerInterval = setInterval(updateTimer, 100);
            }
          } else {
            timerText.textContent = String(secondsLeft);
          }
        }, 1000);
      } else {
        isInputLocked = false;
      }
    }

    function triggerGameOver() {
      gameActive = false;
      clearInterval(timerInterval);
      window.speechSynthesis.cancel();
      playGameOverSound();

      // Submit miss stats to Firebase
      if (typeof window.submitMissStatsToFirebase === 'function') {
        window.submitMissStatsToFirebase(sessionMisses);
      }
      updateCoachAdvice();

      // Show acquired count and misses count
      document.getElementById('game-over-acquired').textContent = String(targetIndex);
      document.getElementById('game-over-misses').textContent = `${missesCount}回`;

      showScreen('game-over');
    }

    // -------------------------------------------------------------
    // Game Completion & Results
    // -------------------------------------------------------------
    function endGame() {
      gameActive = false;
      clearInterval(timerInterval);
      window.speechSynthesis.cancel();

      const elapsed = Date.now() - startTime;
      lastGameElapsed = elapsed;
      const clearSeconds = (elapsed / 1000).toFixed(1);
      
      // Update UI results to show requested message: "クリア！タイムは〇〇秒"
      document.getElementById('result-clear-time').textContent = `クリア！タイムは ${clearSeconds} 秒`;
      document.getElementById('result-misses').textContent = `${missesCount}回`;
      
      const accuracy = Math.round((currentSet.length / (currentSet.length + missesCount)) * 100);
      document.getElementById('result-accuracy').textContent = `${accuracy}%`;

      // Save Best Record
      const isNewRecord = saveRecord(selectedColor, elapsed, missesCount);
      if (isNewRecord) {
        alert("自己ベストを更新しました！🎉");
      }

      // Save total cards taken
      incrementTotalAcquiredCount(currentSet.length);

      // Render Review List
      renderReviewList();

      // Reset ranking submission UI based on penalty state
      const panel = document.getElementById('ranking-submission-panel');
      const warning = document.getElementById('ranking-penalty-warning');
      
      if (hasTriggeredPenalty) {
        if (panel) panel.style.display = 'none';
        if (warning) warning.style.display = 'block';
      } else {
        if (panel) panel.style.display = 'block';
        if (warning) warning.style.display = 'none';
        
        const submitBtn = document.getElementById('ranking-submit-btn');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '送信する';
        }
        const statusMsg = document.getElementById('ranking-status-msg');
        if (statusMsg) {
          statusMsg.textContent = '';
        }
      }

      // Submit miss stats to Firebase
      if (typeof window.submitMissStatsToFirebase === 'function') {
        window.submitMissStatsToFirebase(sessionMisses);
      }
      updateCoachAdvice();

      showScreen('results');
      
      // Check for secret achievements
      checkSecretAchievements(elapsed);
      checkBadgeAchievements(elapsed);
    }

    function renderReviewList() {
      const container = document.getElementById('review-list-container');
      container.innerHTML = '';

      gameHistory.forEach(item => {
        const row = document.createElement('div');
        row.className = 'review-item';

        const statusClass = item.ok ? 'status-ok' : 'status-ng';
        const statusChar = item.ok ? '○' : '×';
        
        row.innerHTML = `
          <div class="review-no">${item.poem.no}</div>
          <div class="review-status ${statusClass}">${statusChar}</div>
          <div class="review-text-container">
            <div class="review-kami">${item.poem.kami}</div>
            <div class="review-simo">${item.poem.simo}</div>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); font-family: sans-serif;">
            ${item.poem.sakusya}
          </div>
        `;
        container.appendChild(row);
      });
    }

    // -------------------------------------------------------------
    // Achievements & Secret Titles System
    // -------------------------------------------------------------
    const SECRET_TITLES = [
      { id: 1, name: "一色の覇者", icon: "🥉", req: "いずれか1つの色をノーミスクリア", desc: "特定の色の札を完全にマスターした、最初の栄冠！" },
      { id: 2, name: "二色の賢者", icon: "🥈", req: "いずれか2つの色をノーミスクリア", desc: "集中力を高め、2つの色を完全に制覇した知恵 of 探求者！" },
      { id: 3, name: "三色の達人", icon: "🥇", req: "いずれか3つの色をノーミスクリア", desc: "抜群の正確さを持つ、三色の極みを極めたる達人！" },
      { id: 4, name: "四色の猛者", icon: "⚔️", req: "いずれか4つの色をノーミスクリア", desc: "いかなる歌が詠まれても乱れない、百戦錬磨のかるた武者！" },
      { id: 5, name: "五色の神歌聖", icon: "👑", req: "すべての色（5色）をノーミスクリア", desc: "すべての歌を一言一句違わず聞き取る、かるた界に君臨せし絶対無二の神歌聖！" }
    ];

    function checkSecretAchievements(elapsed) {
      let perfectColors = [];
      let specialAchievements = [];
      try {
        perfectColors = JSON.parse(goshikiStorage.getItem('goshiki_perfect_colors') || '[]');
      } catch(e) {}
      try {
        const oldSpecial = JSON.parse(goshikiStorage.getItem('goshiki_special_achievements') || '[]');
        const newSpecial = JSON.parse(goshikiStorage.getItem('goshiki_special_achievements_v2') || '[]');
        specialAchievements = [...new Set([...oldSpecial, ...newSpecial])];
      } catch(e) {}

      let delayTime = 800;

      // Helper to unlock and save special achievement to v2 key
      function unlockSpecial(key) {
        if (!specialAchievements.includes(key)) {
          specialAchievements.push(key);
        }
        goshikiStorage.setItem('goshiki_special_achievements_v2', JSON.stringify(specialAchievements));
      }

      // 1. Normal perfect color check (excludes Chaos and Mix modes)
      if (missesCount === 0 && selectedColor !== 'chaos' && selectedColor !== 'mix') {
        if (!perfectColors.includes(selectedColor)) {
          perfectColors.push(selectedColor);
          goshikiStorage.setItem('goshiki_perfect_colors', JSON.stringify(perfectColors));
          
          setTimeout(() => {
            showAchievementUnlockOverlay(perfectColors.length);
            showConfetti();
          }, delayTime);
          delayTime += 4500;
        }
      }

      // 2. "最強の4年生" Achievement (unlocked when all 5 colors cleared with 0 misses)
      if (perfectColors.length === 5) {
        const alreadyHasStrongest = specialAchievements.includes('strongest_4th_grader');
        if (!alreadyHasStrongest) {
          unlockSpecial('strongest_4th_grader');
          
          setTimeout(() => {
            const overlay = document.getElementById('strongest-banner');
            if (overlay) overlay.style.display = 'flex';
            
            // Spawn gold glow overlay
            const glow = document.createElement('div');
            glow.className = 'gold-glow-overlay';
            document.body.appendChild(glow);
            setTimeout(() => glow.remove(), 2500);

            playCelebrationSound();
            showConfetti();

            setTimeout(() => {
              if (overlay) overlay.style.display = 'none';
            }, 4000);
          }, delayTime);
          delayTime += 4500;
        }
      }

      // 3. "神速！" Achievement (20 cards under 1 minute / 60000ms)
      if (currentSet.length === 20 && elapsed <= 60000) {
        document.getElementById('result-clear-time').classList.add('timer-red-flash');
        
        const alreadyHasGodspeed = specialAchievements.includes('godspeed');
        if (!alreadyHasGodspeed) {
          unlockSpecial('godspeed');
          
          setTimeout(() => {
            const overlay = document.getElementById('godspeed-banner');
            if (overlay) overlay.style.display = 'flex';
            
            playThunderSound();

            setTimeout(() => {
              if (overlay) overlay.style.display = 'none';
            }, 4000);
          }, delayTime);
          delayTime += 4500;
        }
      }

      // 4. "究極の歌聖" Achievement (0 misses in Chaos Mode)
      if (selectedColor === 'chaos' && missesCount === 0) {
        const alreadyHasUltimate = specialAchievements.includes('ultimate_song_saint');
        if (!alreadyHasUltimate) {
          unlockSpecial('ultimate_song_saint');
          
          setTimeout(() => {
            const overlay = document.getElementById('ultimate-saint-banner');
            if (overlay) overlay.style.display = 'flex';
            
            // Turn on the golden theme immediately and permanently save it
            toggleGoldTheme(true);

            // Play the applause and spawn gold sparks
            playApplauseSound();
            spawnGoldSparks();
            showConfetti();

            setTimeout(() => {
              if (overlay) overlay.style.display = 'none';
            }, 4500);
          }, delayTime);
        }
      }
    }

    const NEW_ACHIEVEMENTS = [
      { key: "goshiki_complete", name: "五色コンプリート", icon: "🎨", req: "全5色それぞれで1回ずつクリアする", desc: "すべてのお札の色を体験した、バラエティ豊かな歌い手！", color: "#3b82f6" },
      { key: "early_bird", name: "早起きは三文の徳", icon: "🌅", req: "朝8時台に練習をクリアする", desc: "朝の新鮮な空気の中で頭をすっきりさせ、かるたを修めた証！", color: "#f97316" },
      { key: "silent_reader", name: "静寂の歌詠み", icon: "🤫", req: "やり直しなし・おてつき0回で1色クリアする", desc: "雑念を排し、ただ静かに完璧な勝利を収めた孤高の歌詠み！", color: "#10b981" },
      { key: "seven_dawn", name: "七色の夜明け", icon: "🌈", req: "カオスモードで5分以上かけて全100枚をクリアする", desc: "じっくりと時間をかけ、百枚すべての歌と向き合い続けた粘り強さの証！", color: "#ec4899" },
      { key: "guardian_cards", name: "札の守護者", icon: "🛡️", req: "全100枚の札を少なくとも一度ずつ取る", desc: "百首すべてのお札を手中に収めた、百人一首の偉大なる守護者！", color: "#8b5cf6" },
      { key: "traveler", name: "百人一首の旅人", icon: "🧳", req: "アプリの起動回数が100回に到達する", desc: "百人一首の道を果てしなく歩み続ける、真の旅人！", color: "#06b6d4" },
      { key: "fluke_master", name: "まぐれの達人", icon: "🍀", req: "タイムが3分以上でのクリア時に、まれに発動する", desc: "思わぬ幸運に恵まれ、まぐれで勝利を掴み取った愛されし達人！", color: "#84cc16" },
      { key: "sommelier", name: "歌のソムリエ", icon: "🍷", req: "全100首の解説を読み終える（読破する）", desc: "百首すべての歌の現代語訳と意味を解説で読み解き、真の教養を身に付けた至高のソムリエ！", color: "#db2777" },
      { key: "bonds_five", name: "五色の絆", icon: "🤝", req: "ミックスモードで2色以上を組み合わせて10回クリアする", desc: "様々な色を複雑に組み合わせた修行を十度も乗り越えた強固な絆！", color: "#eab308" },
      { key: "mix_master_40", name: "ミックスの使い手（40枚）", icon: "⚔️", req: "ミックス40枚コースで初めてランキング入りする", desc: "2つの色が入り乱れる戦場を征し、見事ランキング入りを果たした実力者！", color: "#4f46e5" },
      { key: "mix_master_60", name: "ミックスの達人（60枚）", icon: "🔱", req: "ミックス60枚コースで初めてランキング入りする", desc: "3つの色が複雑に交錯する中で素早く札を見極めた、ミックスの熟練者！", color: "#06b6d4" },
      { key: "mix_master_80", name: "ミックスの覇者（80枚）", icon: "👑", req: "ミックス80枚コースで初めてランキング入りする", desc: "4色80枚という極限の混戦を制して玉座を勝ち取った、ミックス界の絶対王者！", color: "#ec4899" }
    ];

    function hexToRgbStr(hex) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `${r}, ${g}, ${b}`;
    }

    function checkBadgeUnlock(key) {
      let unlockedBadges = [];
      try {
        unlockedBadges = JSON.parse(goshikiStorage.getItem('goshiki_unlocked_badges_v2') || '[]');
      } catch(e) {}
      
      if (!unlockedBadges.includes(key)) {
        unlockedBadges.push(key);
        goshikiStorage.setItem('goshiki_unlocked_badges_v2', JSON.stringify(unlockedBadges));
        if (typeof checkSkinUnlocks === 'function') {
          checkSkinUnlocks();
        }
        
        const badgeInfo = NEW_ACHIEVEMENTS.find(b => b.key === key);
        if (badgeInfo) {
          const root = document.documentElement;
          root.style.setProperty('--badge-theme-color', badgeInfo.color);
          root.style.setProperty('--badge-theme-color-rgba', `${badgeInfo.color}15`);
          root.style.setProperty('--badge-theme-color-rgb', hexToRgbStr(badgeInfo.color));
          
          document.getElementById('popup-badge-icon').textContent = badgeInfo.icon;
          document.getElementById('popup-badge-name').textContent = badgeInfo.name;
          document.getElementById('popup-badge-desc').textContent = badgeInfo.desc;
          
          const overlay = document.getElementById('badge-unlock-banner');
          if (overlay) overlay.style.display = 'flex';
          
          playCelebrationSound();
          showConfetti();
          
          setTimeout(() => {
            if (overlay) overlay.style.display = 'none';
          }, 4500);
        }
      }
    }

    function checkBadgeAchievements(elapsed) {
      // 1. Cleared colors collection
      if (selectedColor !== 'chaos' && selectedColor !== 'mix') {
        let clearedColors = [];
        try {
          clearedColors = JSON.parse(goshikiStorage.getItem('goshiki_cleared_colors_v2') || '[]');
        } catch(e) {}
        if (!clearedColors.includes(selectedColor)) {
          clearedColors.push(selectedColor);
          goshikiStorage.setItem('goshiki_cleared_colors_v2', JSON.stringify(clearedColors));
        }
        
        if (clearedColors.length === 5) {
          checkBadgeUnlock('goshiki_complete');
        }
      }
      
      // 2. Early bird check (8:00 AM to 8:59 AM)
      const currentHour = new Date().getHours();
      if (currentHour === 8) {
        checkBadgeUnlock('early_bird');
      }
      
      // 3. Silent reader check (no misses, no reset mid-game, 1 color cleared)
      if (missesCount === 0 && !hasResetOccurred && selectedColor !== 'chaos' && selectedColor !== 'mix') {
        checkBadgeUnlock('silent_reader');
      }
      
      // 4. Seven dawn check (chaos mode, 5 mins = 300000ms or more)
      if (selectedColor === 'chaos' && elapsed >= 300000) {
        checkBadgeUnlock('seven_dawn');
      }
      
      // 5. Guardian of cards check (all 100 cards taken)
      let takenCards = [];
      try {
        takenCards = JSON.parse(goshikiStorage.getItem('goshiki_taken_cards_v2') || '[]');
      } catch(e) {}
      if (takenCards.length === 100) {
        checkBadgeUnlock('guardian_cards');
      }
      
      // 6. Fluke master check (slow time, 3 mins = 180000ms or more, random)
      if (currentSet.length === 20 && elapsed >= 180000 && Math.random() < 0.5) {
        checkBadgeUnlock('fluke_master');
      }
      
      // 7. Sommelier check (100 poems read/explained)
      let readCards = [];
      try {
        readCards = JSON.parse(goshikiStorage.getItem('goshiki_read_poems') || '[]');
      } catch(e) {}
      if (readCards.length === 100) {
        checkBadgeUnlock('sommelier');
      }
      
      // 8. Bonds of five check (mix mode with 2 or more colors, 10 clears)
      if (selectedColor === 'mix' && selectedColors.length >= 2) {
        let mixClears = parseInt(goshikiStorage.getItem('goshiki_mix_clears_count') || '0');
        mixClears++;
        goshikiStorage.setItem('goshiki_mix_clears_count', mixClears);
        if (mixClears >= 10) {
          checkBadgeUnlock('bonds_five');
        }
      }
    }

    // -------------------------------------------------------------
    // Design Skins System (Card custom backgrounds)
    // -------------------------------------------------------------
    const CARD_SKINS = [
      { id: 'default', name: 'デフォルト緑札', type: 'initial', hint: '最初から使えます' },
      { id: 'apprentice', name: '見習い歌詠み', type: 'title', hint: '称号「見習い歌詠み」を獲得する' },
      { id: 'novice', name: '初歩の歌詠み', type: 'title', hint: '称号「初歩の歌詠み」（レベル51到達）を獲得する' },
      { id: 'chihaya', name: '千早の使い手', type: 'title', hint: '称号「千早の使い手」（レベル101到達）を獲得する' },
      { id: 'wind', name: '五色の風使い', type: 'title', hint: '称号「五色の風使い」（レベル151到達）を獲得する' },
      { id: 'artisan', name: '競技の匠', type: 'title', hint: '称号「競技の匠」（レベル201到達）を獲得する' },
      { id: 'guardian', name: '札の守護者', type: 'title', hint: '実績「札の守護者」（全100枚獲得）を獲得する' },
      { id: 'goshiki-comp', name: '五色コンプリート', type: 'badge', hint: '実績「五色コンプリート」（全5色クリア）を獲得する' },
      { id: 'early-bird', name: '早起きは三文の徳', type: 'badge', hint: '実績「早起きは三文の徳」（朝8時台クリア）を獲得する' },
      { id: 'silent', name: '静寂の歌詠み', type: 'badge', hint: '実績「静寂の歌詠み」（ノーミス＆ノーリセットクリア）を獲得する' },
      { id: 'voyager', name: '百人一首の旅人', type: 'badge', hint: '実績「百人一首の旅人」（起動回数100回到達）を獲得する' },
      { id: 'fluke', name: 'まぐれの達人', type: 'badge', hint: '実績「まぐれの達人」を獲得する' },
      { id: 'sommelier', name: 'ソムリエ', type: 'badge', hint: '実績「ソムリエ」（全100首読破）を獲得する' },
      { id: 'bonds', name: '五色の絆', type: 'badge', hint: '実績「五色の絆」（ミックスモード10回クリア）を獲得する' },
      { id: 'hof', name: '殿堂入り歌詠み', type: 'badge', hint: '特別称号「殿堂入り歌詠み」（自己ベストタイム更新）を獲得する' },
      { id: 'yesterday', name: '昨日を超える者', type: 'badge', hint: '特別称号「昨日を超える者」（5色合計タイム更新）を獲得する' },
      // Rare
      { id: 'top-challenger', name: '頂上の挑戦者', type: 'rare', hint: '特別称号「頂上の挑戦者」（全国ランキング1位更新）を獲得する' },
      { id: 'chaos-master', name: 'カオス完全制覇', type: 'rare', hint: '実績「七色の夜明け」（カオスモード5分以上かけてクリア）を獲得する' },
      { id: 'king-gold', name: '百人一首の覇王', type: 'rare', hint: '称号「最強の歌詠み」（レベル401到達）を獲得する' },
      { id: 'rainbow-sage', name: '虹の歌聖', type: 'rare', hint: '称号「百人一首の歌聖」（レベル500到達）を獲得する' }
    ];

    function openSkinsModal() {
      checkSkinUnlocks();
      document.getElementById('skins-modal').style.display = 'flex';
      renderSkinsGrid();
    }
    window.openSkinsModal = openSkinsModal;

    function closeSkinsModal() {
      document.getElementById('skins-modal').style.display = 'none';
    }
    window.closeSkinsModal = closeSkinsModal;

    function unlockSkin(skinName) {
      let unlocked = [];
      try {
        unlocked = JSON.parse(goshikiStorage.getItem('goshiki_unlocked_skins') || '["default"]');
      } catch (e) {}
      
      if (!unlocked.includes(skinName)) {
        unlocked.push(skinName);
        goshikiStorage.setItem('goshiki_unlocked_skins', JSON.stringify(unlocked));
        
        const skin = CARD_SKINS.find(s => s.id === skinName);
        if (skin) {
          showSkinUnlockOverlay(skin.name, skin.id);
        }
      }
    }
    window.unlockSkin = unlockSkin;

    function showSkinUnlockOverlay(skinName, skinId) {
      const banner = document.getElementById('skin-unlock-banner');
      const nameEl = document.getElementById('popup-skin-name');
      const previewEl = document.getElementById('popup-skin-preview');
      
      if (banner && nameEl && previewEl) {
        nameEl.textContent = skinName;
        previewEl.className = `karuta-card skin-${skinId}`;
        banner.style.display = 'flex';
        playCelebrationSound();
      }
    }
    window.showSkinUnlockOverlay = showSkinUnlockOverlay;

    function checkSkinUnlocks() {
      unlockSkin('default');
      unlockSkin('apprentice');
      
      if (playerLevel >= 51) unlockSkin('novice');
      if (playerLevel >= 101) unlockSkin('chihaya');
      if (playerLevel >= 151) unlockSkin('wind');
      if (playerLevel >= 201) unlockSkin('artisan');
      if (playerLevel >= 401) unlockSkin('king-gold');
      if (playerLevel >= 500) unlockSkin('rainbow-sage');
      
      let unlockedBadges = [];
      try {
        unlockedBadges = JSON.parse(goshikiStorage.getItem('goshiki_unlocked_badges_v2') || '[]');
      } catch(e) {}
      
      if (unlockedBadges.includes('goshiki_complete')) unlockSkin('goshiki-comp');
      if (unlockedBadges.includes('early_bird')) unlockSkin('early-bird');
      if (unlockedBadges.includes('silent_reader')) unlockSkin('silent');
      if (unlockedBadges.includes('voyager')) unlockSkin('voyager');
      if (unlockedBadges.includes('fluke_master')) unlockSkin('fluke');
      if (unlockedBadges.includes('sommelier')) unlockSkin('sommelier');
      if (unlockedBadges.includes('bonds_five')) unlockSkin('bonds');
      if (unlockedBadges.includes('guardian_cards')) unlockSkin('guardian');
      if (unlockedBadges.includes('seven_dawn')) unlockSkin('chaos-master');
      
      const hofCount = parseInt(goshikiStorage.getItem('goshiki_title_count_hall_of_fame') || '0');
      if (hofCount > 0) unlockSkin('hof');
      
      const yesterdayCount = parseInt(goshikiStorage.getItem('goshiki_title_count_yesterday') || '0');
      if (yesterdayCount > 0) unlockSkin('yesterday');
      
      const topCount = parseInt(goshikiStorage.getItem('goshiki_title_count_top_challenger') || '0');
      if (topCount > 0) unlockSkin('top-challenger');
    }
    window.checkSkinUnlocks = checkSkinUnlocks;

    function renderSkinsGrid() {
      const grid = document.getElementById('skins-grid');
      if (!grid) return;
      grid.innerHTML = '';
      
      let unlocked = [];
      try {
        unlocked = JSON.parse(goshikiStorage.getItem('goshiki_unlocked_skins') || '["default"]');
      } catch(e) {}
      
      const currentSkin = goshikiStorage.getItem('goshiki_selected_skin') || 'default';
      
      const countEl = document.getElementById('skins-unlocked-count');
      if (countEl) countEl.textContent = String(debugModeEnabled ? CARD_SKINS.length : unlocked.length);
      
      CARD_SKINS.forEach(skin => {
        const slot = document.createElement('div');
        slot.style.background = '#fff';
        slot.style.border = '1px solid #e2e8f0';
        slot.style.borderRadius = '12px';
        slot.style.padding = '1rem';
        slot.style.display = 'flex';
        slot.style.flexDirection = 'column';
        slot.style.alignItems = 'center';
        slot.style.gap = '0.8rem';
        slot.style.position = 'relative';
        slot.style.boxShadow = 'var(--shadow-sm)';
        
        const isUnlocked = debugModeEnabled || unlocked.includes(skin.id);
        const isApplied = currentSkin === skin.id;
        
        const cardPreview = document.createElement('div');
        cardPreview.className = `karuta-card skin-${skin.id}`;
        cardPreview.style.width = '80px';
        cardPreview.style.height = '110px';
        cardPreview.style.borderRadius = '6px';
        cardPreview.style.display = 'flex';
        cardPreview.style.alignItems = 'center';
        cardPreview.style.justifyContent = 'center';
        cardPreview.style.boxShadow = 'var(--shadow-sm)';
        cardPreview.style.pointerEvents = 'none';
        
        const text = document.createElement('div');
        text.className = 'karuta-card-text';
        text.style.writingMode = 'vertical-rl';
        text.style.textOrientation = 'upright';
        text.style.fontFamily = 'serif';
        text.style.fontWeight = 'bold';
        text.style.fontSize = '0.8rem';
        text.textContent = 'とりふだ';
        cardPreview.appendChild(text);
        
        if (!isUnlocked) {
          cardPreview.style.filter = 'blur(4px) grayscale(1)';
          cardPreview.style.opacity = '0.4';
        }
        slot.appendChild(cardPreview);
        
        const nameLabel = document.createElement('div');
        nameLabel.style.fontWeight = 'bold';
        nameLabel.style.fontSize = '0.9rem';
        nameLabel.style.textAlign = 'center';
        nameLabel.textContent = isUnlocked ? skin.name : '？？？';
        slot.appendChild(nameLabel);
        
        if (isUnlocked) {
          const actionBtn = document.createElement('button');
          actionBtn.style.padding = '0.4rem 1.2rem';
          actionBtn.style.fontSize = '0.8rem';
          actionBtn.style.fontWeight = 'bold';
          actionBtn.style.borderRadius = '6px';
          actionBtn.style.cursor = 'pointer';
          actionBtn.style.border = 'none';
          
          if (isApplied) {
            actionBtn.style.background = '#e2e8f0';
            actionBtn.style.color = '#64748b';
            actionBtn.textContent = '適用中';
            actionBtn.disabled = true;
          } else {
            actionBtn.style.background = 'var(--theme-color)';
            actionBtn.style.color = '#fff';
            actionBtn.textContent = '適用する';
            actionBtn.onclick = () => {
              goshikiStorage.setItem('goshiki_selected_skin', skin.id);
              renderSkinsGrid();
            };
          }
          slot.appendChild(actionBtn);
        } else {
          const lockEl = document.createElement('div');
          lockEl.style.fontSize = '1.3rem';
          lockEl.style.color = '#94a3b8';
          lockEl.innerHTML = '🔒';
          slot.appendChild(lockEl);
          
          slot.title = `【解放条件】${skin.hint}`;
          slot.style.cursor = 'help';
          
          const hintLabel = document.createElement('div');
          hintLabel.style.fontSize = '0.72rem';
          hintLabel.style.color = '#64748b';
          hintLabel.style.textAlign = 'center';
          hintLabel.textContent = 'タップで条件を表示';
          slot.appendChild(hintLabel);
          
          slot.onclick = () => {
            alert(`【解放条件】\n${skin.hint}`);
          };
        }
        
        grid.appendChild(slot);
      });
    }
    window.renderSkinsGrid = renderSkinsGrid;

    // -------------------------------------------------------------
    // Growth Road Map System (Levels 1 to 500 & Titles Timeline)
    // -------------------------------------------------------------
    function getLevelProgress(xp) {
      const level = getLevel(xp);
      const neededXP = getXpNeededForNextLevel(level);
      const currentLevelXP = getXpInCurrentLevel(xp, level);
      return Math.min(100, Math.floor((currentLevelXP / neededXP) * 100));
    }

    window.getLevelProgress = getLevelProgress;

    function openGrowthRoadModal() {
      document.getElementById('growth-road-modal').style.display = 'flex';
      
      // Update header details
      document.getElementById('growth-summary-level').textContent = playerLevel;
      
      const titleName = getCurrentTitle(playerLevel);
      document.getElementById('growth-summary-title').textContent = titleName;
      document.getElementById('growth-summary-xp').textContent = playerXP;
      
      const rank = getRankInfo(playerLevel);
      document.getElementById('growth-summary-levels-left').textContent = String(rank.levelsToNext);
      
      // Render components
      renderGrowthRoadTimeline();
      renderGrowthRoadGrid();
      
      // Auto scroll to current level cell
      setTimeout(() => {
        const currentCell = document.getElementById(`roadmap-cell-${playerLevel}`);
        if (currentCell) {
          currentCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);
    }

    window.openGrowthRoadModal = openGrowthRoadModal;

    function closeGrowthRoadModal() {
      document.getElementById('growth-road-modal').style.display = 'none';
    }

    window.closeGrowthRoadModal = closeGrowthRoadModal;

    function renderGrowthRoadTimeline() {
      const container = document.getElementById('growth-timeline-container');
      if (!container) return;
      container.innerHTML = '';

      const titleIcons = {
        "見習い歌詠み": "🔰",
        "初歩の歌詠み": "📖",
        "千早の使い手": "🍁",
        "五色の風使い": "🍃",
        "競技の匠": "🥋",
        "決まり字の支配者": "⚡",
        "百人一首の守護者": "🛡️",
        "五色の賢者": "🧠",
        "極めし歌詠み": "👑",
        "五色百人一首の仙人": "☁️",
        "五色百人一首の王（キング）": "🏆"
      };

      TITLES.forEach(t => {
        const isUnlocked = playerLevel >= t.threshold;
        const icon = titleIcons[t.name] || "⭐";
        
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '0.8rem';
        row.style.padding = '0.6rem 0.8rem';
        row.style.borderRadius = '8px';
        row.style.border = isUnlocked ? '1.5px solid #ffd700' : '1px solid #e2e8f0';
        row.style.background = isUnlocked ? 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)' : '#f8fafc';
        row.style.opacity = isUnlocked ? '1' : '0.55';
        row.style.transition = 'all 0.2s';
        
        const badge = document.createElement('div');
        badge.style.width = '30px';
        badge.style.height = '30px';
        badge.style.borderRadius = '50%';
        badge.style.display = 'flex';
        badge.style.alignItems = 'center';
        badge.style.justifyContent = 'center';
        badge.style.background = isUnlocked ? 'var(--color-orange)' : '#cbd5e1';
        badge.style.color = '#fff';
        badge.style.fontSize = '0.9rem';
        badge.textContent = isUnlocked ? icon : "🔒";

        const info = document.createElement('div');
        info.style.flex = '1';
        info.innerHTML = `
          <div style="font-weight: bold; font-size: 0.85rem; color: ${isUnlocked ? '#92400e' : '#64748b'};">
            ${t.name}
          </div>
          <div style="font-size: 0.72rem; color: ${isUnlocked ? '#b45309' : '#94a3b8'}; margin-top: 0.1rem;">
            Lv.${t.threshold} 以上で解放
          </div>
        `;

        row.appendChild(badge);
        row.appendChild(info);
        container.appendChild(row);
      });
    }

    function renderGrowthRoadGrid() {
      const container = document.getElementById('growth-level-grid');
      if (!container) return;
      container.innerHTML = '';

      for (let i = 1; i <= 500; i++) {
        const cell = document.createElement('div');
        cell.id = `roadmap-cell-${i}`;
        
        const isCurrent = i === playerLevel;
        const isUnlocked = i <= playerLevel;
        
        cell.className = `heatmap-cell ${isUnlocked ? 'unlocked' : 'locked'} ${isCurrent ? 'current' : ''}`;
        cell.textContent = String(i);
        
        // Milestone thresholds highlighted
        const isMilestone = TITLES.some(t => t.threshold === i);
        if (isMilestone) {
          cell.style.border = '2px solid #ef4444';
          cell.style.boxShadow = '0 0 5px rgba(239, 68, 68, 0.4)';
        }

        // Custom style depending on status
        if (isCurrent) {
          cell.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
          cell.style.borderColor = '#ffd700';
          cell.style.color = '#fff';
        } else if (isUnlocked) {
          cell.style.background = 'linear-gradient(135deg, var(--theme-color) 0%, #3b82f6 100%)';
          cell.style.color = '#fff';
        } else {
          cell.style.background = '#f1f5f9';
          cell.style.borderColor = '#e2e8f0';
          cell.style.color = '#94a3b8';
        }

        cell.onclick = () => {
          const inspectBox = document.getElementById('growth-level-inspect-box');
          if (inspectBox) {
            // Find threshold title for level i
            let activeTitle = TITLES[0].name;
            TITLES.forEach(t => {
              if (i >= t.threshold) activeTitle = t.name;
            });
            
            // Total cumulative XP needed to reach level i
            let reqXP = 0;
            if (i <= 100) {
              reqXP = (i - 1) * 100;
            } else if (i <= 200) {
              reqXP = 9900 + (i - 101) * 150;
            } else {
              reqXP = 24750 + (i - 201) * 200;
            }

            let statusText = "";
            if (i < playerLevel) {
              statusText = `<span style="color: #10b981;">到達済み！</span>`;
            } else if (i === playerLevel) {
              statusText = `<span style="color: #f59e0b;">現在のレベルです！</span>`;
            } else {
              const diff = reqXP - playerXP;
              statusText = `<span style="color: #ef4444;">未到達 (あと ${diff} XP 必要)</span>`;
            }

            inspectBox.innerHTML = `
              レベル ${i} : 獲得称号 「${activeTitle}」<br>
              必要累計経験値: ${reqXP} XP (${statusText})
            `;
            inspectBox.style.background = '#e0f2fe';
            inspectBox.style.borderColor = '#0284c7';
            inspectBox.style.color = '#0369a1';
          }
        };

        container.appendChild(cell);
      }
    }

    // -------------------------------------------------------------
    // Learning Support Features (AI Coach, PDF Generator, Teacher Dashboard)
    // -------------------------------------------------------------
    let cardAttempts = {};
    let sessionMisses = {};

    

    function getPoemGenre(poem) {
      const text = poem.kami + poem.simo;
      if (text.includes("秋") || text.includes("もみぢ")) return "秋の歌";
      if (text.includes("春") || text.includes("桜") || text.includes("花")) return "春の歌";
      if (text.includes("夏") || text.includes("ほととぎす")) return "夏の歌";
      if (text.includes("冬") || text.includes("雪") || text.includes("霜") || text.includes("白妙")) return "冬の歌";
      if (text.includes("恋") || text.includes("逢") || text.includes("思")) return "恋の歌";
      return "旅・自然・その他";
    }

    function updateCoachAdvice() {
      const adviceTextEl = document.getElementById('coach-advice-text');
      if (!adviceTextEl) return;

      let stats = {};
      try {
        stats = JSON.parse(goshikiStorage.getItem('goshiki_card_stats_v2') || '{}');
      } catch (e) {}

      // Calculate card metrics
      let playedCards = [];
      let worstCard = null;
      let worstAccuracy = 1.1;

      POEMS_DATA.forEach(poem => {
        const s = stats[poem.no];
        if (s && s.taps > 0) {
          const acc = s.correct / s.taps;
          playedCards.push({ no: poem.no, acc: acc, taps: s.taps, poem: poem });
          if (acc < worstAccuracy) {
            worstAccuracy = acc;
            worstCard = poem;
          }
        }
      });

      // Genre calculation
      const genres = ["秋の歌", "春の歌", "夏の歌", "冬の歌", "恋の歌", "旅・自然・その他"];
      const genreStats = {};
      genres.forEach(g => { genreStats[g] = { taps: 0, correct: 0 }; });

      playedCards.forEach(card => {
        const g = getPoemGenre(card.poem);
        if (genreStats[g]) {
          genreStats[g].taps += card.taps;
          genreStats[g].correct += (stats[card.no].correct || 0);
        }
      });

      let worstGenre = null;
      let worstGenreAcc = 1.1;
      genres.forEach(g => {
        const gs = genreStats[g];
        if (gs.taps > 0) {
          const acc = gs.correct / gs.taps;
          if (acc < worstGenreAcc) {
            worstGenreAcc = acc;
            worstGenre = g;
          }
        }
      });

      if (playedCards.length === 0) {
        adviceTextEl.innerHTML = "練習を開始してデータを集めると、AI専属コーチが苦手札の分析と相性診断アドバイスを行います！";
        return;
      }

      let adviceHtml = "";
      if (worstCard) {
        const accPct = Math.round(worstAccuracy * 100);
        const cardColorMap = { blue: '青色', pink: 'ピンク', yellow: '黄色', green: '緑色', orange: 'オレンジ' };
        const colorName = cardColorMap[worstCard.color] || worstCard.color;
        adviceHtml += `あなたの最近の苦手な札は <strong>No.${worstCard.no} (上の句: ${worstCard.kami.slice(0, 10)}... / ${colorName})</strong> です（正解率: ${accPct}%）。`;
      }
      if (worstGenre) {
        adviceHtml += `<br>また、ジャンル別では <strong>「${worstGenre}」</strong> の正解率が低めの傾向にあります。`;
      }
      adviceHtml += `<br><span style="color: var(--color-orange); font-weight: bold; font-size: 0.8rem;">💡 アドバイス: 苦手札印刷ジェネレーターでこの札にチェックを入れて印刷し、視覚的に復習してみましょう！</span>`;

      adviceTextEl.innerHTML = adviceHtml;
    }

    // Weak Cards Selector / PDF Print
    let modalActiveColorTab = 'blue';

    function openWeakCardsModal() {
      document.getElementById('weak-cards-modal').style.display = 'flex';
      renderWeakCardsGrid();
      updateWeakCardsCount();
    }

    function closeWeakCardsModal() {
      document.getElementById('weak-cards-modal').style.display = 'none';
    }

    function switchModalColorTab(color) {
      modalActiveColorTab = color;
      const colors = ['blue', 'pink', 'yellow', 'green', 'orange'];
      colors.forEach(col => {
        const btn = document.getElementById(`modal-tab-${col}`);
        if (btn) {
          if (col === color) {
            btn.style.background = 'var(--theme-color)';
            btn.style.color = '#fff';
          } else {
            btn.style.background = 'transparent';
            btn.style.color = 'var(--text-color)';
          }
        }
      });
      renderWeakCardsGrid();
    }

    function getWeakCardsList() {
      let list = [];
      try {
        list = JSON.parse(goshikiStorage.getItem('goshiki_my_weak_cards') || '[]');
      } catch (e) {}
      return list;
    }

    function saveWeakCardsList(list) {
      goshikiStorage.setItem('goshiki_my_weak_cards', JSON.stringify(list));
    }

    function updateWeakCardsCount() {
      const countEl = document.getElementById('weak-cards-count');
      if (countEl) {
        countEl.textContent = String(getWeakCardsList().length);
      }
    }

    function renderWeakCardsGrid() {
      const container = document.getElementById('modal-weak-cards-list');
      if (!container) return;
      container.innerHTML = '';

      const filtered = POEMS_DATA.filter(p => p.color === modalActiveColorTab);
      const weakList = getWeakCardsList();

      filtered.forEach(poem => {
        const checked = weakList.includes(poem.no);
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';
        item.style.padding = '0.5rem 0.8rem';
        item.style.border = '1px solid #e2e8f0';
        item.style.borderRadius = '8px';
        item.style.background = checked ? 'rgba(43, 95, 140, 0.05)' : '#fff';
        item.style.fontSize = '0.85rem';

        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '0.5rem';
        label.style.cursor = 'pointer';
        label.style.flex = '1';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = checked;
        cb.style.cursor = 'pointer';
        cb.onchange = () => toggleWeakCard(poem.no);

        label.appendChild(cb);
        label.appendChild(document.createTextNode(`No.${poem.no} : ${poem.kami} (決まり字: ${KIMARIJI_DATA[poem.no]})`));

        item.appendChild(label);
        container.appendChild(item);
      });
    }

    function toggleWeakCard(cardNo) {
      let list = getWeakCardsList();
      const idx = list.indexOf(cardNo);
      if (idx > -1) {
        list.splice(idx, 1);
      } else {
        list.push(cardNo);
      }
      saveWeakCardsList(list);
      updateWeakCardsCount();
      renderWeakCardsGrid();
    }

    function autoSelectWeakCards() {
      let stats = {};
      try {
        stats = JSON.parse(goshikiStorage.getItem('goshiki_card_stats_v2') || '{}');
      } catch (e) {}

      let list = getWeakCardsList();
      POEMS_DATA.forEach(poem => {
        const s = stats[poem.no];
        if (s && s.taps > 0) {
          const acc = s.correct / s.taps;
          if (acc <= 0.7 && !list.includes(poem.no)) {
            list.push(poem.no);
          }
        }
      });
      saveWeakCardsList(list);
      updateWeakCardsCount();
      renderWeakCardsGrid();
      alert("AI分析で正解率70%以下の苦手札を追加しました！");
    }

    function toggleAllWeakCards(checked) {
      let list = [];
      if (checked) {
        list = POEMS_DATA.map(p => p.no);
      }
      saveWeakCardsList(list);
      updateWeakCardsCount();
      renderWeakCardsGrid();
    }

    function printWeakCards() {
      const list = getWeakCardsList();
      if (list.length === 0) {
        alert("印刷する苦手札が選択されていません。札にチェックを入れてから印刷してください。");
        return;
      }

      const printContainer = document.getElementById('printable-cards-container');
      if (!printContainer) return;
      printContainer.innerHTML = '';

      list.forEach(cardNo => {
        const poem = POEMS_DATA.find(p => p.no === cardNo);
        if (!poem) return;

        const card = document.createElement('div');
        card.className = 'printable-card';

        const colorNameMap = { blue: '青の札', pink: 'ピンクの札', yellow: '黄の札', green: '緑の札', orange: 'オレンジの札' };
        const colorName = colorNameMap[poem.color] || poem.color;

        card.innerHTML = `
          <div class="printable-card-header">
            <span>No.${poem.no} [${colorName}]</span>
            <span>五色百人一首 ver2</span>
          </div>
          <div class="printable-card-body">
            <div class="printable-card-text">
              <span>${poem.kami}</span>
            </div>
            <div class="printable-card-text" style="font-size: 0.95rem; color: #555; margin-right: 1.5rem;">
              <span>${poem.simo}</span>
            </div>
          </div>
          <div class="printable-card-footer">
            決まり字：${KIMARIJI_DATA[poem.no]} | 作者：${poem.sakusya}
          </div>
        `;
        printContainer.appendChild(card);
      });

      // Call browser print
      window.print();
    }

    // 黒田先生の秘密の部屋
    function openTeacherDashboard() {
      const password = prompt("パスワードを入力してください：");
      if (password === null) return; // user cancelled
      if (password !== "goshiki2026") {
        alert("パスワードが違います。アクセスできません。");
        return;
      }
      document.getElementById('teacher-dashboard-modal').style.display = 'flex';
      loadTeacherDashboard();
    }

    function closeTeacherDashboard() {
      document.getElementById('teacher-dashboard-modal').style.display = 'none';
    }

    function loadTeacherDashboard() {
      const debugCheckbox = document.getElementById('teacher-debug-mode-checkbox');
      if (debugCheckbox) {
        debugCheckbox.checked = debugModeEnabled;
      }

      if (typeof window.getTeacherDashboardStats === 'function') {
        window.getTeacherDashboardStats()
          .then(data => {
            renderHeatmapGrid(data);
          })
          .catch(err => {
            console.error("Failed to load dashboard stats", err);
            // Fallback rendering using zeros if offline
            renderHeatmapGrid({});
          });
      } else {
        renderHeatmapGrid({});
      }
    }

    function handleTeacherDebugModeToggle(checked) {
      debugModeEnabled = checked;
      window.debugModeEnabled = checked;
      goshikiStorage.setItem('goshiki_debug_mode_enabled', checked ? 'true' : 'false');
      
      if (typeof checkSkinUnlocks === 'function') checkSkinUnlocks();
      if (typeof renderBookGrid === 'function') renderBookGrid();
      if (typeof loadLevelData === 'function') loadLevelData();
      
      const modal = document.getElementById('achievements-modal');
      if (modal && modal.style.display !== 'none') {
        openAchievementsModal();
      }
    }
    window.handleTeacherDebugModeToggle = handleTeacherDebugModeToggle;

    function renderHeatmapGrid(missData) {
      const grid = document.getElementById('heatmap-grid');
      if (!grid) return;
      grid.innerHTML = '';

      // Generate 100 cells
      for (let i = 1; i <= 100; i++) {
        const count = missData[i] || 0;
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';
        cell.textContent = String(i);

        // Heatmap coloring
        let bg = '#f8fafc';
        let border = '#e2e8f0';
        let text = '#334155';

        if (count >= 31) {
          bg = '#991b1b'; border = '#7f1d1d'; text = '#ffffff';
        } else if (count >= 16) {
          bg = '#ef4444'; border = '#dc2626'; text = '#ffffff';
        } else if (count >= 6) {
          bg = '#fca5a5'; border = '#f87171'; text = '#7f1d1d';
        } else if (count >= 1) {
          bg = '#fee2e2'; border = '#fecaca'; text = '#991b1b';
        }

        cell.style.background = bg;
        cell.style.borderColor = border;
        cell.style.color = text;

        // Hover events
        const poem = POEMS_DATA.find(p => p.no === i);
        if (poem) {
          const detailStr = `No.${i}: 「${poem.kami}」<br>累計お手つき: ${count}回 | 決まり字: ${KIMARIJI_DATA[i]} (作者: ${poem.sakusya})`;
          
          cell.onmouseover = () => {
            const infoBox = document.getElementById('heatmap-hover-info');
            if (infoBox) {
              infoBox.innerHTML = detailStr;
              infoBox.style.background = '#e0e7ff';
              infoBox.style.borderColor = '#818cf8';
              infoBox.style.color = '#3730a3';
            }
          };

          cell.onclick = () => {
            const infoBox = document.getElementById('heatmap-hover-info');
            if (infoBox) {
              infoBox.innerHTML = detailStr;
              infoBox.style.background = '#e0e7ff';
              infoBox.style.borderColor = '#818cf8';
              infoBox.style.color = '#3730a3';
            }
          };
        }

        grid.appendChild(cell);
      }
    }

    function openAchievementsModal() {
      let perfectColors = [];
      let specialAchievements = [];
      try {
        perfectColors = JSON.parse(goshikiStorage.getItem('goshiki_perfect_colors') || '[]');
      } catch (e) {}
      try {
        const oldSpecial = JSON.parse(goshikiStorage.getItem('goshiki_special_achievements') || '[]');
        const newSpecial = JSON.parse(goshikiStorage.getItem('goshiki_special_achievements_v2') || '[]');
        specialAchievements = [...new Set([...oldSpecial, ...newSpecial])];
      } catch (e) {}

      // Update top badges
      const colors = ['blue', 'pink', 'yellow', 'green', 'orange'];
      colors.forEach(col => {
        const badge = document.getElementById(`badge-color-${col}`);
        if (badge) {
          if (debugModeEnabled || perfectColors.includes(col)) {
            badge.classList.remove('badge-locked');
          } else {
            badge.classList.add('badge-locked');
          }
        }
      });

      // Render titles list
      const container = document.getElementById('achievements-list-container');
      container.innerHTML = '';

      SECRET_TITLES.forEach(title => {
        const isUnlocked = debugModeEnabled || perfectColors.length >= title.id;
        
        const row = document.createElement('div');
        row.className = 'achievement-row';
        row.innerHTML = `
          <div class="achievement-icon ${isUnlocked ? 'unlocked' : ''}" style="font-size: 2rem;">${title.icon}</div>
          <div class="achievement-info">
            <div class="achievement-title ${isUnlocked ? 'unlocked' : ''}" style="font-weight: bold; ${isUnlocked ? 'color: var(--color-orange);' : 'color: #94a3b8;'}">
              ${title.name} ${isUnlocked ? '✨解放済✨' : '🔒未解放'}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">条件: ${title.req}</div>
            <div class="achievement-desc ${isUnlocked ? 'unlocked' : ''}" style="font-size: 0.85rem; color: #64748b; margin-top: 0.15rem; ${isUnlocked ? 'display: block;' : 'display: none;'}">${title.desc}</div>
          </div>
        `;
        container.appendChild(row);
      });

      // Render Special achievements
      const specials = [
        { key: "strongest_4th_grader", name: "最強の4年生", icon: "👑", req: "全5色をそれぞれお手つき0でクリアする", desc: "素晴らしい精神集中力！5色の札すべてにおいて完璧なノーミスクリアを達成した、真の最強覇者！" },
        { key: "godspeed", name: "神速！", icon: "⚡", req: "20枚の札を「1分以内」にすべて取り終える", desc: "電光石火の早業！1分未満のスピードクリアを達成した神速のかるた使い！" },
        { key: "ultimate_song_saint", name: "究極の歌聖", icon: "🏆", req: "カオスモード（100枚）を「お手つき0回」でクリアする", desc: "おてつきゼロで百首すべてを取りきった、かるたの極致！黄金のテーマ背景が解放されます。" }
      ];

      // Add section divider for Special achievements
      const headerRow = document.createElement('div');
      headerRow.innerHTML = `<h4 style="margin: 1.5rem 0 0.8rem 0; color: var(--color-orange); font-size: 1.05rem; border-bottom: 2px solid var(--color-orange); padding-bottom: 0.3rem;">🏆 特別功労称号 🏆</h4>`;
      container.appendChild(headerRow);

      specials.forEach(title => {
        const isUnlocked = debugModeEnabled || specialAchievements.includes(title.key);
        const row = document.createElement('div');
        row.className = 'achievement-row';
        row.innerHTML = `
          <div class="achievement-icon ${isUnlocked ? 'unlocked' : ''}" style="font-size: 2rem;">${title.icon}</div>
          <div class="achievement-info">
            <div class="achievement-title ${isUnlocked ? 'unlocked' : ''}" style="font-weight: bold; ${isUnlocked ? 'color: #d4af37;' : 'color: #94a3b8;'}">
              ${title.name} ${isUnlocked ? '✨獲得！✨' : '🔒未獲得'}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">条件: ${title.req}</div>
            <div class="achievement-desc ${isUnlocked ? 'unlocked' : ''}" style="font-size: 0.85rem; color: #64748b; margin-top: 0.15rem; ${isUnlocked ? 'display: block;' : 'display: none;'}">${title.desc}</div>
          </div>
        `;
        container.appendChild(row);
      });

      // Render Hidden Badge achievements
      let unlockedBadges = [];
      try {
        unlockedBadges = JSON.parse(goshikiStorage.getItem('goshiki_unlocked_badges_v2') || '[]');
      } catch(e) {}
      
      const badgeHeader = document.createElement('div');
      badgeHeader.innerHTML = `<h4 style="margin: 1.5rem 0 0.8rem 0; color: var(--color-orange); font-size: 1.05rem; border-bottom: 2px solid var(--color-orange); padding-bottom: 0.3rem;">🏅 隠し称号バッジ 🏅</h4>`;
      container.appendChild(badgeHeader);
      
      NEW_ACHIEVEMENTS.forEach(badge => {
        const isUnlocked = debugModeEnabled || unlockedBadges.includes(badge.key);
        const row = document.createElement('div');
        row.className = 'achievement-row';
        row.innerHTML = `
          <div class="achievement-icon ${isUnlocked ? 'unlocked' : ''}" style="font-size: 2rem; background: ${isUnlocked ? badge.color + '15' : '#f1f5f9'}; border: 2px solid ${isUnlocked ? badge.color : '#e2e8f0'}; border-radius: 50%; width: 50px; height: 50px; display: flex; align-items: center; justify-content: center; box-shadow: ${isUnlocked ? '0 4px 10px ' + badge.color + '30' : 'none'};">${badge.icon}</div>
          <div class="achievement-info">
            <div class="achievement-title ${isUnlocked ? 'unlocked' : ''}" style="font-weight: bold; color: ${isUnlocked ? badge.color : '#94a3b8'};">
              ${badge.name} ${isUnlocked ? '✨獲得！✨' : '🔒未獲得'}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">条件: ${badge.req}</div>
            <div class="achievement-desc ${isUnlocked ? 'unlocked' : ''}" style="font-size: 0.85rem; color: #64748b; margin-top: 0.15rem; ${isUnlocked ? 'display: block;' : 'display: none;'}">${badge.desc}</div>
          </div>
        `;
        container.appendChild(row);
      });

      // Render Special Renewal Achievements (Hall of fame, Top challenger, Yesterday surpasser)
      const renewalHeader = document.createElement('div');
      renewalHeader.innerHTML = `<h4 style="margin: 1.5rem 0 0.8rem 0; color: #10b981; font-size: 1.05rem; border-bottom: 2px solid #10b981; padding-bottom: 0.3rem;">✨ 特別記録更新称号 ✨</h4>`;
      container.appendChild(renewalHeader);

      const renewals = [
        { key: "hall_of_fame", storageKey: "goshiki_title_count_hall_of_fame", name: "殿堂入り歌詠み", icon: "殿", req: "自己ベストタイムを更新する", desc: "自分自身の壁を破り、新たな自己新記録を樹立した証！", color: "#10b981" },
        { key: "top_challenger", storageKey: "goshiki_title_count_top_challenger", name: "頂上の挑戦者", icon: "頂", req: "全国ランキング1位のタイムを更新する", desc: "全国の頂点に立ち、新たな歴代最高記録を塗り替えた英雄！", color: "#d97706" },
        { key: "yesterday", storageKey: "goshiki_title_count_yesterday", name: "昨日を超える者", icon: "超", req: "5色それぞれのベストタイムの合計タイムを更新する", desc: "日々努力を重ね、すべての色の合計時間を縮めて過去の自分を超え続けた求道者！", color: "#3b82f6" }
      ];

      renewals.forEach(title => {
        const count = debugModeEnabled ? Math.max(1, parseInt(goshikiStorage.getItem(title.storageKey) || '0')) : parseInt(goshikiStorage.getItem(title.storageKey) || '0');
        const isUnlocked = debugModeEnabled || count > 0;
        const row = document.createElement('div');
        row.className = 'achievement-row';
        row.innerHTML = `
          <div class="achievement-icon ${isUnlocked ? 'unlocked' : ''}" style="font-size: 1.3rem; font-weight: 900; background: ${isUnlocked ? title.color + '15' : '#f1f5f9'}; border: 2px solid ${isUnlocked ? title.color : '#e2e8f0'}; border-radius: 50%; width: 50px; height: 50px; display: flex; align-items: center; justify-content: center; box-shadow: ${isUnlocked ? '0 4px 10px ' + title.color + '30' : 'none'}; color: ${isUnlocked ? title.color : '#94a3b8'}; font-family: serif;">${title.icon}</div>
          <div class="achievement-info">
            <div class="achievement-title ${isUnlocked ? 'unlocked' : ''}" style="font-weight: bold; color: ${isUnlocked ? title.color : '#94a3b8'};">
              ${title.name} ${isUnlocked ? `✨獲得！ (獲得回数: ×${count})✨` : '🔒未獲得'}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">条件: ${title.req}</div>
            <div class="achievement-desc ${isUnlocked ? 'unlocked' : ''}" style="font-size: 0.85rem; color: #64748b; margin-top: 0.15rem; ${isUnlocked ? 'display: block;' : 'display: none;'}">${title.desc}</div>
          </div>
        `;
        container.appendChild(row);
      });

      // Update gold theme toggle switch status if unlocked
      const hasUltimateSaint = specialAchievements.includes('ultimate_song_saint');
      const toggleArea = document.getElementById('gold-theme-toggle-area');
      if (toggleArea) {
        if (debugModeEnabled || hasUltimateSaint) {
          toggleArea.style.display = 'block';
          const checkbox = document.getElementById('gold-theme-checkbox');
          if (checkbox) {
            let enabled = goshikiStorage.getItem('goshiki_gold_theme_enabled_v2');
            if (enabled === null) {
              enabled = goshikiStorage.getItem('goshiki_gold_theme_enabled');
            }
            checkbox.checked = enabled === 'true';
          }
        } else {
          toggleArea.style.display = 'none';
        }
      }

      // Render Book list if active tab is book
      if (currentAchTab === 'book') {
        renderBookGrid();
      }

      document.getElementById('achievements-modal').style.display = 'flex';
    }

    function closeAchievementsModal() {
      document.getElementById('achievements-modal').style.display = 'none';
    }

    // Achievements Modal Tab Switcher and Book Functions
    let currentAchTab = 'list';
    let currentBookFilterColor = 'all';

    function switchAchTab(tab) {
      currentAchTab = tab;
      const listEl = document.getElementById('ach-content-list');
      const bookEl = document.getElementById('ach-content-book');
      const listBtn = document.getElementById('ach-tab-list');
      const bookBtn = document.getElementById('ach-tab-book');

      if (tab === 'list') {
        if (listEl) listEl.style.display = 'block';
        if (bookEl) bookEl.style.display = 'none';
        if (listBtn) {
          listBtn.style.background = 'var(--color-orange)';
          listBtn.style.color = '#fff';
        }
        if (bookBtn) {
          bookBtn.style.background = 'transparent';
          bookBtn.style.color = 'var(--text-color)';
        }
      } else {
        if (listEl) listEl.style.display = 'none';
        if (bookEl) bookEl.style.display = 'block';
        if (listBtn) {
          listBtn.style.background = 'transparent';
          listBtn.style.color = 'var(--text-color)';
        }
        if (bookBtn) {
          bookBtn.style.background = 'var(--color-orange)';
          bookBtn.style.color = '#fff';
        }
        renderBookGrid();
      }
    }

    window.switchAchTab = switchAchTab;

    function filterBookColor(color) {
      currentBookFilterColor = color;
      const colors = ['all', 'blue', 'pink', 'yellow', 'green', 'orange'];
      colors.forEach(col => {
        const btn = document.getElementById(`book-tab-${col}`);
        if (btn) {
          if (col === color) {
            btn.style.background = 'var(--theme-color)';
            btn.style.color = '#fff';
          } else {
            btn.style.background = 'transparent';
            btn.style.color = 'var(--text-color)';
          }
        }
      });
      renderBookGrid();
    }

    window.filterBookColor = filterBookColor;

    function getAcquiredColors() {
      let takenCards = [];
      try {
        takenCards = JSON.parse(goshikiStorage.getItem('goshiki_taken_cards_v2') || '[]');
      } catch (e) {}

      if (takenCards.length === 0) {
        return ['blue']; // Blue is default fallback
      }

      const acquired = new Set();
      takenCards.forEach(no => {
        const poem = POEMS_DATA.find(p => p.no === no);
        if (poem) acquired.add(poem.color);
      });

      if (acquired.size === 0) {
        acquired.add('blue');
      }

      return Array.from(acquired);
    }

    window.getAcquiredColors = getAcquiredColors;

    function refreshColorButtonsLockState() {
      const colors = ['blue', 'pink', 'yellow', 'green', 'orange'];
      colors.forEach(col => {
        const btn = document.getElementById(`color-${col}`);
        if (btn) {
          btn.classList.remove('color-locked-sidebar');
          btn.style.opacity = '1';
          btn.style.filter = 'none';
          btn.style.cursor = 'pointer';
          const lockSpan = btn.querySelector('.lock-icon-sidebar');
          if (lockSpan) lockSpan.remove();
        }
      });
    }

    window.refreshColorButtonsLockState = refreshColorButtonsLockState;

    function renderBookGrid() {
      const container = document.getElementById('book-cards-grid');
      if (!container) return;
      container.innerHTML = '';

      let takenCards = [];
      try {
        takenCards = JSON.parse(goshikiStorage.getItem('goshiki_taken_cards_v2') || '[]');
      } catch (e) {}

      let readCards = [];
      try {
        readCards = JSON.parse(goshikiStorage.getItem('goshiki_read_poems') || '[]');
      } catch (e) {}

      const acquiredCount = debugModeEnabled ? 100 : Math.min(100, takenCards.length);
      document.getElementById('book-acquired-count').textContent = String(acquiredCount);
      document.getElementById('book-progress-bar-inner').style.width = `${acquiredCount}%`;
      document.getElementById('book-remaining-count-desc').textContent = 
        acquiredCount >= 100 ? "🎉 おめでとう！百人一首全首コンプリート！ 🎉" : `コンプリートまで あと ${100 - acquiredCount} 枚！`;

      const filtered = POEMS_DATA.filter(p => currentBookFilterColor === 'all' || p.color === currentBookFilterColor);

      const colorBgMap = {
        blue: { bg: '#f0f7ff', border: '#2B5F8C', text: '#1e3a8a', labelBg: 'rgba(43,95,140,0.1)' },
        pink: { bg: '#fff1f2', border: '#d15b76', text: '#9f1239', labelBg: 'rgba(209,91,118,0.1)' },
        yellow: { bg: '#fefbeb', border: '#d9a036', text: '#854d0e', labelBg: 'rgba(217,160,54,0.1)' },
        green: { bg: '#f0fdf4', border: '#2e8b57', text: '#166534', labelBg: 'rgba(46,139,87,0.1)' },
        orange: { bg: '#fff7ed', border: '#f97316', text: '#9a3412', labelBg: 'rgba(249,115,22,0.1)' }
      };

      filtered.forEach(poem => {
        const isUnlocked = debugModeEnabled || takenCards.includes(poem.no);
        const isRead = debugModeEnabled || readCards.includes(poem.no);
        const card = document.createElement('div');
        
        card.style.border = '1.5px solid';
        card.style.borderRadius = '8px';
        card.style.padding = '0.6rem 0.8rem';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '0.4rem';
        card.style.boxSizing = 'border-box';
        card.style.transition = 'all 0.2s';
        card.style.position = 'relative';

        if (isUnlocked) {
          const style = colorBgMap[poem.color] || colorBgMap.blue;
          card.style.background = style.bg;
          card.style.borderColor = style.border;
          card.style.color = style.text;
          card.style.cursor = 'pointer';
          card.onclick = () => openPoemDetailModal(poem.no);

          let statusBadge = '';
          if (isRead) {
            statusBadge = `<span style="color: #10b981; font-weight: bold; font-size: 0.68rem; display: inline-flex; align-items: center; gap: 0.1rem;">既読 ✔️</span>`;
          } else {
            statusBadge = `<span style="color: #f59e0b; font-weight: bold; font-size: 0.68rem; display: inline-flex; align-items: center; gap: 0.1rem; animation: pulseCurrentLevel 1.5s infinite alternate;">未読 📖</span>`;
          }
          
          card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; font-weight: bold; padding-bottom: 3px; border-bottom: 1px dashed rgba(0,0,0,0.08);">
              <span style="background: ${style.labelBg}; padding: 1px 6px; border-radius: 4px;">No.${poem.no}</span>
              ${statusBadge}
            </div>
            <div style="font-weight: bold; font-size: 0.85rem; line-height: 1.4; word-break: break-all;">
              ${poem.kami}
            </div>
            <div style="font-size: 0.78rem; line-height: 1.4; color: #555; word-break: break-all; padding-left: 0.2rem;">
              ${poem.simo}
            </div>
            <div style="font-size: 0.7rem; color: #777; text-align: right; margin-top: auto; font-style: italic;">
              ${poem.sakusya}
            </div>
          `;
        } else {
          card.style.background = '#f8fafc';
          card.style.borderColor = '#cbd5e1';
          card.style.color = '#94a3b8';
          
          card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; font-weight: bold; padding-bottom: 3px; border-bottom: 1px dashed rgba(0,0,0,0.08);">
              <span style="background: #e2e8f0; padding: 1px 6px; border-radius: 4px; color: #64748b;">No.${poem.no}</span>
              <span>未解禁 🔒</span>
            </div>
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 70px; gap: 0.2rem;">
              <span style="font-size: 1.8rem; font-weight: bold; opacity: 0.5;">?</span>
              <span style="font-size: 0.65rem; color: #94a3b8; font-weight: bold;">(練習で札を取ると解禁)</span>
            </div>
          `;
        }
        container.appendChild(card);
      });
    }

    window.renderBookGrid = renderBookGrid;

    // Poem Meaning Explanations Database
    const POEM_MEANINGS = {
      1: "秋の田の仮小屋の屋根の網目が粗いので、私の着物の袖が夜露に濡れ続けている。",
      2: "春が過ぎて夏が来たらしく、真っ白な着物を干すという天の香具山が見える。",
      3: "山鳥の長く垂れた尾のように、この長い長い夜を私は独りきりで寂しく寝るのだろうか。",
      4: "田子の浦に出てみると、真っ白な富士山に雪がしんしんと降り積もっている。",
      5: "奥山で紅葉を踏み分けながら鳴くシカの声を聞くときこそ、秋は寂しいと感じる。",
      6: "カササギが渡した架け橋のような夜空の天の川に置いた霜のように、深夜白く光り輝いている。",
      7: "三笠の山に出た月を眺めると、はるか遠い故郷の奈良の春日にある山を思い出す。",
      8: "私の庵は都の東南にあり、世間を逃れた「憂山（宇治山）」と人は呼んでいる。",
      9: "花の色はすっかりあせてしまった。私がこの世の物思いにふけり、むなしく雨を眺めて過ごしている間に。",
      10: "これがあの、行く人も帰る人も、知る人も知らない人も、また出会うという有名な逢坂の関なのだ。",
      11: "広い海へたくさんの島々を目指して漕ぎ出していくと、都の人に伝えておくれ、釣り船の漁師さん。",
      12: "天の風よ、雲の通り道を閉ざしておくれ。天女たちの美しい舞の姿を、もうしばらく見ていたいから。",
      13: "筑波山の峰から流れ落ちるみなの川が、次第に深くなって深い淵になるように、私の恋心も深く積もっていく。",
      14: "陸奥の信夫のすり衣の乱れ模様のように、私の心もあなたのために乱れていますが、誰のせいでもありません。",
      15: "あなたのために春の野原に出て若菜を摘んでいると、私の着物の袖に雪が降りかかってくる。",
      16: "立ち別れて因幡の国へ行きますが、松の木のそばで待っていると聞いたなら、すぐに戻ってまいりましょう。",
      17: "いろいろな不思議が起こる神代にも聞いたことがない。竜田川の水が真っ赤な紅葉を絞り染めにして流れるとは。",
      18: "住の江の海岸に寄せる波が、夜の夢の通い路でさえ、どうしてこんなにも人の目を避けて恋をするのだろう。",
      19: "難波の浅瀬にある葦の節のように、短いこの間さえ、あなたと会わずに過ごせというのでしょうか。",
      20: "わびしくて死んでしまいそうな私の身です。難波の澪標（みおつくし）のように、身を尽くしてでもあなたに逢いたい。",
      21: "今すぐ行くとおっしゃったから、秋の夜長を待っているうちに、有明の月が出てきてしまいました。",
      22: "吹くからに秋の草木がしおれてしまうので、なるほど山風のことを「嵐（荒らし）」と言うのだな。",
      23: "月を見ると、いろいろと物思いにふけってしまう。私一人のための秋ではないのだけれど。",
      24: "今回の旅は急なことで手向けの幣（ぬさ）も用意できませんでした。この美しい紅葉を神の御心に捧げましょう。",
      25: "逢うことができないのなら、せめて人目を避けて流れる清瀧川のように、あなたの心が変わらないと聞いてから死にたい。",
      26: "小倉山の峰の紅葉たちよ、心があるならば、もう一度天皇がおいでになるまで散らずに待っておくれ。",
      27: "御所の警衛をする人の夜のかがり火が、昼は消えて夜は燃えるように、私の恋の思いも夜になると燃え上がります。",
      28: "冬が来て、すっかり寂しくなった山里を眺めると、草も木も枯れて人々も来なくなったことが寂しく思える。",
      29: "心あてに折るならば、初霜が真っ白に降りて、どれが白菊なのか分からなくなってしまったこの花を折ろう。",
      30: "夜明け方の有明の月が冷たく照らす中、別れ際に冷淡に見えたあなたのつれない態度が忘れられない。",
      31: "朝早くの吉野の里は、まだ夜が明けきらないうちに、雪がまるで降っているかのように白く明るい。",
      32: "山々の谷間を流れる川には紅葉がせき止められて、流れないのに美しい「紅葉の錦」ができている。",
      33: "こんなにも日の光がのどかに降り注ぐ春の日に、桜の花はどうして落ち着かない心で散っていってしまうのか。",
      34: "誰を友と呼べばいいのだろう。高砂の古い松の木でさえ、昔からの知人ではないのだから。",
      35: "人の心は変わりやすいけれど、故郷のこの梅の花だけは、昔のままの素晴らしい香りで私を迎えてくれる。",
      36: "夏の夜は、まだ宵のうちだと思っているうちに明けてしまう。雲のどこに月は宿っているのだろうか。",
      37: "秋の風が吹くと、庭の木々の紅葉が美しく散り乱れる。まるで白露がちりばめられた宝石のようだ。",
      38: "私を忘れないと誓ったあなたの言葉は頼みになりません。ただ、神様の罰であなた自身の命が失われないか心配です。",
      39: "浅茅生の野原のしのぶ草のように、人知れずあなたを思う私の恋心は、どれほど積もれば隠しきれなくなるのか。",
      40: "私の心に秘めた恋心は、早くも顔に出てしまっているようだ。何か物思いでもあるのかと人に聞かれるほどに。",
      41: "恋の噂が早くも世間に広まってしまった。誰にも知られないように思い始めていたはずなのに。",
      42: "二人でお互いに袖を絞りながら、「末の松山を波が越えることがないように、心変わりはしない」と誓ったのに。",
      43: "逢うことができた後の恋の物思いに比べれば、逢う前の恋の苦しさなどは、まだ何も思っていないようなものだ。",
      44: "あなたと逢う約束をしたのに、その逢うのが難しいために、あなたの命さえ惜しく思われてしまうのです。",
      45: "哀れだと思ってくれる人さえいない身です。せめて私自身だけでも、私の命を愛おしく思おう。",
      46: "由良の瀬戸を渡る船頭が、舵を失って漂うように、私の恋の行く末もどこへ向かうのか分からず不安です。",
      47: "八重桜が咲き誇る美しい奈良の都から、今日この九重の宮廷に桜を献上いたしました。",
      48: "風が吹いて荒れ狂う竜田川の白波よ、どうか私が想いを寄せるあの人の家への道を塞がないでおくれ。",
      49: "御所の門を守る衛士の夜のかがり火のように、私の胸の中で燃え続ける恋の火は、決して消えることがありません。",
      50: "あなたのために惜しくないと思っていた私の命ですが、こうして逢うことができた今となっては、長く生きたいと願うようになりました。",
      51: "かくとだに知らせてくれればいいものを、伊吹山のさしも草のように、燃え上がる思いをどうして伝えられないのか。",
      52: "明ければまた別れると思うと、夜明けの月さえ恨めしく思えます。この悲しさは夜が明けても終わりません。",
      53: "ため息をつきながら明かす夜は長く、有明の月が出るまで待つのがどれほど辛いか、あなたは知らないでしょう。",
      54: "私のことを忘れないと誓った言葉は嬉しいけれど、人間の心は移り変わりやすいもの。有明の月を見ながら思うのです。",
      55: "滝の音は聞こえなくなって久しいけれど、その名声だけは、今も世間の人々に語り継がれている。",
      56: "私の命はもうすぐ尽きてしまいそうです。あの世での思い出に、せめて最後にもう一度だけあなたにお逢いしたい。",
      57: "めぐり逢って、それがあなたなのかと確かめる間もなく、雲の合間に隠れてしまった夜半の月のように去ってしまった。",
      58: "有馬山の猪名のささ原を風が吹き渡るように、どうして私があなたを忘れたりするものでしょうか。",
      59: "やすらって（ためらって）来ないあなたを待つうちに、夜が更けてしまいました。夜空を渡る月さえ傾いています。",
      60: "大江山を越え、生野の道を通って行くので、天の橋立はまだ遠く、あの世からの母の返事もまだ聞いていません。",
      61: "いにしえの奈良の都の八重桜が、今日はこの京都の宮廷で、いっそう美しく咲き誇っています。",
      62: "夜が更けて、鶏の鳴き声を真似て関所をすり抜けようとしても、この逢坂の関だけは決して開きませんよ。",
      63: "今はもう、あなたへの思いを諦めようとしていますが、これ以上どうやってあなたを恋しいと思う気持ちを抑えればよいのでしょう。",
      64: "朝早く宇治の川霧が晴れていくと、浅瀬に建てた杭にかけられた魚を捕る仕掛けが、だんだんと見えてきます。",
      65: "恨めしいあなたの態度によって、私の袖は涙で濡れ果ててしまいました。このまま評判まで悪くなってしまうのが悲しいです。",
      66: "もろともに（一緒に）哀れだと思おう、山桜よ。私にはお前以外の知人はいないのだから。",
      67: "春の夜の夢のように短いお戯れのせいで、あらぬ噂が立つのは困ります。どうか私の手枕などなさらないでください。",
      68: "心から恋しいと思うあなたのつれない態度に、私の命はもう尽きてしまいそうです。せめて有明の月だけでも私の最期を見届けてほしい。",
      69: "嵐の吹く三室の山の紅葉よ、竜田川の水を紅葉の錦でせき止めておくれ。",
      70: "寂しさに耐えかねて庵の外に出てみると、どこも同じ秋の夕暮れが広がっている。",
      71: "夕暮れになると、門前の笹の葉に風が吹いて、秋が来たことを告げる音が聞こえてくる。",
      72: "音に聞こえる（有名な）高師の浜の波のように、あなたの浮気な噂は有名です。どうか私の袖を涙で濡らさないでおくれ。",
      73: "桜の花よ、せめて散らずに待っておくれ。春の夜の短い月が西の山に沈むまでは。",
      74: "憂き（辛い）この世から逃れようと山に入ったのに、山の上にも悲しい鹿の鳴き声が響いている。",
      75: "お互いに固く誓い合った約束は、末の松山を波が越えることがないように、決して破られることはありません。",
      76: "広い海原へたくさんの船が漕ぎ出していく。都の人々よ、私の寂しい旅路を思ってくれているだろうか。",
      77: "川の流れが急なので、岩にせき止められた急流が二つに分かれても、また再び合流するように、私たちもきっと再会できるでしょう。",
      78: "淡路島から通う千鳥の鳴き声を聞くと、須磨の関守たちは夜明け前に目が覚め、物思いにふけることだろう。",
      79: "秋風が吹いて天の川の波が立ち騒ぐように、私の心もあなたを思って波立っています。",
      80: "長くつれないあなたを恨みながら過ごすこの夜は長く、私の髪の毛も乱れ、涙に濡れています。",
      81: "ほととぎすが鳴いた方を見上げると、ただ有明の月がぽつんと夜空に残っているだけだった。",
      82: "思い悩む私の身を哀れと思ってください。もしこの恋が叶わなければ、私の命も尽きてしまうでしょう。",
      83: "世の中がこのように辛いものであるなら、いっそ深山に入って、世間の悩みをすべて忘れてしまいたい。",
      84: "ながらえば（生き長らえれば）いつかはこの辛い日々も懐かしく思い出せるだろうか。昔を懐かしんだあの頃のように。",
      85: "夜も更けて、静かにあなたを待つ部屋には、冷たい秋の夜風が吹き込んできます。",
      86: "嘆け（悲しめ）と月が私を仕向けているのだろうか。いや、月のせいではないのに、涙が溢れて止まらない。",
      87: "村雨（にわか雨）が通り過ぎた後、霧が立ち上る秋の夕暮れは、言葉にできないほど寂しいものだ。",
      88: "難波江の葦の短い節のように、短いこの世の旅路で、あなたと一度も会わずに過ごせというのでしょうか。",
      89: "私の命よ、尽きるなら早く尽きておくれ。このまま生き長らえると、心に秘めた恋の秘密が漏れてしまいそうだ。",
      90: "見せばやな（お見せしたいものです）。雄島の漁師の袖でさえ波で濡れるだけなのに、私の袖は血のような涙で染まっています。",
      91: "きりぎりす（こおろぎ）が寒そうに鳴く秋の夜、着物を片袖だけ敷いて、私は独り寂しく寝るのだろうか。",
      92: "我が衣手は（私の袖は）涙で濡れ乾く暇もありません。あなたの冷淡な仕打ちのために。",
      93: "世の中は常のない（はかない）ものであるな。入江を漕ぎ出していく漁師の引く船が波間に見え隠れするように。",
      94: "み吉野の山に積もる雪のように、私の心にもあなたを思う思いが降り積もっていきます。",
      95: "大けき（大それた）望みかもしれませんが、この辛い世の中に生きる人々を救いたいと願い、僧侶の衣をまといます。",
      96: "花さそふ（花を誘う）嵐の庭の雪のように散る桜よ。私の身もそのように散ってしまいたい。",
      97: "来ぬ（来ない）あなたを待つ夕暮れは、松の風の音が寂しく響き、焼く塩の煙のように恋の思いが燃え上がります。",
      98: "風そよぐ（風がそよそよと吹く）ならの小川の夕暮れは、禊（みそぎ）を行う人々の姿に夏を惜しむ心を感じさせます。",
      99: "人も愛おしく、自分も愛おしく思える。こののどかな春の日に、どうして心騒がせることがあるだろうか。",
      100: "百年に一度咲くというももの花のように、この素晴らしい太平の世がいつまでも続いてほしい。"
    };

    function openPoemDetailModal(cardNo) {
      const poem = POEMS_DATA.find(p => p.no === cardNo);
      if (!poem) return;

      // Update contents
      const badge = document.getElementById('detail-card-badge');
      const kami = document.getElementById('detail-card-kami');
      const simo = document.getElementById('detail-card-simo');
      const author = document.getElementById('detail-card-author');
      const meaning = document.getElementById('detail-card-meaning');
      const stamp = document.getElementById('detail-card-stamp-container');
      const modal = document.getElementById('poem-detail-modal');

      const colorNameMap = { blue: '青の札', pink: 'ピンクの札', yellow: '黄の札', green: '緑の札', orange: 'オレンジの札' };
      const colorName = colorNameMap[poem.color] || poem.color;
      
      if (badge) badge.textContent = `No.${poem.no} [${colorName}]`;
      if (kami) kami.textContent = poem.kami;
      if (simo) simo.textContent = poem.simo;
      if (author) author.textContent = `作者: ${poem.sakusya} (決まり字: ${KIMARIJI_DATA[poem.no]})`;
      if (meaning) meaning.textContent = POEM_MEANINGS[poem.no] || "解説データは準備中です。";

      // Set border color matching card theme
      const colorHexMap = { blue: '#2B5F8C', pink: '#d15b76', yellow: '#d9a036', green: '#2e8b57', orange: '#f97316' };
      const modalBox = modal.querySelector('.achievements-modal-box');
      if (modalBox) {
        modalBox.style.borderTopColor = colorHexMap[poem.color] || '#2B5F8C';
      }

      // Track read status
      let readCards = [];
      try {
        readCards = JSON.parse(goshikiStorage.getItem('goshiki_read_poems') || '[]');
      } catch (e) {}

      if (!readCards.includes(cardNo)) {
        readCards.push(cardNo);
        goshikiStorage.setItem('goshiki_read_poems', JSON.stringify(readCards));
        
        // Re-render book grid to show read marker
        renderBookGrid();

        // Check if unlocked "Sommelier"
        if (readCards.length === 100) {
          setTimeout(() => {
            checkBadgeUnlock('sommelier');
          }, 1000);
        }
      }

      // Show stamp
      if (stamp) {
        stamp.style.display = 'block';
      }

      const status = document.getElementById('detail-card-status');
      if (status) {
        status.textContent = '読破済 ✔️';
      }

      modal.style.display = 'flex';
    }

    window.openPoemDetailModal = openPoemDetailModal;

    function closePoemDetailModal() {
      document.getElementById('poem-detail-modal').style.display = 'none';
    }

    window.closePoemDetailModal = closePoemDetailModal;

    function showAchievementUnlockOverlay(count) {
      const titleInfo = SECRET_TITLES.find(t => t.id === count);
      if (!titleInfo) return;

      document.getElementById('popup-achievement-name').textContent = titleInfo.name;
      
      const overlay = document.getElementById('achievement-unlock-banner');
      overlay.style.display = 'flex';
      
      playCelebrationSound();

      setTimeout(() => {
        overlay.style.display = 'none';
      }, 4000);
    }

    function playCelebrationSound() {
      if (!window.AudioContext && !window.webkitAudioContext) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const playNote = (freq, startTime, duration) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, startTime);
          
          gain.gain.setValueAtTime(0, startTime);
          gain.gain.linearRampToValueAtTime(0.12, startTime + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
          
          osc.start(startTime);
          osc.stop(startTime + duration);
        };
        
        const now = ctx.currentTime;
        playNote(523.25, now, 0.2); // C5
        playNote(659.25, now + 0.1, 0.2); // E5
        playNote(783.99, now + 0.2, 0.2); // G5
        playNote(1046.50, now + 0.3, 0.4); // C6
        playNote(1318.51, now + 0.45, 0.6); // E6
      } catch (e) {}
    }

    function showConfetti() {
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.top = '0';
      container.style.left = '0';
      container.style.width = '100vw';
      container.style.height = '100vh';
      container.style.pointerEvents = 'none';
      container.style.zIndex = '9999';
      document.body.appendChild(container);

      const colors = ['#f43f5e', '#3b82f6', '#eab308', '#22c55e', '#f97316', '#a855f7'];
      for (let i = 0; i < 100; i++) {
        const particle = document.createElement('div');
        particle.style.position = 'absolute';
        particle.style.width = Math.random() * 8 + 8 + 'px';
        particle.style.height = Math.random() * 12 + 10 + 'px';
        particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        particle.style.left = Math.random() * 100 + 'vw';
        particle.style.top = -20 + 'px';
        particle.style.opacity = Math.random() * 0.6 + 0.4;
        particle.style.transform = `rotate(${Math.random() * 360}deg)`;
        
        const duration = Math.random() * 2.5 + 2.5;
        const delay = Math.random() * 1.5;
        
        particle.style.transition = `transform ${duration}s linear, top ${duration}s cubic-bezier(0.1, 0.8, 0.3, 1)`;
        container.appendChild(particle);
        
        setTimeout(() => {
          particle.style.top = '105vh';
          particle.style.transform = `rotate(${Math.random() * 1080}deg) translateX(${Math.random() * 120 - 60}px)`;
        }, delay * 1000 + 50);
      }
      
      setTimeout(() => {
        container.remove();
      }, 5500);
    }

    function toggleGoldTheme(enabled) {
      if (enabled) {
        document.body.classList.add('gold-theme-active');
        goshikiStorage.setItem('goshiki_gold_theme_enabled_v2', 'true');
      } else {
        document.body.classList.remove('gold-theme-active');
        goshikiStorage.setItem('goshiki_gold_theme_enabled_v2', 'false');
      }
      
      const checkbox = document.getElementById('gold-theme-checkbox');
      if (checkbox) checkbox.checked = enabled;
    }

    function playApplauseSound() {
      if (!window.AudioContext && !window.webkitAudioContext) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const bufferSize = ctx.sampleRate * 0.15; // 0.15s per clap
        const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        
        const playClap = (time, intensity) => {
          const noise = ctx.createBufferSource();
          noise.buffer = noiseBuffer;
          
          const filter = ctx.createBiquadFilter();
          filter.type = 'bandpass';
          filter.Q.setValueAtTime(3.0, time);
          filter.frequency.setValueAtTime(1000 + Math.random() * 500, time);
          
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0, time);
          gain.gain.linearRampToValueAtTime(intensity * 0.12, time + 0.005);
          gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08 + Math.random() * 0.05);
          
          noise.connect(filter);
          filter.connect(gain);
          gain.connect(ctx.destination);
          
          noise.start(time);
          noise.stop(time + 0.15);
        };

        const now = ctx.currentTime;
        for (let i = 0; i < 80; i++) {
          const delay = Math.random() * 3.3;
          const intensity = Math.max(0.2, 1.0 - (delay / 3.5));
          playClap(now + delay, intensity);
        }
      } catch (e) {
        console.error("Audio error", e);
      }
    }

    function spawnGoldSparks() {
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.top = '0';
      container.style.left = '0';
      container.style.width = '100vw';
      container.style.height = '100vh';
      container.style.pointerEvents = 'none';
      container.style.zIndex = '9998';
      document.body.appendChild(container);

      for (let i = 0; i < 120; i++) {
        const spark = document.createElement('div');
        spark.className = 'spark-particle';
        spark.style.left = Math.random() * 100 + 'vw';
        spark.style.top = '102vh';
        
        const tx = Math.random() * 300 - 150;
        spark.style.setProperty('--tx', `${tx}px`);
        
        const size = Math.random() * 6 + 6;
        spark.style.width = `${size}px`;
        spark.style.height = `${size}px`;
        
        const duration = Math.random() * 2.0 + 1.5;
        const delay = Math.random() * 2.0;
        spark.style.animationDuration = `${duration}s`;
        spark.style.animationDelay = `${delay}s`;
        
        container.appendChild(spark);
      }

      setTimeout(() => {
        container.remove();
      }, 5500);
    }

    const NG_WORDS = [
      "うんこ", "ウンコ", "ちんこ", "チンコ", "ちんちん", "チンチン", "まんこ", "マンコ", "おまんこ", "オマンコ",
      "セックス", "せっくす", "sex", "しね", "死ね", "殺す", "ころす", "ばか", "バカ", "あほ", "アホ",
      "キチガイ", "きちがい", "ガイジ", "がいじ", "まぬけ", "マヌケ", "うんち", "ウンチ",
      "shit", "fuck", "bitch", "asshole", "cunt", "nigger", "dick", "pussy"
    ];

    function containsInappropriateWords(text) {
      if (!text) return false;
      const normalized = text.toLowerCase().replace(/[\s\s　]/g, "");
      for (const word of NG_WORDS) {
        if (normalized.includes(word)) {
          return true;
        }
      }
      return false;
    }
    window.containsInappropriateWords = containsInappropriateWords;

    let activeRankingTab = 'blue';
    window.switchRankingTab = function(tabColor) {
      activeRankingTab = tabColor;
      if (typeof window.listenToRankings === 'function') {
        window.listenToRankings(tabColor);
      }
    };

    function triggerSpecialTitleCelebration(titleName) {
      const panel = document.getElementById('result-title-celebration');
      const nameEl = document.getElementById('celebration-title-name');
      const counterEl = document.getElementById('celebration-title-counter');
      
      if (panel && nameEl && counterEl) {
        nameEl.textContent = titleName;
        
        let count = 0;
        if (titleName === '殿堂入り歌詠み') {
          count = parseInt(goshikiStorage.getItem('goshiki_title_count_hall_of_fame') || '0');
        } else if (titleName === '昨日を超える者') {
          count = parseInt(goshikiStorage.getItem('goshiki_title_count_yesterday') || '0');
        } else if (titleName === '頂上の挑戦者') {
          count = parseInt(goshikiStorage.getItem('goshiki_title_count_top_challenger') || '0');
        }
        
        counterEl.textContent = `×${count}`;
        panel.style.display = 'block';
        
        if (typeof showConfetti === 'function') showConfetti();
        if (typeof playCelebrationSound === 'function') playCelebrationSound();
      }
    }
    window.triggerSpecialTitleCelebration = triggerSpecialTitleCelebration;

    window.submitToRanking = function() {
      const nameInput = document.getElementById('ranking-name-input');
      const statusMsg = document.getElementById('ranking-status-msg');
      const submitBtn = document.getElementById('ranking-submit-btn');
      
      if (!nameInput || !statusMsg || !submitBtn) return;
      
      const name = nameInput.value.trim();
      if (!name) {
        alert("お名前を入力してください。");
        return;
      }

      if (containsInappropriateWords(name)) {
        alert("不適切な言葉が含まれているため、登録できません。別の名前を入力してください。");
        return;
      }
      
      // Save username
      goshikiStorage.setItem('goshiki_ranking_username', name);
      
      submitBtn.disabled = true;
      submitBtn.textContent = '送信中...';
      statusMsg.textContent = '';
      
      let uploadMode = selectedColor;
      if (uploadMode === 'mix') {
        const cnt = currentSet.length || 0;
        if (cnt === 60) {
          uploadMode = 'mix_60';
        } else if (cnt === 80) {
          uploadMode = 'mix_80';
        } else {
          uploadMode = 'mix_40';
        }
      }

      if (typeof window.submitRecordToFirebase === 'function') {
        let checkTopPromise = Promise.resolve(false);
        if (typeof window.checkIfNewGlobalTopRecord === 'function') {
          checkTopPromise = window.checkIfNewGlobalTopRecord(uploadMode, lastGameElapsed);
        }
        
        checkTopPromise.then(isTop => {
          return window.submitRecordToFirebase(name, lastGameElapsed, missesCount, uploadMode)
            .then(() => {
              submitBtn.textContent = '送信完了！';
              statusMsg.textContent = '順位表に登録されました！🎉';
              statusMsg.style.color = '#22c55e';
              
              // Check if they placed in top 5 to award title
              if (window.db && window.query) {
                const rankRef = window.ref(window.db, `rankings_v3/${uploadMode}`);
                const rankQuery = window.query(rankRef, window.orderByChild('time'), window.limitToFirst(5));
                window.get(rankQuery).then(snap => {
                  let placedInTop5 = false;
                  snap.forEach(child => {
                    const val = child.val();
                    if (val && val.name === name && val.time === lastGameElapsed) {
                      placedInTop5 = true;
                    }
                  });
                  if (placedInTop5) {
                    if (uploadMode === 'mix_40') checkBadgeUnlock('mix_master_40');
                    else if (uploadMode === 'mix_60') checkBadgeUnlock('mix_master_60');
                    else if (uploadMode === 'mix_80') checkBadgeUnlock('mix_master_80');
                  }
                }).catch(e => console.error("Badge check error", e));
              }

              if (isTop) {
                let topCount = parseInt(goshikiStorage.getItem('goshiki_title_count_top_challenger') || '0');
                topCount++;
                goshikiStorage.setItem('goshiki_title_count_top_challenger', topCount);
                if (typeof unlockSkin === 'function') {
                  unlockSkin('top-challenger');
                }
                triggerSpecialTitleCelebration('頂上の挑戦者');
              } else if (window.lastGameCelebratedTitle) {
                triggerSpecialTitleCelebration(window.lastGameCelebratedTitle);
                window.lastGameCelebratedTitle = null;
              }
            });
        })
        .catch((err) => {
          submitBtn.disabled = false;
          submitBtn.textContent = '送信する';
          statusMsg.textContent = '送信に失敗しました。設定を確認してください。';
          statusMsg.style.color = '#bd2130';
          console.error("Submission error", err);
        });
      } else {
        submitBtn.disabled = false;
        submitBtn.textContent = '送信する';
        statusMsg.textContent = 'Firebase設定が未登録のため送信できません。';
        statusMsg.style.color = '#bd2130';
      }
    };