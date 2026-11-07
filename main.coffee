# --- Web Audio API による 8bit風効果音・シンセサイザー ---
audioCtx = null

# オーディオコンテキストの初期化（ブラウザの自動再生ポリシー対策としてユーザー操作後にresumeする）
initAudio = ->
    audioCtx ?= new (window.AudioContext || window.webkitAudioContext)()
    audioCtx.resume() if audioCtx.state is 'suspended'

# 指定した周波数・波形・長さ・音量で単音を鳴らす汎用関数
playTone = (freq, type, duration, vol = 0.1) ->
    return unless audioCtx
    osc = audioCtx.createOscillator()
    gain = audioCtx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime)
    gain.gain.setValueAtTime(vol, audioCtx.currentTime)
    # 音量をなめらかに減衰させてプチッというノイズを防ぐ
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration)
    osc.connect(gain)
    gain.connect(audioCtx.destination)
    osc.start()
    osc.stop(audioCtx.currentTime + duration)

# ゲーム内で使用する各種効果音 (SFX) の定義
sfx =
    hover: -> playTone(800, 'sine', 0.1, 0.02)
    correct: ->
        playTone(880, 'square', 0.1)
        setTimeout (-> playTone(1760, 'square', 0.15)), 100
    wrong: -> playTone(150, 'sawtooth', 0.4, 0.2)
    combo: ->
        playTone(440, 'sine', 0.1)
        setTimeout (-> playTone(554, 'sine', 0.1)), 100
        setTimeout (-> playTone(659, 'sine', 0.2)), 200
    gameover: ->
        playTone(200, 'sawtooth', 0.5, 0.3)
        setTimeout (-> playTone(150, 'sawtooth', 1.0, 0.3)), 300


# --- ポート番号データベース（外部の ports.json から非同期で読み込む） ---
dbWellKnownFamous = []    # NORMALモード用（0-1023の超有名ポート）
dbWellKnownMinor = []     # HARDモード用（0-1023のインフラ・マイナー系）
dbRegisteredAndDev = []   # OMAKEモード用（1024- 開発・DB・ゲーム系）


# --- ゲームの全体状態を管理するステートオブジェクト ---
state =
    mode: 'normal'
    maxStages: 10
    currentPool: []
    remainingQuestions: []
    stage: 1
    score: 0
    combo: 0
    hp: 3
    isAnswered: false
    isExplaining: false
    currentTarget: null
    currentOptions: []

timerAnim = null              # Anime.jsによるタイマーアニメーションのインスタンス
scoreObj = val: 0             # スコアのカウントアップ演出用オブジェクト


# --- アプリケーション起動時の処理 (DOMロード完了 & ports.jsonの読み込み) ---
window.onload = ->
    do ->
        try
            response = await fetch('ports.json')
            throw new Error('Network response was not ok') unless response.ok
            
            data = await response.json()
            dbWellKnownFamous = data.dbWellKnownFamous
            dbWellKnownMinor = data.dbWellKnownMinor
            dbRegisteredAndDev = data.dbRegisteredAndDev
            
            showMenu()
        catch error
            console.error('Failed to load port database:', error)
            Swal.fire(
                title: 'SYSTEM ERROR'
                text: 'データベース (ports.json) の読み込みに失敗しました。ローカルサーバー環境で実行してください。'
                icon: 'error'
                background: '#0a0a0a'
                color: '#ff003c'
                confirmButtonColor: 'var(--primary-dim)'
                customClass: popup: 'swal-cyber'
            )


# --- モード選択・問題数選択のスタートメニューを表示 ---
showMenu = ->
    document.getElementById('game-ui').style.display = 'none'
    Swal.fire(
        title: 'SYSTEM BOOT SEQUENCE'
        html: """
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
        """
        confirmButtonText: 'INITIATE HACK'
        background: '#0a0a0a'
        color: '#00ff41'
        confirmButtonColor: 'var(--primary-dim)'
        customClass: popup: 'swal-cyber'
        allowOutsideClick: false
        preConfirm: ->
            mode: document.getElementById('sel-mode').value
            count: document.getElementById('sel-count').value
    ).then (res) ->
        bootGame(res.value.mode, res.value.count) if res.isConfirmed


# --- キーボード入力のグローバルリスナー（解答選択 1〜4 ＆ 解説スキップ対応） ---
document.addEventListener 'keydown', (e) ->
    if state.isExplaining
        proceedToNextStage()
    else if not state.isAnswered and document.getElementById('game-ui').style.display is 'block'
        keyMap = '1': 0, '2': 1, '3': 2, '4': 3
        selectAnswer(keyMap[e.key]) if keyMap[e.key]?


