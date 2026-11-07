(function() {
  // --- Web Audio API による 8bit風効果音・シンセサイザー ---
  var animateScore, audioCtx, bootGame, dbRegisteredAndDev, dbWellKnownFamous, dbWellKnownMinor, fireConfetti, generateOptions, handleCorrect, handleWrongAnswer, initAudio, loadStage, playTone, proceedToNextStage, scoreObj, selectAnswer, sfx, showExplanation, showFloatingText, showGameClear, showGameOver, showMenu, startTimer, state, timerAnim, updateHUD;

  audioCtx = null;

  // オーディオコンテキストの初期化（ブラウザの自動再生ポリシー対策としてユーザー操作後にresumeする）
  initAudio = function() {
    if (audioCtx == null) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      return audioCtx.resume();
    }
  };

  // 指定した周波数・波形・長さ・音量で単音を鳴らす汎用関数
  playTone = function(freq, type, duration, vol = 0.1) {
    var gain, osc;
    if (!audioCtx) {
      return;
    }
    osc = audioCtx.createOscillator();
    gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    // 音量をなめらかに減衰させてプチッというノイズを防ぐ
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    return osc.stop(audioCtx.currentTime + duration);
  };

  // ゲーム内で使用する各種効果音 (SFX) の定義
  sfx = {
    hover: function() {
      return playTone(800, 'sine', 0.1, 0.02);
    },
    correct: function() {
      playTone(880, 'square', 0.1);
      return setTimeout((function() {
        return playTone(1760, 'square', 0.15);
      }), 100);
    },
    wrong: function() {
      return playTone(150, 'sawtooth', 0.4, 0.2);
    },
    combo: function() {
      playTone(440, 'sine', 0.1);
      setTimeout((function() {
        return playTone(554, 'sine', 0.1);
      }), 100);
      return setTimeout((function() {
        return playTone(659, 'sine', 0.2);
      }), 200);
    },
    gameover: function() {
      playTone(200, 'sawtooth', 0.5, 0.3);
      return setTimeout((function() {
        return playTone(150, 'sawtooth', 1.0, 0.3);
      }), 300);
    }
  };

  // --- ポート番号データベース（外部の ports.json から非同期で読み込む） ---
  dbWellKnownFamous = []; // NORMALモード用（0-1023の超有名ポート）

  dbWellKnownMinor = []; // HARDモード用（0-1023のインフラ・マイナー系）

  dbRegisteredAndDev = []; // OMAKEモード用（1024- 開発・DB・ゲーム系）

  
  // --- ゲームの全体状態を管理するステートオブジェクト ---
  state = {
    mode: 'normal',
    maxStages: 10,
    currentPool: [],
    remainingQuestions: [],
    stage: 1,
    score: 0,
    combo: 0,
    hp: 3,
    isAnswered: false,
    isExplaining: false,
    currentTarget: null,
    currentOptions: []
  };

  timerAnim = null; // Anime.jsによるタイマーアニメーションのインスタンス

  scoreObj = {
    val: 0 // スコアのカウントアップ演出用オブジェクト
  };

  
  // --- アプリケーション起動時の処理 (DOMロード完了 & ports.jsonの読み込み) ---
  window.onload = function() {
    return (async function() {
      var data, error, response;
      try {
        response = (await fetch('ports.json'));
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        data = (await response.json());
        dbWellKnownFamous = data.dbWellKnownFamous;
        dbWellKnownMinor = data.dbWellKnownMinor;
        dbRegisteredAndDev = data.dbRegisteredAndDev;
        return showMenu();
      } catch (error1) {
        error = error1;
        console.error('Failed to load port database:', error);
        return Swal.fire({
          title: 'SYSTEM ERROR',
          text: 'データベース (ports.json) の読み込みに失敗しました。ローカルサーバー環境で実行してください。',
          icon: 'error',
          background: '#0a0a0a',
          color: '#ff003c',
          confirmButtonColor: 'var(--primary-dim)',
          customClass: {
            popup: 'swal-cyber'
          }
        });
      }
    })();
  };

  // --- モード選択・問題数選択のスタートメニューを表示 ---
  showMenu = function() {
    document.getElementById('game-ui').style.display = 'none';
    return Swal.fire({
      title: 'SYSTEM BOOT SEQUENCE',
      html: `<div style="text-align:left;">
    <label class="setup-label">[ 1. SELECT MODE ]</label>
    <select id="sel-mode" class="setup-select">
        <option value="normal">NORMAL (0-1023: 有名なウェルノウンのみ)</option>
        <option value="hard">HARD (0-1023: マイナー���ウェルノウンも含む)</option>
        <option value="omake">ALL / OMAKE (0-65535: 開発・DB・ゲーム全て)</option>
    </select>

    <label class="setup-label">[ 2. QUESTIONS ]</label>
    <select id="sel-count" class="setup-select">
        <option value="10">10 STAGES (Quick)</option>
        <option value="20">20 STAGES (Standard)</option>
        <option value="30">30 STAGES (Deep Hack)</option>
        <option value="endless">ENDLESS (Survival - HP尽きるまで)</option>
    </select>
</div>`,
      confirmButtonText: 'INITIATE HACK',
      background: '#0a0a0a',
      color: '#00ff41',
      confirmButtonColor: 'var(--primary-dim)',
      customClass: {
        popup: 'swal-cyber'
      },
      allowOutsideClick: false,
      preConfirm: function() {
        return {
          mode: document.getElementById('sel-mode').value,
          count: document.getElementById('sel-count').value
        };
      }
    }).then(function(res) {
      if (res.isConfirmed) {
        return bootGame(res.value.mode, res.value.count);
      }
    });
  };

  // --- キーボード入力のグローバルリスナー（解答選択 1〜4 ＆ 解説スキップ対応） ---
  document.addEventListener('keydown', function(e) {
    var keyMap;
    if (state.isExplaining) {
      return proceedToNextStage();
    } else if (!state.isAnswered && document.getElementById('game-ui').style.display === 'block') {
      keyMap = {
        '1': 0,
        '2': 1,
        '3': 2,
        '4': 3
      };
      if (keyMap[e.key] != null) {
        return selectAnswer(keyMap[e.key]);
      }
    }
  });

  // --- ゲームの初期化とモード反映 ---
  bootGame = function(mode, countStr) {
    initAudio();
    document.getElementById('game-ui').style.display = 'block';
    state.mode = mode;
    if (mode === 'normal') {
      state.currentPool = [...dbWellKnownFamous];
      document.getElementById('mode-display').style.color = "var(--primary)";
    }
    if (mode === 'hard') {
      state.currentPool = [...dbWellKnownFamous, ...dbWellKnownMinor];
      document.getElementById('mode-display').style.color = "#ffaa00";
    }
    if (mode === 'omake') {
      state.currentPool = [...dbWellKnownFamous, ...dbWellKnownMinor, ...dbRegisteredAndDev];
      document.getElementById('mode-display').style.color = "var(--secondary)";
    }
    state.maxStages = countStr === 'endless' ? 2e308 : parseInt(countStr);
    document.getElementById('mode-display').textContent = mode.toUpperCase();
    document.getElementById('max-stages').textContent = state.maxStages === 2e308 ? '∞' : state.maxStages;
    document.querySelectorAll('.btn-option').forEach(function(btn) {
      return btn.addEventListener('mouseenter', sfx.hover);
    });
    state.remainingQuestions = [...state.currentPool].sort(function() {
      return 0.5 - Math.random();
    });
    state.stage = 1;
    state.score = 0;
    state.combo = 0;
    state.hp = 3;
    state.isAnswered = false;
    state.isExplaining = false;
    scoreObj.val = 0;
    updateHUD();
    return loadStage();
  };

  // --- 次の問題（ステージ）をロードして画面にセット ---
  loadStage = function() {
    var decay, isReverse, qText, tDisplay, timeLimit;
    state.isAnswered = false;
    state.isExplaining = false;
    if (timerAnim != null) {
      timerAnim.pause();
    }
    document.getElementById('options-container').style.display = 'grid';
    document.getElementById('explanation-panel').style.display = 'none';
    document.getElementById('timer-bar').style.width = '100%';
    document.getElementById('timer-bar').style.backgroundColor = 'var(--primary)';
    document.querySelectorAll('.btn-option').forEach(function(btn) {
      btn.style.backgroundColor = 'transparent';
      btn.style.borderColor = 'var(--primary-dim)';
      return btn.style.color = 'var(--text-main)';
    });
    if (state.remainingQuestions.length === 0) {
      state.remainingQuestions = [...state.currentPool].sort(function() {
        return 0.5 - Math.random();
      });
    }
    state.currentTarget = state.remainingQuestions.pop();
    isReverse = Math.random() < 0.35;
    qText = document.getElementById('question-text');
    tDisplay = document.getElementById('target-display');
    if (isReverse) {
      qText.textContent = "Target Port > Identify Protocol";
      tDisplay.textContent = ":" + state.currentTarget.port;
      tDisplay.className = 'target-name reverse-mode';
      generateOptions(state.currentTarget.name, true);
    } else {
      qText.textContent = "Target Protocol > Identify Port";
      tDisplay.textContent = state.currentTarget.name;
      tDisplay.className = 'target-name';
      generateOptions(state.currentTarget.port, false);
    }
    decay = state.stage * 150;
    timeLimit = Math.max(3000, 10000 - decay);
    return startTimer(timeLimit);
  };

  // --- 4つの選択肢（正解1つ + ダミー3つ）を生成してボタンに割り当て ---
  generateOptions = function(correctVal, isReverse) {
    var candidate, i, j, options, results, rnd;
    options = [correctVal];
    while (options.length < 4) {
      rnd = state.currentPool[Math.floor(Math.random() * state.currentPool.length)];
      candidate = isReverse ? rnd.name : rnd.port;
      if (!options.includes(candidate)) {
        options.push(candidate);
      }
    }
    state.currentOptions = options.sort(function() {
      return 0.5 - Math.random();
    });
    results = [];
    for (i = j = 0; j < 4; i = ++j) {
      results.push(document.getElementById(`btn-${i}`).textContent = state.currentOptions[i]);
    }
    return results;
  };

  // --- 制限時間タイマーを起動 (Anime.js) ---
  startTimer = function(duration) {
    return timerAnim = anime({
      targets: '#timer-bar',
      width: '0%',
      duration: duration,
      easing: 'linear',
      update: function(anim) {
        if (anim.progress > 70) {
          return document.getElementById('timer-bar').style.backgroundColor = 'var(--danger)';
        }
      },
      complete: function() {
        return handleWrongAnswer(null);
      }
    });
  };

  // --- プレイヤーが選択肢をクリック・またはキー入力したときの判定処理 ---
  selectAnswer = function(index) {
    var btn, isCorrect, selected;
    if (state.isAnswered) {
      return;
    }
    state.isAnswered = true;
    timerAnim.pause();
    selected = state.currentOptions[index];
    btn = document.getElementById(`btn-${index}`);
    isCorrect = selected === state.currentTarget.name || selected === state.currentTarget.port;
    if (isCorrect) {
      return handleCorrect(btn);
    } else {
      return handleWrongAnswer(btn);
    }
  };

  // --- 正解時の処理（スコア加算、コンボ更新、演出） ---
  handleCorrect = function(btn) {
    var earned, modeMult, timeRemains;
    state.combo++;
    modeMult = state.mode === 'omake' ? 1.5 : (state.mode === 'hard' ? 1.2 : 1.0);
    timeRemains = parseFloat(document.getElementById('timer-bar').style.width) / 100;
    earned = Math.floor(((100 + (timeRemains * 200)) * (1 + state.combo * 0.2)) * modeMult);
    animateScore(earned);
    showFloatingText(`+${earned}`, btn, 'var(--primary)');
    btn.style.backgroundColor = 'var(--primary)';
    btn.style.color = '#000';
    if (state.combo > 0 && state.combo % 3 === 0) {
      sfx.combo();
      fireConfetti();
      showFloatingText(`COMBO x${state.combo}!`, document.getElementById('combo'), 'var(--secondary)');
    } else {
      sfx.correct();
    }
    return setTimeout(showExplanation, 500);
  };

  // --- 不正解・タイムアウト時の処理（HP減少、画面揺れ、正解ハイライト） ---
  handleWrongAnswer = function(btn) {
    var i, j;
    state.combo = 0;
    state.hp--;
    sfx.wrong();
    updateHUD();
    anime({
      targets: '#game-ui',
      translateX: [0, -15, 15, -15, 15, 0],
      duration: 400,
      easing: 'easeInOutQuad'
    });
    if (btn) {
      btn.style.backgroundColor = 'var(--danger)';
      showFloatingText('DENIED', btn, 'var(--danger)');
    } else {
      showFloatingText('TIMEOUT', document.getElementById('timer-bar'), 'var(--danger)');
    }
    for (i = j = 0; j < 4; i = ++j) {
      if (state.currentOptions[i] === state.currentTarget.name || state.currentOptions[i] === state.currentTarget.port) {
        document.getElementById(`btn-${i}`).style.borderColor = 'var(--primary)';
        document.getElementById(`btn-${i}`).style.color = 'var(--primary)';
      }
    }
    return setTimeout(showExplanation, 600);
  };

  // --- ポートの解説パネルを表示 ---
  showExplanation = function() {
    var expPanel;
    state.isExplaining = true;
    document.getElementById('options-container').style.display = 'none';
    expPanel = document.getElementById('explanation-panel');
    expPanel.style.display = 'flex';
    document.getElementById('exp-title').textContent = `${state.currentTarget.name} (Port ${state.currentTarget.port})`;
    document.getElementById('exp-desc').textContent = state.currentTarget.desc;
    return anime({
      targets: expPanel,
      opacity: [0, 1],
      translateY: [20, 0],
      duration: 300,
      easing: 'easeOutQuad'
    });
  };

  // --- 解説パネルから次のステージ、またはゲームオーバー／クリアへ移行する ---
  proceedToNextStage = function() {
    if (!state.isExplaining) {
      return;
    }
    state.isExplaining = false;
    if (state.hp <= 0) {
      return showGameOver();
    } else {
      state.stage++;
      if (state.stage > state.maxStages) {
        return showGameClear();
      } else {
        updateHUD();
        return loadStage();
      }
    }
  };

  // --- HUD（画面上のステータス表示）を最新の状態に更新 ---
  updateHUD = function() {
    document.getElementById('stage').textContent = state.maxStages === 2e308 ? state.stage : Math.min(state.stage, state.maxStages);
    document.getElementById('combo').textContent = state.combo;
    return document.getElementById('hp').textContent = '♥'.repeat(state.hp) + '♡'.repeat(3 - state.hp);
  };

  // --- スコアが加算されるときに数値をなめらかにカウントアップさせる ---
  animateScore = function(addVal) {
    state.score += addVal;
    return anime({
      targets: scoreObj,
      val: state.score,
      round: 1,
      duration: 1000,
      easing: 'easeOutExpo',
      update: function() {
        return document.getElementById('score').textContent = scoreObj.val;
      }
    });
  };

  // --- 獲得スコアやテキストをふわっと上に浮かび上がらせる演出 ---
  showFloatingText = function(text, targetEl, color) {
    var floatEl, rect;
    rect = targetEl.getBoundingClientRect();
    floatEl = document.createElement('div');
    floatEl.className = 'floating-score';
    floatEl.textContent = text;
    floatEl.style.left = `${rect.left + rect.width / 2 - 40}px`;
    floatEl.style.top = `${rect.top}px`;
    floatEl.style.color = color;
    document.body.appendChild(floatEl);
    return anime({
      targets: floatEl,
      translateY: -80,
      opacity: [1, 0],
      duration: 1200,
      easing: 'easeOutCubic',
      complete: function() {
        return floatEl.remove();
      }
    });
  };

  // --- 紙吹雪（パーティクル）を発生させる ---
  fireConfetti = function() {
    return confetti({
      particleCount: 80,
      spread: 70,
      origin: {
        y: 0.8
      },
      colors: ['#00ff41', '#00ffff', '#ffffff'],
      disableForReducedMotion: true
    });
  };

  // --- ゲームオーバー画面の表示 ---
  showGameOver = function() {
    sfx.gameover();
    return Swal.fire({
      title: 'HACK FAILED',
      html: `SYSTEM LOCKED OUT<br><br>MODE: ${state.mode.toUpperCase()}<br>REACHED STAGE: ${state.stage}<br>FINAL SCORE: <b style=\"color:var(--danger)\">${state.score}</b>`,
      background: '#111',
      color: 'var(--danger)',
      confirmButtonColor: 'var(--danger)',
      confirmButtonText: 'RETURN TO MENU',
      customClass: {
        popup: 'swal-cyber'
      }
    }).then(showMenu);
  };

  // --- ゲームクリア画面の表示 ---
  showGameClear = function() {
    var burst, cInterval;
    sfx.combo();
    burst = 3;
    cInterval = setInterval((function() {
      fireConfetti();
      burst--;
      if (burst === 0) {
        return clearInterval(cInterval);
      }
    }), 300);
    return Swal.fire({
      title: 'ACCESS GRANTED!',
      html: `ALL SECURITY CLEARED.<br><br>MODE: ${state.mode.toUpperCase()}<br>FINAL SCORE: <b style=\"color:var(--primary); font-size:24px;\">${state.score}</b>`,
      background: '#111',
      color: 'var(--primary)',
      confirmButtonColor: 'var(--primary-dim)',
      confirmButtonText: 'RETURN TO MENU',
      customClass: {
        popup: 'swal-cyber'
      }
    }).then(showMenu);
  };

}).call(this);
/home/jdoodle.js:100
  window.onload = function() {
  ^

ReferenceError: window is not defined
    at Object.<anonymous> (/home/jdoodle.js:100:3)
    at Object.<anonymous> (/home/jdoodle.js:512:4)
    at Module._compile (node:internal/modules/cjs/loader:1376:14)
    at Module._extensions..js (node:internal/modules/cjs/loader:1435:10)
    at Module.load (node:internal/modules/cjs/loader:1207:32)
    at Module._load (node:internal/modules/cjs/loader:1023:12)
    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:135:12)
    at node:internal/main/run_main_module:28:49

Node.js v21.2.0
