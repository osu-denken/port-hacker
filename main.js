let audioCtx;
function initAudio() {
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === 'suspended') audioCtx.resume();
}
function playTone(freq, type, duration, vol=0.1) {
    if(!audioCtx) return;
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + duration);
}
const sfx = {
    hover: () => playTone(800, 'sine', 0.1, 0.02),
    correct: () => { playTone(880, 'square', 0.1); setTimeout(()=>playTone(1760, 'square', 0.15), 100); },
    wrong: () => playTone(150, 'sawtooth', 0.4, 0.2),
    combo: () => { playTone(440, 'sine', 0.1); setTimeout(()=>playTone(554, 'sine', 0.1), 100); setTimeout(()=>playTone(659, 'sine', 0.2), 200); },
    gameover: () => { playTone(200, 'sawtooth', 0.5, 0.3); setTimeout(()=>playTone(150, 'sawtooth', 1.0, 0.3), 300); }
};

// --- 厳密なポート番号データベース ---

let dbWellKnownFamous = [];
let dbWellKnownMinor = [];
let dbRegisteredAndDev = [];

let state = {
    mode: 'normal', maxStages: 10, currentPool: [], remainingQuestions: [],
    stage: 1, score: 0, combo: 0, hp: 3, 
    isAnswered: false, isExplaining: false, 
    currentTarget: null, currentOptions: []
};
let timerAnim;
let scoreObj = { val: 0 };

window.onload = async () => {
    try {
        const response = await fetch('ports.json');
        if (!response.ok) throw new Error('Network response was not ok');
        
        const data = await response.json();
        dbWellKnownFamous = data.dbWellKnownFamous;
        dbWellKnownMinor = data.dbWellKnownMinor;
        dbRegisteredAndDev = data.dbRegisteredAndDev;
        
        showMenu(); // 読み込み完了後にメニュー表示
    } catch (error) {
        console.error('Failed to load port database:', error);
        Swal.fire({
            title: 'SYSTEM ERROR',
            text: 'データベース (ports.json) の読み込みに失敗しました。ローカルサーバー環境で実行してください。',
            icon: 'error',
            background: '#0a0a0a', color: '#ff003c',
            confirmButtonColor: 'var(--primary-dim)',
            customClass: { popup: 'swal-cyber' }
        });
    }
};

function showMenu() {
    document.getElementById('game-ui').style.display = 'none';
    Swal.fire({
        title: 'SYSTEM BOOT SEQUENCE',
        html: `
            <div style="text-align:left;">
                <label class="setup-label">[ 1. SELECT MODE ]</label>
                <select id="sel-mode" class="setup-select">
                    <option value="normal">NORMAL (0-1023: 有名なウェルノウンのみ)</option>
                    <option value="hard">HARD (0-1023: マイナーなウェルノウンも含む)</option>
                    <option value="omake">ALL / OMAKE (0-65535: 開発・DB・ゲーム全て)</option>
                </select>

                <label class="setup-label">[ 2. QUESTIONS ]</label>
                <select id="sel-count" class="setup-select">
                    <option value="10">10 STAGES (Quick)</option>
                    <option value="20">20 STAGES (Standard)</option>
                    <option value="30">30 STAGES (Deep Hack)</option>
                    <option value="endless">ENDLESS (Survival - HP尽きるまで)</option>
                </select>
            </div>
        `,
        confirmButtonText: 'INITIATE HACK',
        background: '#0a0a0a', color: '#00ff41',
        confirmButtonColor: 'var(--primary-dim)',
        customClass: { popup: 'swal-cyber' },
        allowOutsideClick: false,
        preConfirm: () => {
            return { mode: document.getElementById('sel-mode').value, count: document.getElementById('sel-count').value }
        }
    }).then((res) => {
        if(res.isConfirmed) bootGame(res.value.mode, res.value.count);
    });
}

document.addEventListener('keydown', (e) => {
    if (state.isExplaining) proceedToNextStage();
    else if (!state.isAnswered && document.getElementById('game-ui').style.display === 'block') {
        const keyMap = {'1':0, '2':1, '3':2, '4':3};
        if(keyMap[e.key] !== undefined) selectAnswer(keyMap[e.key]);
    }
});