# --- ゲームの初期化とモード反映 ---
bootGame = (mode, countStr) ->
    initAudio()
    document.getElementById('game-ui').style.display = 'block'
    
    state.mode = mode
    if mode is 'normal'
        state.currentPool = [...dbWellKnownFamous]
        document.getElementById('mode-display').style.color = "var(--primary)"
    if mode is 'hard'
        state.currentPool = [...dbWellKnownFamous, ...dbWellKnownMinor]
        document.getElementById('mode-display').style.color = "#ffaa00"
    if mode is 'omake'
        state.currentPool = [...dbWellKnownFamous, ...dbWellKnownMinor, ...dbRegisteredAndDev]
        document.getElementById('mode-display').style.color = "var(--secondary)"
    
    state.maxStages = if countStr is 'endless' then Infinity else parseInt(countStr)

    document.getElementById('mode-display').textContent = mode.toUpperCase()
    document.getElementById('max-stages').textContent = if state.maxStages is Infinity then '∞' else state.maxStages

    document.querySelectorAll('.btn-option').forEach (btn) ->
        btn.addEventListener 'mouseenter', sfx.hover
    
    state.remainingQuestions = [...state.currentPool].sort -> 0.5 - Math.random()
    
    state.stage = 1
    state.score = 0
    state.combo = 0
    state.hp = 3
    state.isAnswered = false
    state.isExplaining = false
    scoreObj.val = 0
    
    updateHUD()
    loadStage()


# --- 次の問題（ステージ）をロードして画面にセット ---
loadStage = ->
    state.isAnswered = false
    state.isExplaining = false
    timerAnim.pause() if timerAnim?
    
    document.getElementById('options-container').style.display = 'grid'
    document.getElementById('explanation-panel').style.display = 'none'
    document.getElementById('timer-bar').style.width = '100%'
    document.getElementById('timer-bar').style.backgroundColor = 'var(--primary)'
    
    document.querySelectorAll('.btn-option').forEach (btn) ->
        btn.style.backgroundColor = 'transparent'
        btn.style.borderColor = 'var(--primary-dim)'
        btn.style.color = 'var(--text-main)'

    if state.remainingQuestions.length is 0
        state.remainingQuestions = [...state.currentPool].sort -> 0.5 - Math.random()
        
    state.currentTarget = state.remainingQuestions.pop()
    
    isReverse = Math.random() < 0.35
    qText = document.getElementById('question-text')
    tDisplay = document.getElementById('target-display')
    
    if isReverse
        qText.textContent = "Target Port > Identify Protocol"
        tDisplay.textContent = ":" + state.currentTarget.port
        tDisplay.className = 'target-name reverse-mode'
        generateOptions(state.currentTarget.name, true)
    else
        qText.textContent = "Target Protocol > Identify Port"
        tDisplay.textContent = state.currentTarget.name
        tDisplay.className = 'target-name'
        generateOptions(state.currentTarget.port, false)

    decay = state.stage * 150
    timeLimit = Math.max(3000, 10000 - decay)
    startTimer(timeLimit)


# --- 4つの選択肢（正解1つ + ダミー3つ）を生成してボタンに割り当て ---
generateOptions = (correctVal, isReverse) ->
    options = [correctVal]
    while options.length < 4
        rnd = state.currentPool[Math.floor(Math.random() * state.currentPool.length)]
        candidate = if isReverse then rnd.name else rnd.port
        options.push(candidate) unless options.includes(candidate)
        
    state.currentOptions = options.sort -> 0.5 - Math.random()
    for i in [0...4]
        document.getElementById("btn-#{i}").textContent = state.currentOptions[i]


# --- 制限時間タイマーを起動 (Anime.js) ---
startTimer = (duration) ->
    timerAnim = anime
        targets: '#timer-bar'
        width: '0%'
        duration: duration
        easing: 'linear'
        update: (anim) ->
            if anim.progress > 70
                document.getElementById('timer-bar').style.backgroundColor = 'var(--danger)'
        complete: ->
            handleWrongAnswer(null)


# --- プレイヤーが選択肢をクリック・またはキー入力したときの判定処理 ---
selectAnswer = (index) ->
    return if state.isAnswered
    state.isAnswered = true
    timerAnim.pause()
    
    selected = state.currentOptions[index]
    btn = document.getElementById("btn-#{index}")
    isCorrect = (selected is state.currentTarget.name or selected is state.currentTarget.port)
    
    if isCorrect
        handleCorrect(btn)
    else
        handleWrongAnswer(btn)


# --- 正解時の処理（スコア加算、コンボ更新、演出） ---
handleCorrect = (btn) ->
    state.combo++
    modeMult = if state.mode is 'omake' then 1.5 else (if state.mode is 'hard' then 1.2 else 1.0)
    timeRemains = parseFloat(document.getElementById('timer-bar').style.width) / 100
    earned = Math.floor(((100 + (timeRemains * 200)) * (1 + state.combo * 0.2)) * modeMult)
    
    animateScore(earned)
    showFloatingText("+#{earned}", btn, 'var(--primary)')
    
    btn.style.backgroundColor = 'var(--primary)'
    btn.style.color = '#000'
    
    if state.combo > 0 and state.combo % 3 is 0
        sfx.combo()
        fireConfetti()
        showFloatingText("COMBO x#{state.combo}!", document.getElementById('combo'), 'var(--secondary)')
    else
        sfx.correct()
        
    setTimeout showExplanation, 500


