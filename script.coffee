# PORT_HACKER — game controller
# Single-file CoffeeScript application. Game rules and presentation stay explicit.

audioContext = null

state =
    screen: 'menu'
    mode: 'normal'
    stageLimit: 10
    stage: 1
    score: 0
    combo: 0
    hp: 3
    pool: []
    queue: []
    target: null
    options: []
    reverse: false
    answered: false
    explaining: false
    timer: null
    answerDelay: null

database =
    normal: []
    hard: []
    omake: []

$ = (id) -> document.getElementById(id)

randomItem = (items) -> items[Math.floor(Math.random() * items.length)]

shuffle = (items) ->
    result = [...items]
    for i in [result.length - 1..1]
        j = Math.floor(Math.random() * (i + 1))
        [result[i], result[j]] = [result[j], result[i]]
    result

playTone = (frequency, waveform = 'sine', duration = 0.12, volume = 0.08) ->
    return unless audioContext?
    oscillator = audioContext.createOscillator()
    gain = audioContext.createGain()
    now = audioContext.currentTime

    oscillator.type = waveform
    oscillator.frequency.setValueAtTime(frequency, now)
    gain.gain.setValueAtTime(volume, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration)
    oscillator.connect(gain)
    gain.connect(audioContext.destination)
    oscillator.start(now)
    oscillator.stop(now + duration)

playSfx = (name) ->
    switch name
        when 'hover'
            playTone(760, 'sine', 0.06, 0.018)
        when 'correct'
            playTone(880, 'square', 0.09)
            setTimeout((-> playTone(1320, 'square', 0.12)), 90)
        when 'wrong'
            playTone(160, 'sawtooth', 0.28, 0.16)
        when 'combo'
            [440, 554, 659].forEach (frequency, index) ->
                setTimeout((-> playTone(frequency, 'sine', 0.14)), index * 90)
        when 'gameover'
            playTone(190, 'sawtooth', 0.4, 0.22)
            setTimeout((-> playTone(130, 'sawtooth', 0.7, 0.2)), 250)

initAudio = ->
    AudioContextClass = window.AudioContext or window.webkitAudioContext
    return unless AudioContextClass?
    audioContext ?= new AudioContextClass()
    audioContext.resume() if audioContext.state is 'suspended'

loadDatabase = ->
    try
        response = await fetch('ports.json')
        throw new Error('HTTP ' + response.status) unless response.ok
        data = await response.json()
        database.normal = data.dbWellKnownFamous or []
        database.hard = [...database.normal, ...(data.dbWellKnownMinor or [])]
        database.omake = [...database.hard, ...(data.dbRegisteredAndDev or [])]
        renderMenu()
    catch error
        console.error('Port database could not be loaded:', error)
        Swal.fire
            title: 'DATABASE OFFLINE'
            text: 'ports.json を読み込めなかった。ローカルサーバーで起動してね。'
            icon: 'error'
            background: '#101820'
            color: '#e8f5f2'
            confirmButtonColor: '#27e0b2'
            customClass: popup: 'swal-cyber'

renderMenu = ->
    state.screen = 'menu'
    $('menu-screen').hidden = false
    $('game-screen').hidden = true
    $('menu-screen').classList.add('screen-enter')

startGame = ->
    initAudio()
    state.mode = $('mode-select').value
    selectedCount = $('count-select').value
    state.stageLimit = if selectedCount is 'endless' then Infinity else Number(selectedCount)
    state.pool = [...database[state.mode]]
    return unless state.pool.length

    state.queue = shuffle(state.pool)
    state.stage = 1
    state.score = 0
    state.combo = 0
    state.hp = 3
    state.target = null
    state.options = []
    state.answered = false
    state.explaining = false
    state.screen = 'game'

    $('menu-screen').hidden = true
    $('game-screen').hidden = false
    $('mode-label').textContent = state.mode.toUpperCase()
    $('mode-label').dataset.mode = state.mode
    $('max-stage-label').textContent = if state.stageLimit is Infinity then '∞' else state.stageLimit
    updateHud()
    loadStage()

stopStageTimers = ->
    state.timer?.pause()
    clearTimeout(state.answerDelay) if state.answerDelay?
    state.timer = null
    state.answerDelay = null

loadStage = ->
    return unless state.screen is 'game'
    stopStageTimers()
    state.answered = false
    state.explaining = false

    $('options').hidden = false
    $('explanation').hidden = true
    $('timer-fill').style.width = '100%'
    $('timer-fill').classList.remove('is-danger')
    $('question-card').classList.remove('is-reverse')
    $('answer-feedback').textContent = ''

    state.queue = shuffle(state.pool) if state.queue.length is 0
    state.target = state.queue.pop()
    state.reverse = Math.random() < 0.35

    if state.reverse
        $('question-direction').textContent = 'IDENTIFY THE PROTOCOL'
        $('target').textContent = ':' + state.target.port
        $('question-card').classList.add('is-reverse')
    else
        $('question-direction').textContent = 'IDENTIFY THE PORT'
        $('target').textContent = state.target.name

    createOptions()
    updateHud()

    duration = Math.max(3000, 10000 - state.stage * 150)
    state.timer = anime
        targets: $('timer-fill')
        width: '0%'
        duration: duration
        easing: 'linear'
        update: (animation) ->
            $('timer-fill').classList.toggle('is-danger', animation.progress >= 70)
        complete: ->
            submitAnswer(null) unless state.answered