function bootGame(mode, countStr) {
    initAudio();
    document.getElementById('game-ui').style.display = 'block';
    
    state.mode = mode;
    if(mode === 'normal') { state.currentPool = [...dbWellKnownFamous]; document.getElementById('mode-display').style.color = "var(--primary)"; }
    if(mode === 'hard') { state.currentPool = [...dbWellKnownFamous, ...dbWellKnownMinor]; document.getElementById('mode-display').style.color = "#ffaa00"; }
    if(mode === 'omake') { state.currentPool = [...dbWellKnownFamous, ...dbWellKnownMinor, ...dbRegisteredAndDev]; document.getElementById('mode-display').style.color = "var(--secondary)"; }
    
    if (countStr === 'endless') {
        state.maxStages = Infinity;
    } else {
        state.maxStages = parseInt(countStr);
    }

    document.getElementById('mode-display').textContent = mode.toUpperCase();
    document.getElementById('max-stages').textContent = state.maxStages === Infinity ? '∞' : state.maxStages;

    document.querySelectorAll('.btn-option').forEach(btn => btn.addEventListener('mouseenter', sfx.hover));
    
    state.remainingQuestions = [...state.currentPool].sort(() => 0.5 - Math.random());
    state.stage = 1; state.score = 0; state.combo = 0; state.hp = 3; 
    state.isAnswered = false; state.isExplaining = false;
    scoreObj.val = 0;
    
    updateHUD(); loadStage();
}

function loadStage() {
    state.isAnswered = false; state.isExplaining = false;
    if(timerAnim) timerAnim.pause();
    
    document.getElementById('options-container').style.display = 'grid';
    document.getElementById('explanation-panel').style.display = 'none';
    document.getElementById('timer-bar').style.width = '100%';
    document.getElementById('timer-bar').style.backgroundColor = 'var(--primary)';
    
    document.querySelectorAll('.btn-option').forEach(btn => {
        btn.style.backgroundColor = 'transparent'; btn.style.borderColor = 'var(--primary-dim)'; btn.style.color = 'var(--text-main)';
    });

    // 問題が枯渇した場合（エンドレスモード等）はプールを再シャッフル
    if (state.remainingQuestions.length === 0) {
        state.remainingQuestions = [...state.currentPool].sort(() => 0.5 - Math.random());
    }
    state.currentTarget = state.remainingQuestions.pop();
    
    const isReverse = Math.random() < 0.35;
    const qText = document.getElementById('question-text');
    const tDisplay = document.getElementById('target-display');
    
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

    // タイマー短縮（難易度やステージ進行に合わせる。ただし最短3秒でストップ）
    const decay = state.stage * 150;
    const timeLimit = Math.max(3000, 10000 - decay);
    startTimer(timeLimit);
}

function generateOptions(correctVal, isReverse) {
    const options = [correctVal];
    while (options.length < 4) {
        const rnd = state.currentPool[Math.floor(Math.random() * state.currentPool.length)];
        const candidate = isReverse ? rnd.name : rnd.port;
        if (!options.includes(candidate)) options.push(candidate);
    }
    state.currentOptions = options.sort(() => 0.5 - Math.random());
    for(let i=0; i<4; i++) document.getElementById('btn-'+i).textContent = state.currentOptions[i];
}

function startTimer(duration) {
    timerAnim = anime({
        targets: '#timer-bar', width: '0%', duration: duration, easing: 'linear',
        update: function(anim) { if(anim.progress > 70) document.getElementById('timer-bar').style.backgroundColor = 'var(--danger)'; },
        complete: function() { handleWrongAnswer(null); }
    });
}

function selectAnswer(index) {
    if(state.isAnswered) return;
    state.isAnswered = true; timerAnim.pause();
    const selected = state.currentOptions[index];
    const btn = document.getElementById('btn-'+index);
    const isCorrect = (selected === state.currentTarget.name || selected === state.currentTarget.port);
    if(isCorrect) handleCorrect(btn); else handleWrongAnswer(btn);
}

function handleCorrect(btn) {
    state.combo++;
    const modeMult = state.mode === 'omake' ? 1.5 : (state.mode === 'hard' ? 1.2 : 1.0);
    const timeRemains = parseFloat(document.getElementById('timer-bar').style.width) / 100;
    const earned = Math.floor(((100 + (timeRemains * 200)) * (1 + state.combo * 0.2)) * modeMult);
    
    animateScore(earned); showFloatingText(`+${earned}`, btn, 'var(--primary)');
    btn.style.backgroundColor = 'var(--primary)'; btn.style.color = '#000';
    
    if(state.combo > 0 && state.combo % 3 === 0) {
        sfx.combo(); fireConfetti(); showFloatingText(`COMBO x${state.combo}!`, document.getElementById('combo'), 'var(--secondary)');
    } else sfx.correct();
    
    setTimeout(showExplanation, 500);
}