# --- 不正解・タイムアウト時の処理（HP減少、画面揺れ、正解ハイライト） ---
handleWrongAnswer = (btn) ->
    state.combo = 0
    state.hp--
    sfx.wrong()
    updateHUD()

    anime
        targets: '#game-ui'
        translateX: [0, -15, 15, -15, 15, 0]
        duration: 400
        easing: 'easeInOutQuad'

    if btn
        btn.style.backgroundColor = 'var(--danger)'
        showFloatingText('DENIED', btn, 'var(--danger)')
    else
        showFloatingText('TIMEOUT', document.getElementById('timer-bar'), 'var(--danger)')

    for i in [0...4]
        if state.currentOptions[i] is state.currentTarget.name or state.currentOptions[i] is state.currentTarget.port
            document.getElementById("btn-#{i}").style.borderColor = 'var(--primary)'
            document.getElementById("btn-#{i}").style.color = 'var(--primary)'
            
    setTimeout showExplanation, 600


# --- ポートの解説パネルを表示 ---
showExplanation = ->
    state.isExplaining = true
    document.getElementById('options-container').style.display = 'none'
    
    expPanel = document.getElementById('explanation-panel')
    expPanel.style.display = 'flex'
    
    document.getElementById('exp-title').textContent = "#{state.currentTarget.name} (Port #{state.currentTarget.port})"
    document.getElementById('exp-desc').textContent = state.currentTarget.desc
    
    anime
        targets: expPanel
        opacity: [0, 1]
        translateY: [20, 0]
        duration: 300
        easing: 'easeOutQuad'


# --- 解説パネルから次のステージ、またはゲームオーバー／クリアへ移行する ---
proceedToNextStage = ->
    return unless state.isExplaining
    state.isExplaining = false
    
    if state.hp <= 0
        showGameOver()
    else
        state.stage++
        if state.stage > state.maxStages
            showGameClear()
        else
            updateHUD()
            loadStage()


# --- HUD（画面上のステータス表示）を最新の状態に更新 ---
updateHUD = ->
    document.getElementById('stage').textContent = if state.maxStages is Infinity then state.stage else Math.min(state.stage, state.maxStages)
    document.getElementById('combo').textContent = state.combo
    document.getElementById('hp').textContent = '♥'.repeat(state.hp) + '♡'.repeat(3 - state.hp)


# --- スコアが加算されるときに数値をなめらかにカウントアップさせる ---
animateScore = (addVal) ->
    state.score += addVal
    anime
        targets: scoreObj
        val: state.score
        round: 1
        duration: 1000
        easing: 'easeOutExpo'
        update: ->
            document.getElementById('score').textContent = scoreObj.val


# --- 獲得スコアやテキストをふわっと上に浮かび上がらせる演出 ---
showFloatingText = (text, targetEl, color) ->
    rect = targetEl.getBoundingClientRect()
    floatEl = document.createElement('div')
    floatEl.className = 'floating-score'
    floatEl.textContent = text
    floatEl.style.left = "#{rect.left + rect.width / 2 - 40}px"
    floatEl.style.top = "#{rect.top}px"
    floatEl.style.color = color
    document.body.appendChild(floatEl)
    
    anime
        targets: floatEl
        translateY: -80
        opacity: [1, 0]
        duration: 1200
        easing: 'easeOutCubic'
        complete: -> floatEl.remove()


# --- 紙吹雪（パーティクル）を発生させる ---
fireConfetti = ->
    confetti
        particleCount: 80
        spread: 70
        origin: y: 0.8
        colors: ['#00ff41', '#00ffff', '#ffffff']
        disableForReducedMotion: true


# --- ゲームオーバー画面の表示 ---
showGameOver = ->
    sfx.gameover()
    Swal.fire(
        title: 'HACK FAILED'
        html: "SYSTEM LOCKED OUT<br><br>MODE: #{state.mode.toUpperCase()}<br>REACHED STAGE: #{state.stage}<br>FINAL SCORE: <b style=\"color:var(--danger)\">#{state.score}</b>"
        background: '#111'
        color: 'var(--danger)'
        confirmButtonColor: 'var(--danger)'
        confirmButtonText: 'RETURN TO MENU'
        customClass: popup: 'swal-cyber'
    ).then(showMenu)


# --- ゲームクリア画面の表示 ---
showGameClear = ->
    sfx.combo()
    burst = 3
    cInterval = setInterval (->
        fireConfetti()
        burst--
        clearInterval(cInterval) if burst is 0
    ), 300

    Swal.fire(
        title: 'ACCESS GRANTED!'
        html: "ALL SECURITY CLEARED.<br><br>MODE: #{state.mode.toUpperCase()}<br>FINAL SCORE: <b style=\"color:var(--primary); font-size:24px;\">#{state.score}</b>"
        background: '#111'
        color: 'var(--primary)'
        confirmButtonColor: 'var(--primary-dim)'
        confirmButtonText: 'RETURN TO MENU'
        customClass: popup: 'swal-cyber'
    ).then(showMenu)