createOptions = ->
    correct = if state.reverse then state.target.name else state.target.port
    candidates = state.pool.map (entry) -> if state.reverse then entry.name else entry.port
    distractors = shuffle(candidates.filter((value) -> value isnt correct)).slice(0, 3)
    state.options = shuffle([correct, ...distractors])

    for option, index in state.options
        button = $('option-' + index)
        button.textContent = option
        button.classList.remove('is-correct', 'is-wrong')
        button.disabled = false

updateHud = ->
    $('stage-label').textContent = state.stage
    $('score-label').textContent = state.score.toLocaleString()
    $('combo-label').textContent = state.combo
    $('hp-label').textContent = '♥'.repeat(state.hp) + '♡'.repeat(3 - state.hp)
    $('hp-label').setAttribute('aria-label', state.hp + ' lives remaining')

submitAnswer = (index) ->
    return unless state.screen is 'game'
    return if state.answered
    return if index? and (index < 0 or index >= state.options.length)

    state.answered = true
    state.timer?.pause()
    selected = if index? then state.options[index] else null
    correct = if state.reverse then state.target.name else state.target.port
    isCorrect = selected is correct

    for option, optionIndex in state.options
        button = $('option-' + optionIndex)
        button.disabled = true
        button.classList.add('is-correct') if option is correct

    if isCorrect
        handleCorrect(index)
    else
        handleWrong(index)

handleCorrect = (index) ->
    state.combo++
    multiplier = if state.mode is 'omake' then 1.5 else if state.mode is 'hard' then 1.2 else 1
    remaining = Math.max(0, parseFloat($('timer-fill').style.width) / 100)
    points = Math.floor((100 + remaining * 200) * (1 + state.combo * 0.2) * multiplier)
    state.score += points

    $('option-' + index).classList.add('is-correct')
    $('answer-feedback').textContent = '+' + points + ' POINTS'
    $('answer-feedback').className = 'feedback is-good'
    updateHud()

    if state.combo % 3 is 0
        playSfx('combo')
        confetti
            particleCount: 55
            spread: 65
            origin: y: 0.75
            disableForReducedMotion: true
    else
        playSfx('correct')

    state.answerDelay = setTimeout(showExplanation, 450)

handleWrong = (index) ->
    state.combo = 0
    state.hp--
    playSfx('wrong')
    $('option-' + index).classList.add('is-wrong') if index?
    $('answer-feedback').textContent = if index? then 'ACCESS DENIED' else 'TIME EXPIRED'
    $('answer-feedback').className = 'feedback is-bad'
    $('game-screen').classList.remove('shake')
    void $('game-screen').offsetWidth
    $('game-screen').classList.add('shake')
    updateHud()
    state.answerDelay = setTimeout(showExplanation, 600)

showExplanation = ->
    return unless state.screen is 'game'
    state.explaining = true
    $('options').hidden = true
    $('explanation').hidden = false
    $('explanation-title').textContent = state.target.name + '  /  PORT ' + state.target.port
    $('explanation-description').textContent = state.target.desc
    $('next-prompt').textContent = if state.hp <= 0 then 'PRESS ANY KEY TO VIEW RESULT' else 'PRESS ANY KEY TO CONTINUE'
    anime
        targets: $('explanation')
        opacity: [0, 1]
        translateY: [12, 0]
        duration: 220
        easing: 'easeOutQuad'

advanceStage = ->
    return unless state.explaining
    state.explaining = false
    if state.hp <= 0
        finishGame(false)
    else
        state.stage++
        if state.stageLimit isnt Infinity and state.stage > state.stageLimit
            finishGame(true)
        else
            loadStage()

finishGame = (cleared) ->
    state.screen = 'result'
    stopStageTimers()
    playSfx(if cleared then 'combo' else 'gameover')
    if cleared
        confetti
            particleCount: 100
            spread: 90
            origin: y: 0.7
            disableForReducedMotion: true

    Swal.fire
        title: if cleared then 'ACCESS GRANTED' else 'SYSTEM LOCKED'
        html: """
            <div class="result-summary">
                <p>MODE <strong>#{state.mode.toUpperCase()}</strong></p>
                <p>STAGE <strong>#{if cleared then state.stage - 1 else state.stage}</strong></p>
                <p>FINAL SCORE <strong>#{state.score.toLocaleString()}</strong></p>
            </div>
        """
        background: '#101820'
        color: '#e8f5f2'
        confirmButtonColor: '#27e0b2'
        confirmButtonText: 'RETURN TO MENU'
        customClass: popup: 'swal-cyber'
        allowOutsideClick: false
    .then(renderMenu)

# UI event wiring is performed once, not every time a new run starts.
document.addEventListener 'DOMContentLoaded', ->
    $('start-button').addEventListener 'click', startGame
    $('back-button').addEventListener 'click', renderMenu
    $('options').addEventListener 'click', (event) ->
        button = event.target.closest('[data-option]')
        submitAnswer(Number(button.dataset.option)) if button?
    $('options').addEventListener 'pointerover', (event) ->
        playSfx('hover') if event.target.closest('[data-option]')
    $('explanation').addEventListener 'click', advanceStage
    document.addEventListener 'keydown', (event) ->
        if state.explaining
            event.preventDefault()
            advanceStage()
        else if state.screen is 'game' and not state.answered and event.key in ['1', '2', '3', '4']
            event.preventDefault()
            submitAnswer(Number(event.key) - 1)
    loadDatabase()