function handleWrongAnswer(btn) {
    state.combo = 0; state.hp--; sfx.wrong(); updateHUD();
    anime({ targets: '#game-ui', translateX: [0, -15, 15, -15, 15, 0], duration: 400, easing: 'easeInOutQuad' });

    if(btn) { btn.style.backgroundColor = 'var(--danger)'; showFloatingText('DENIED', btn, 'var(--danger)'); } 
    else { showFloatingText('TIMEOUT', document.getElementById('timer-bar'), 'var(--danger)'); }

    for(let i=0; i<4; i++) {
        if(state.currentOptions[i] === state.currentTarget.name || state.currentOptions[i] === state.currentTarget.port) {
            document.getElementById('btn-'+i).style.borderColor = 'var(--primary)'; document.getElementById('btn-'+i).style.color = 'var(--primary)';
        }
    }
    setTimeout(showExplanation, 600);
}

function showExplanation() {
    state.isExplaining = true; document.getElementById('options-container').style.display = 'none';
    const expPanel = document.getElementById('explanation-panel'); expPanel.style.display = 'flex';
    document.getElementById('exp-title').textContent = `${state.currentTarget.name} (Port ${state.currentTarget.port})`;
    document.getElementById('exp-desc').textContent = state.currentTarget.desc;
    anime({ targets: expPanel, opacity: [0, 1], translateY: [20, 0], duration: 300, easing: 'easeOutQuad' });
}

function proceedToNextStage() {
    if(!state.isExplaining) return;
    state.isExplaining = false;
    
    if(state.hp <= 0) showGameOver();
    else {
        state.stage++;
        if(state.stage > state.maxStages) showGameClear();
        else { updateHUD(); loadStage(); }
    }
}

function updateHUD() {
    document.getElementById('stage').textContent = state.maxStages === Infinity ? state.stage : Math.min(state.stage, state.maxStages);
    document.getElementById('combo').textContent = state.combo;
    document.getElementById('hp').textContent = '♥'.repeat(state.hp) + '♡'.repeat(3 - state.hp);
}

function animateScore(addVal) {
    state.score += addVal;
    anime({ targets: scoreObj, val: state.score, round: 1, duration: 1000, easing: 'easeOutExpo', update: () => { document.getElementById('score').textContent = scoreObj.val; } });
}

function showFloatingText(text, targetEl, color) {
    const rect = targetEl.getBoundingClientRect(); const floatEl = document.createElement('div');
    floatEl.className = 'floating-score'; floatEl.textContent = text;
    floatEl.style.left = (rect.left + rect.width / 2 - 40) + 'px'; floatEl.style.top = rect.top + 'px';
    floatEl.style.color = color; document.body.appendChild(floatEl);
    anime({ targets: floatEl, translateY: -80, opacity: [1, 0], duration: 1200, easing: 'easeOutCubic', complete: () => floatEl.remove() });
}

function fireConfetti() { confetti({ particleCount: 80, spread: 70, origin: { y: 0.8 }, colors: ['#00ff41', '#00ffff', '#ffffff'], disableForReducedMotion: true }); }

function showGameOver() {
    sfx.gameover();
    Swal.fire({
        title: 'HACK FAILED',
        html: `SYSTEM LOCKED OUT<br><br>MODE: ${state.mode.toUpperCase()}<br>REACHED STAGE: ${state.stage}<br>FINAL SCORE: <b style="color:var(--danger)">${state.score}</b>`,
        background: '#111', color: 'var(--danger)', confirmButtonColor: 'var(--danger)', confirmButtonText: 'RETURN TO MENU',
        customClass: { popup: 'swal-cyber' }
    }).then(showMenu);
}

function showGameClear() {
    sfx.combo(); let burst = 3;
    const cInterval = setInterval(() => { fireConfetti(); burst--; if(burst === 0) clearInterval(cInterval); }, 300);
    Swal.fire({
        title: 'ACCESS GRANTED!',
        html: `ALL SECURITY CLEARED.<br><br>MODE: ${state.mode.toUpperCase()}<br>FINAL SCORE: <b style="color:var(--primary); font-size:24px;">${state.score}</b>`,
        background: '#111', color: 'var(--primary)', confirmButtonColor: 'var(--primary-dim)', confirmButtonText: 'RETURN TO MENU',
        customClass: { popup: 'swal-cyber' }
    }).then(showMenu);
}
